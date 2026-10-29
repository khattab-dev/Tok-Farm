import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm, mkdtemp } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { Media } from '../shared/model'
import type { HighlightSuggestion, ScanOptions } from '../shared/highlights'
import {
  absoluteEvents,
  AUTO_HIGHLIGHT_QUERY,
  mergeQwenEvents,
  QwenResponseSchema,
  QWEN_ANALYSIS_VERSION,
  videoWindows,
  type QwenEvent
} from '../shared/qwen'
import { assertSource, ffmpegPath, runProcess } from './media'
import { getQwenStatus, QwenRuntime, defaultQwenRoot } from './qwen-runtime'
import type { ScanProgress } from './highlight-engine'
import manifest from '../../scripts/qwen-assets.json'
import { timecode } from '../shared/crop'

export function qwenCandidates(
  events: QwenEvent[],
  duration: number,
  ids = new Map<string, string>()
): HighlightSuggestion[] {
  return mergeQwenEvents(events)
    .slice(0, 1000)
    .map((event) => {
      const key = `${event.start.toFixed(3)}:${event.label}`
      if (!ids.has(key)) ids.set(key, randomUUID())
      return {
        id: ids.get(key)!,
        start: Math.max(0, event.start - 5),
        end: Math.min(duration, Math.max(event.end, event.start + 0.25) + 3),
        peak: event.start,
        label: event.label.slice(0, 120),
        score: 0,
        status: 'pending' as const,
        reasons: [
          `Qwen experimental · event at ${timecode(event.start, true)}`,
          event.evidence,
          'Review the video; this is not a verified event.'
        ]
      }
    })
    .filter((clip) => clip.end > clip.start)
}

interface Runtime {
  start(signal: AbortSignal): Promise<void>
  analyze(
    file: string,
    duration: number,
    event: string,
    signal: AbortSignal
  ): Promise<{ result: unknown }>
  stop(): Promise<void>
}
export async function scanQwenHighlights(
  media: Media,
  options: ScanOptions,
  cacheRoot: string,
  signal: AbortSignal,
  progress: (value: ScanProgress) => void,
  root = defaultQwenRoot,
  makeRuntime: () => Runtime = () =>
    new QwenRuntime({ backend: 'auto', fps: 2, context: 8192, imageTokens: 256, root }),
  checkStatus: () => Promise<{ ready: boolean; message: string }> = () => getQwenStatus(root)
): Promise<HighlightSuggestion[]> {
  signal.throwIfAborted()
  await assertSource(media)
  const status = await checkStatus()
  if (!status.ready) throw new Error(status.message)
  const range = options.range || { start: 0, end: media.duration }
  if (range.start < 0 || range.end > media.duration + 0.001 || range.end <= range.start)
    throw new Error('Invalid scan range inside source video')
  const query = options.query?.trim() || AUTO_HIGHLIGHT_QUERY
  const key = createHash('sha256')
    .update(
      JSON.stringify([
        media.path,
        media.size,
        media.modifiedAt,
        manifest.modelRevision,
        QWEN_ANALYSIS_VERSION,
        query,
        2,
        256,
        8192
      ])
    )
    .digest('hex')
    .slice(0, 32)
  const folder = join(cacheRoot, `qwen-${key}`)
  await mkdir(folder, { recursive: true })
  const temporary = await mkdtemp(join(folder, 'working-'))
  const windows = videoWindows(range.start, Math.min(range.end, media.duration)),
    runtime = makeRuntime(),
    events: QwenEvent[] = [],
    ids = new Map<string, string>()
  let ready = false
  try {
    for (const [index, window] of windows.entries()) {
      signal.throwIfAborted()
      const file = join(folder, `${window.start.toFixed(3)}-${window.end.toFixed(3)}.json`)
      let result: unknown
      try {
        result = QwenResponseSchema.parse(JSON.parse(await readFile(file, 'utf8')))
        absoluteEvents(result, window)
      } catch {
        result = undefined
      }
      if (result === undefined) {
        if (!ready) {
          progress({
            phase: 'preparing',
            progress: 0,
            detail: 'Loading Qwen locally. First startup can take a moment.'
          })
          await runtime.start(signal)
          ready = true
        }
        progress({
          phase: 'visual',
          progress: index / windows.length,
          detail: `Analyzing ${timecode(window.start)}–${timecode(window.end)} · ${index + 1}/${windows.length}`
        })
        const clip = join(temporary, 'window.mp4')
        await runProcess(
          ffmpegPath,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-y',
            '-ss',
            String(window.start),
            '-i',
            media.path,
            '-t',
            String(window.end - window.start),
            '-an',
            '-vf',
            "scale=w='min(768,iw)':h=-2",
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '24',
            '-threads',
            '2',
            '-movflags',
            '+faststart',
            clip
          ],
          { signal }
        )
        result = QwenResponseSchema.parse(
          (await runtime.analyze(clip, window.end - window.start, query, signal)).result
        )
        absoluteEvents(result, window)
        signal.throwIfAborted()
        const staging = join(folder, `${randomUUID()}.tmp`)
        try {
          await writeFile(staging, JSON.stringify(result), 'utf8')
          await rename(staging, file)
        } finally {
          await rm(staging, { force: true }).catch(() => {})
        }
      }
      events.push(...absoluteEvents(result, window).events)
      progress({
        phase: 'visual',
        progress: (0.95 * (index + 1)) / windows.length,
        detail: `Checked ${index + 1}/${windows.length} sections · review candidates when scanning stops`,
        suggestions: qwenCandidates(events, media.duration, ids)
      })
    }
    await assertSource(media)
    signal.throwIfAborted()
    progress({ phase: 'ranking', progress: 0.99, detail: 'Combining repeated observations' })
    return qwenCandidates(events, media.duration, ids)
  } finally {
    await runtime.stop()
    // This is a freshly-created child directory containing only our snippets.
    if (resolve(temporary).startsWith(resolve(folder) + sep))
      await rm(temporary, { recursive: true, force: true }).catch(() => {})
  }
}
