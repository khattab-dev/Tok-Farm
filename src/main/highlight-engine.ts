import { fork, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { assertSource, CancelledError, ffmpegPath } from './media'
import {
  buildSuggestions,
  type HighlightSuggestion,
  type ScanOptions,
  type VisualSample
} from '../shared/highlights'
import type { Media } from '../shared/model'

const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
export const analysisRoot =
  resources && existsSync(join(resources, 'analysis-runtime'))
    ? join(resources, 'analysis-runtime')
    : resolve('build/analysis-runtime')
let modelSignature = 'clip-q8-v1'
try {
  modelSignature += JSON.parse(
    readFileSync(join(analysisRoot, 'MODEL-PROVENANCE.json'), 'utf8')
  ).profileHash
} catch {}
export function highlightSourceKey(media: Media) {
  return createHash('sha256')
    .update(`${modelSignature}:${media.path}:${media.size}:${media.modifiedAt}`)
    .digest('hex')
    .slice(0, 32)
}

export class VisionAnalyzer {
  private worker: {
    on(event: string, listener: (...args: any[]) => void): unknown
    kill(): unknown
  }
  private send: (message: { id: number; data: ArrayBufferLike }) => void
  private exited: Promise<void>
  private requests = new Map<
    number,
    { resolve: (value: Omit<VisualSample, 'time'>) => void; reject: (error: Error) => void }
  >()
  private sequence = 0
  private stopped = false
  readonly ready: Promise<void>
  constructor(profile: ScanOptions['profile'], signal: AbortSignal) {
    const script = join(analysisRoot, 'vision-worker.cjs')
    // Native inference lives in its own process: killing an initializing ONNX
    // session inside an Electron worker thread can crash the entire editor.
    if (process.versions.electron) {
      const { utilityProcess } = require('electron') as typeof import('electron')
      const child = utilityProcess.fork(script, [analysisRoot, profile], {
        serviceName: 'Tok Farm visual analysis',
        stdio: 'pipe'
      })
      this.worker = child
      this.send = (message) => child.postMessage(message)
    } else {
      const child = fork(script, [analysisRoot, profile], {
        serialization: 'advanced',
        execArgv: [],
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })
      this.worker = child
      this.send = (message) => child.send(message)
    }
    this.exited = new Promise((resolve) => {
      this.worker.on('exit', () => resolve())
    })
    this.ready = new Promise((resolve, reject) => {
      this.worker.on('message', (message) => {
        if (message.ready) resolve()
        else if (message.id) {
          const request = this.requests.get(message.id)
          this.requests.delete(message.id)
          if (message.error) request?.reject(new Error(message.error))
          else request?.resolve(message.sample)
        } else if (message.error) reject(new Error(message.error))
      })
      this.worker.on('error', (error) => {
        reject(error)
        for (const request of this.requests.values()) request.reject(error)
        this.requests.clear()
      })
      this.worker.on('exit', () => {
        this.stopped = true
        const error = signal.aborted
          ? new CancelledError()
          : new Error('The local visual analysis worker stopped.')
        reject(error)
        for (const request of this.requests.values()) request.reject(error)
        this.requests.clear()
      })
    })
    this.ready.catch(() => {})
    signal.addEventListener(
      'abort',
      () => {
        this.worker.kill()
      },
      { once: true }
    )
    if (signal.aborted) this.worker.kill()
  }
  async infer(frame: Buffer): Promise<Omit<VisualSample, 'time'>> {
    await this.ready
    if (this.stopped) throw new CancelledError()
    const id = ++this.sequence,
      data = Uint8Array.from(frame)
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject })
      this.send({ id, data: data.buffer })
    })
  }
  async dispose() {
    this.stopped = true
    this.worker.kill()
    await this.exited
  }
}

async function streamChunks(
  args: string[],
  bytes: number,
  signal: AbortSignal,
  consume: (frame: Buffer, index: number) => Promise<void>
) {
  if (signal.aborted) throw new CancelledError()
  const child = spawn(
    ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', ...args],
    { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let errors = '',
    buffer = Buffer.alloc(0),
    index = 0
  const abort = () => {
    child.kill()
  }
  signal.addEventListener('abort', abort, { once: true })
  const finished = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk.toString()).slice(-4000)
    })
    child.on('close', (code) => {
      if (signal.aborted) reject(new CancelledError())
      else if (code !== 0) reject(new Error(errors || `Video analysis exited with code ${code}.`))
      else resolve()
    })
  })
  finished.catch(() => {})
  try {
    for await (const chunk of child.stdout) {
      if (signal.aborted) throw new CancelledError()
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= bytes) {
        const frame = buffer.subarray(0, bytes)
        buffer = buffer.subarray(bytes)
        await consume(frame, index++)
      }
    }
    await finished
    if (buffer.length && bytes === 32000) {
      const last = Buffer.alloc(bytes)
      buffer.copy(last)
      await consume(last, index)
    }
  } finally {
    signal.removeEventListener('abort', abort)
    if (child.exitCode === null) child.kill()
  }
}

export interface ScanProgress {
  phase: 'preparing' | 'audio' | 'visual' | 'ranking'
  progress: number
}
export async function scanHighlights(
  media: Media,
  options: ScanOptions,
  cacheRoot: string,
  signal: AbortSignal,
  progress: (value: ScanProgress) => void
): Promise<HighlightSuggestion[]> {
  if (signal.aborted) throw new CancelledError()
  await assertSource(media)
  const key = highlightSourceKey(media),
    cache = join(cacheRoot, `highlights-${key}-${options.profile}.json`)
  let samples: VisualSample[] = [],
    audio: number[] = [],
    cached = false
  try {
    const result = JSON.parse(await readFile(cache, 'utf8'))
    if (
      result.sourceKey === key &&
      result.profile === options.profile &&
      Array.isArray(result.samples)
    ) {
      samples = result.samples
      audio = result.audio
      cached = true
    }
  } catch {}
  if (!cached) {
    progress({ phase: 'preparing', progress: 0 })
    const analyzer = new VisionAnalyzer(options.profile, signal)
    try {
      await analyzer.ready
      if (media.hasAudio) {
        progress({ phase: 'audio', progress: 0.01 })
        await streamChunks(
          [
            '-i',
            media.path,
            '-vn',
            '-map',
            '0:a:0',
            '-ac',
            '1',
            '-ar',
            '8000',
            '-f',
            'f32le',
            'pipe:1'
          ],
          32000,
          signal,
          async (frame, index) => {
            let energy = 0
            for (let i = 0; i < 8000; i++) {
              const value = frame.readFloatLE(i * 4)
              energy += value * value
            }
            audio.push(Math.sqrt(energy / 8000))
            progress({ phase: 'audio', progress: Math.min(0.1, (index / media.duration) * 0.1) })
          }
        )
      }
      progress({ phase: 'visual', progress: 0.1 })
      await streamChunks(
        [
          '-i',
          media.path,
          '-an',
          '-map',
          '0:v:0',
          '-vf',
          'fps=1/2:start_time=0,scale=224:224:force_original_aspect_ratio=decrease:flags=bicubic,pad=224:224:(ow-iw)/2:(oh-ih)/2,format=rgb24',
          '-filter_threads',
          '1',
          '-f',
          'rawvideo',
          'pipe:1'
        ],
        224 * 224 * 3,
        signal,
        async (frame, index) => {
          samples.push({
            time: Math.min(media.duration, index * 2),
            ...(await analyzer.infer(frame))
          })
          progress({
            phase: 'visual',
            progress: Math.min(0.96, 0.1 + ((index * 2) / media.duration) * 0.86)
          })
        }
      )
      if (!samples.length) throw new Error('No video frames could be analyzed.')
      await assertSource(media)
      await mkdir(cacheRoot, { recursive: true })
      const temporary = `${cache}.${randomUUID()}.tmp`
      await writeFile(
        temporary,
        JSON.stringify({ sourceKey: key, profile: options.profile, samples, audio }),
        'utf8'
      )
      await rename(temporary, cache)
    } finally {
      await analyzer.dispose()
    }
  }
  if (signal.aborted) throw new CancelledError()
  progress({ phase: 'ranking', progress: 0.98 })
  return buildSuggestions(samples, audio, media.duration, options, randomUUID)
}
