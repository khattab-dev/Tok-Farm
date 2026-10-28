import { spawn } from 'node:child_process'
import { access, copyFile, link, mkdir, open, rm, stat, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { cpus } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import type { Clip, Media } from '../shared/model'
import { panExpression } from '../shared/crop'
import { blurredBackgroundLayout, frameLayout, outputSize, resolveFraming } from '../shared/framing'

const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
const toolsRoot =
  resourcesPath && existsSync(join(resourcesPath, 'video-tools'))
    ? join(resourcesPath, 'video-tools')
    : resolve('build/video-tools')
export const ffmpegPath = join(toolsRoot, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
export const ffprobePath = join(toolsRoot, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancelledError'
  }
}

export function runProcess(
  binary: string,
  args: string[],
  options: { signal?: AbortSignal; duration?: number; onProgress?: (progress: number) => void } = {}
): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(new CancelledError())
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = '',
      errors = '',
      pending = ''
    const abort = () => {
      child.kill()
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-2000000)
      pending += chunk.toString()
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('out_time_us=') && options.duration) {
          const elapsed = Number(line.slice(12)) / 1000000
          if (Number.isFinite(elapsed))
            options.onProgress?.(Math.max(0, Math.min(0.99, elapsed / options.duration)))
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-6000)
    })
    child.once('error', (error) => {
      options.signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.once('close', (code) => {
      options.signal?.removeEventListener('abort', abort)
      if (options.signal?.aborted) reject(new CancelledError())
      else if (code !== 0)
        reject(new Error(errors.trim() || `Video process exited with code ${code}.`))
      else resolve(output)
    })
  })
}

export async function rawProbe(path: string) {
  return JSON.parse(
    await runProcess(ffprobePath, [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      path
    ])
  )
}

export async function probeMedia(path: string): Promise<Media> {
  const [data, info] = await Promise.all([rawProbe(path), stat(path)])
  if (!info.isFile()) throw new Error('Choose a video file.')
  const video = data.streams?.find(
    (stream: any) => stream.codec_type === 'video' && !stream.disposition?.attached_pic
  )
  if (!video) throw new Error('This file has no playable video stream.')
  if (['smpte2084', 'arib-std-b67'].includes(video.color_transfer))
    throw new Error('HDR video is not supported yet. Convert this source to SDR first.')
  const duration = Number(data.format?.duration || video.duration)
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error('The video duration could not be read. The file may be damaged.')
  const rotation = Number(
    video.side_data_list?.find((side: any) => side.rotation !== undefined)?.rotation ??
      video.tags?.rotate ??
      0
  )
  const [sarN, sarD] = String(video.sample_aspect_ratio || '1:1')
    .split(':')
    .map(Number)
  const sar = sarN > 0 && sarD > 0 ? sarN / sarD : 1
  let width = Math.max(2, Math.round((video.width * sar) / 2) * 2),
    height = Number(video.height)
  if (Math.abs(Math.round(rotation / 90)) % 2 === 1) [width, height] = [height, width]
  if (!(width >= 2 && height >= 2)) throw new Error('Invalid video dimensions.')
  const validRate = (expression: string) => {
    const [n, d = 1] = expression.split('/').map(Number)
    return Number.isFinite(n / d) && n / d > 0
  }
  const fpsExpression: string = [video.avg_frame_rate, video.r_frame_rate, '30/1'].find(
    (value) => typeof value === 'string' && validRate(value)
  )
  const [n, d = 1] = fpsExpression.split('/').map(Number),
    fps = n / d
  return {
    path,
    name: basename(path),
    duration,
    width,
    height,
    fps,
    fpsExpression,
    codec: video.codec_name || 'unknown',
    hasAudio: data.streams.some((stream: any) => stream.codec_type === 'audio'),
    rotation,
    size: info.size,
    modifiedAt: info.mtimeMs
  }
}

export async function assertSource(media: Media) {
  let info
  try {
    info = await stat(media.path)
  } catch {
    throw new Error('Source video is missing. Relink it in the project before exporting.')
  }
  if (info.size !== media.size || Math.abs(info.mtimeMs - media.modifiedAt) > 2)
    throw new Error('Source video has changed. Relink it before exporting.')
}

export const encodeThreads = Math.max(1, Math.min(4, Math.floor(cpus().length / 2)))

export function exportArgs(media: Media, clip: Clip, output: string): string[] {
  const framing = resolveFraming(clip.framing)
  const layout = frameLayout(media.width, media.height, framing, {
    x: framing.positionX,
    y: framing.positionY
  })
  const { width, height } = layout.canvas
  const x = panExpression(clip.keyframes, 'x', clip.start, framing.positionX),
    y = panExpression(clip.keyframes, 'y', clip.start, framing.positionY)
  const fps = media.fps > 60 ? '60' : media.fpsExpression
  const normalized = `[0:v:0]setpts=PTS-STARTPTS,scale=${media.width}:${media.height},setsar=1`
  let filter: string
  if (framing.background === 'blur' && (layout.width < width || layout.height < height)) {
    const back = blurredBackgroundLayout(media.width, media.height, framing)
    filter = `${normalized},split=2[front][back];[front]scale=${layout.width}:${layout.height}:flags=bicubic[fg];[back]scale=${back.width}:${back.height}:flags=bicubic,crop=${back.paddedWidth}:${back.paddedHeight},gblur=sigma=${framing.blur}:steps=2,crop=${width}:${height}:${back.padding}:${back.padding}[bg];`
  } else {
    filter = `${normalized},scale=${layout.width}:${layout.height}:flags=bicubic[fg];color=c=0x${framing.backgroundColor.slice(1)}:s=${width}x${height}:r=${fps}[bg];`
  }
  filter += `[bg][fg]overlay=x='floor((W-w)*(${x})/2)*2':y='floor((H-h)*(${y})/2)*2':eval=frame:shortest=1,fps=${fps},format=yuv420p[outv]`
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-threads',
    String(encodeThreads),
    '-ss',
    String(clip.start),
    '-i',
    media.path,
    '-t',
    String(clip.end - clip.start),
    '-map',
    '[outv]',
    '-filter_complex',
    filter,
    '-filter_complex_threads',
    String(encodeThreads),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-threads',
    String(encodeThreads)
  ]
  if (media.hasAudio && !clip.muted)
    args.push(
      '-map',
      '0:a:0?',
      '-af',
      'aresample=async=1:first_pts=0',
      '-c:a',
      'aac',
      '-b:a',
      '192k'
    )
  else args.push('-an')
  return [
    ...args,
    '-map_metadata',
    '-1',
    '-metadata:s:v:0',
    'rotate=0',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    output
  ]
}

export function safeFilename(name: string) {
  const clean =
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[. ]+$/g, '')
      .slice(0, 90)
      .trim() || 'Reel'
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean
}

async function reserveOutput(directory: string, name: string) {
  const stem = safeFilename(name)
  for (let i = 0; i < 10000; i++) {
    const path = join(directory, `${stem}${i ? ` (${i + 1})` : ''}.mp4`)
    try {
      await access(path)
      continue
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    const lock = `${path}.tokfarm-lock`
    try {
      const handle = await open(lock, 'wx')
      await handle.close()
      return { path, release: () => rm(lock, { force: true }) }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
  throw new Error('Too many reels with the same name. Rename this shot.')
}

export async function exportClip(
  media: Media,
  clip: Clip,
  directory: string,
  signal: AbortSignal,
  onProgress: (p: number) => void,
  jobId: string = randomUUID()
): Promise<string> {
  await assertSource(media)
  await access(directory, constants.W_OK)
  const temporary = join(directory, `.tokfarm-${jobId}.partial.mp4`)
  const filterFile = join(directory, `.tokfarm-${jobId}.filter.txt`)
  let reservation: Awaited<ReturnType<typeof reserveOutput>> | undefined
  try {
    // Filter scripts avoid Windows command-line length limits for long pan paths.
    const args = exportArgs(media, clip, temporary),
      filterIndex = args.indexOf('-filter_complex')
    await writeFile(filterFile, args[filterIndex + 1], 'utf8')
    args.splice(filterIndex, 2, '-filter_complex_script', filterFile)
    await runProcess(ffmpegPath, args, { signal, duration: clip.end - clip.start, onProgress })
    if (signal.aborted) throw new CancelledError()
    const data = await rawProbe(temporary)
    if (signal.aborted) throw new CancelledError()
    const dimensions = outputSize(clip.framing)
    if (
      !data.streams?.some(
        (stream: any) =>
          stream.codec_type === 'video' &&
          stream.width === dimensions.width &&
          stream.height === dimensions.height
      )
    )
      throw new Error('Export validation failed: invalid video output.')
    for (;;) {
      reservation = await reserveOutput(directory, clip.name)
      if (signal.aborted) throw new CancelledError()
      try {
        // Hard-link finalization is atomic and never replaces an existing file.
        try {
          await link(temporary, reservation.path)
        } catch (error) {
          if (
            !['EPERM', 'ENOTSUP', 'EXDEV', 'EACCES'].includes(
              (error as NodeJS.ErrnoException).code || ''
            )
          )
            throw error
          await copyFile(temporary, reservation.path, constants.COPYFILE_EXCL)
        }
        return reservation.path
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await reservation.release()
        reservation = undefined
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
    await rm(filterFile, { force: true }).catch(() => {})
    await reservation?.release()
  }
}

function cacheKey(media: Media) {
  return createHash('sha256')
    .update(`${media.path}:${media.size}:${media.modifiedAt}`)
    .digest('hex')
    .slice(0, 24)
}

export async function generateThumbnails(
  media: Media,
  cacheRoot: string
): Promise<{ time: number; path: string }[]> {
  await assertSource(media)
  const folder = join(cacheRoot, cacheKey(media))
  await mkdir(folder, { recursive: true })
  const count = 14,
    result: { time: number; path: string }[] = []
  for (let i = 0; i < count; i++) {
    const time = (media.duration * i) / count,
      path = join(folder, `thumb-${i}.jpg`)
    try {
      await access(path)
    } catch {
      const temporary = `${path}.tmp.jpg`
      await runProcess(ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-threads',
        '1',
        '-ss',
        String(time),
        '-i',
        media.path,
        '-frames:v',
        '1',
        '-vf',
        'scale=192:-2',
        '-filter_threads',
        '1',
        '-threads',
        '1',
        temporary
      ])
      const { rename } = await import('node:fs/promises')
      await rename(temporary, path)
    }
    result.push({ time, path })
  }
  return result
}

export async function generateProxy(
  media: Media,
  cacheRoot: string,
  signal: AbortSignal,
  onProgress: (progress: number) => void
) {
  await assertSource(media)
  const folder = join(cacheRoot, cacheKey(media))
  await mkdir(folder, { recursive: true })
  const output = join(folder, 'preview.mp4')
  try {
    await access(output)
    return output
  } catch {
    /* Create a fresh preview. */
  }
  const temporary = join(folder, 'preview.partial.mp4')
  try {
    await runProcess(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-threads',
        String(encodeThreads),
        '-i',
        media.path,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-vf',
        "scale=w='min(1280,iw)':h=-2,setsar=1",
        '-filter_threads',
        String(encodeThreads),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '26',
        '-threads',
        String(encodeThreads),
        '-g',
        '30',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        '-progress',
        'pipe:1',
        temporary
      ],
      { signal, duration: media.duration, onProgress }
    )
    const { rename } = await import('node:fs/promises')
    await rename(temporary, output)
    return output
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
