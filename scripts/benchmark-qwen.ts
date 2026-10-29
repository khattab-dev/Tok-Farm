import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { performance } from 'node:perf_hooks'
import { QwenRuntime, type QwenBackend } from '../src/main/qwen-runtime'
import { ffmpegPath, probeMedia, runProcess } from '../src/main/media'
import {
  absoluteEvents,
  matchKnownEvents,
  mergeQwenEvents,
  videoWindows,
  type QwenEvent
} from '../src/shared/qwen'
import { QWEN_ANALYSIS_VERSION } from '../src/shared/qwen'
import manifest from './qwen-assets.json'

const run = promisify(execFile)
const positive = (text: string, name: string) => {
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`)
  return value
}
const nonnegative = (text: string, name: string) => {
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`)
  return value
}

async function hardware() {
  let gpu = 'Unavailable',
    memory = 'Unavailable'
  try {
    gpu = (
      await run(
        'nvidia-smi.exe',
        ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'],
        { windowsHide: true, timeout: 5000 }
      )
    ).stdout.trim()
  } catch {}
  try {
    memory = (
      await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          '[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)'
        ],
        { windowsHide: true, timeout: 10000 }
      )
    ).stdout.trim()
  } catch {}
  return { gpu, ramGiB: memory }
}
async function memorySample(pid?: number) {
  let gpuUsedMiB: number | null = null,
    processPeakRssMiB: number | null = null
  try {
    const data = await run(
      'nvidia-smi.exe',
      ['--query-gpu=memory.used', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 5000 }
    )
    gpuUsedMiB = Number(data.stdout.trim().split('\n')[0])
  } catch {}
  if (pid)
    try {
      const data = await run(
        'powershell.exe',
        ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).PeakWorkingSet64`],
        { windowsHide: true, timeout: 5000 }
      )
      processPeakRssMiB = Number(data.stdout.trim()) / 1048576
    } catch {}
  return { gpuUsedMiB, processPeakRssMiB }
}

async function main() {
  const { values } = parseArgs({
    options: {
      video: { type: 'string' },
      event: { type: 'string' },
      start: { type: 'string', default: '0' },
      duration: { type: 'string', default: '24' },
      truth: { type: 'string', multiple: true },
      backend: { type: 'string', default: 'auto' },
      window: { type: 'string', default: '10' },
      overlap: { type: 'string', default: '2' },
      fps: { type: 'string', default: '2' },
      context: { type: 'string', default: '8192' },
      'image-tokens': { type: 'string', default: '256' },
      output: { type: 'string' },
      'cancel-after': { type: 'string' },
      controlled: { type: 'boolean', default: false },
      negative: { type: 'boolean', default: false }
    }
  })
  if (!values.video && !values.controlled)
    throw new Error(
      'Use --video "C:\\path\\video.mp4" --event "what to find" --start SECONDS --duration SECONDS --truth EVENT_SECONDS, or --controlled.'
    )
  if (!['auto', 'vulkan', 'cpu'].includes(values.backend))
    throw new Error('Backend must be auto, vulkan, or cpu')
  const root = resolve(values.output || join('test-results', 'qwen', `run-${Date.now()}`)),
    clips = join(root, 'windows')
  await mkdir(clips, { recursive: true })
  let source = values.video ? resolve(values.video) : join(root, 'controlled.mp4')
  if (values.controlled) {
    await runProcess(ffmpegPath, [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      "color=c=0x242424:s=640x360:r=30:d=12,drawbox=x=220:y=100:w=200:h=160:color=red:t=fill:enable='between(t,4,7)'",
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      source
    ])
  }
  const media = await probeMedia(source),
    start = nonnegative(values.start, 'start'),
    duration = positive(values.duration, 'duration'),
    end = Math.min(media.duration, start + duration),
    windowSize = positive(values.window, 'window'),
    overlap = nonnegative(values.overlap, 'overlap'),
    fps = positive(values.fps, 'fps'),
    context = positive(values.context, 'context'),
    imageTokens = positive(values['image-tokens'], 'image tokens')
  if (duration > 120 || windowSize > 20 || fps > 8 || context > 16384 || imageTokens > 1024)
    throw new Error(
      'Benchmark limits: duration ≤120 s, window ≤20 s, FPS ≤8, context ≤16384, image tokens ≤1024.'
    )
  const windows = videoWindows(start, end, windowSize, overlap),
    truth =
      values.truth?.map((value) => nonnegative(value, 'known event timestamp')) ||
      (values.controlled ? [4].filter((time) => time >= start && time <= end) : [])
  if (truth.some((time) => time < start || time > end))
    throw new Error('Known event timestamps must lie within the benchmark range')
  const event =
    values.event ||
    (values.controlled
      ? 'A red rectangle appears on the screen. Find when it becomes visible and disappears.'
      : 'Find distinct, visually noteworthy actions or meaningful changes that would be useful to review as short highlights. Omit routine continuous activity and events that are not visibly supported.')
  if (event.length > 2000) throw new Error('Event description must be at most 2000 characters')
  if (!Number.isInteger(context) || !Number.isInteger(imageTokens))
    throw new Error('Context and image token limits must be integers')
  const controller = new AbortController(),
    signal = controller.signal
  process.once('SIGINT', () => controller.abort())
  let cancellation: ReturnType<typeof setTimeout> | undefined
  if (values['cancel-after'])
    cancellation = setTimeout(
      () => controller.abort(),
      positive(values['cancel-after'], 'cancel after') * 1000
    )
  const log = join(root, 'runtime.log')
  await writeFile(log, '', 'utf8')
  let logWrites = Promise.resolve()
  const runtime = new QwenRuntime({
    backend: values.backend as QwenBackend,
    fps,
    context,
    imageTokens,
    onLog: (line) => {
      logWrites = logWrites.then(() => appendFile(log, line)).catch(() => {})
    }
  })
  const started = performance.now(),
    machine = await hardware(),
    baseline = await memorySample()
  const report: any = {
    version: 1,
    analysisVersion: QWEN_ANALYSIS_VERSION,
    createdAt: new Date().toISOString(),
    source: {
      path: media.path,
      duration: media.duration,
      width: media.width,
      height: media.height,
      hasAudio: media.hasAudio
    },
    event,
    mode: values.event || values.controlled ? 'find' : 'auto',
    range: { start, end },
    settings: { fps, context, imageTokens, windowSeconds: windowSize, overlapSeconds: overlap },
    assets: manifest,
    hardware: machine,
    memory: {
      baselineGpuUsedMiB: baseline.gpuUsedMiB,
      peakObservedGpuUsedMiB: baseline.gpuUsedMiB,
      processPeakRssMiB: null,
      note: 'GPU values are total device usage, including other applications. Sampled GPU peak may miss brief spikes. Process RSS peak excludes child processes.'
    },
    windows: [],
    events: [],
    evaluation: null,
    status: 'running',
    runtimeLog: log
  }
  let pendingSample: Promise<void> | undefined
  const sample = async () => {
    const memory = await memorySample(runtime.pid)
    if (memory.gpuUsedMiB !== null)
      report.memory.peakObservedGpuUsedMiB = Math.max(
        report.memory.peakObservedGpuUsedMiB || 0,
        memory.gpuUsedMiB
      )
    if (memory.processPeakRssMiB !== null)
      report.memory.processPeakRssMiB = Math.max(
        report.memory.processPeakRssMiB || 0,
        memory.processPeakRssMiB
      )
  }
  const timer = setInterval(() => {
    if (!pendingSample)
      pendingSample = sample().finally(() => {
        pendingSample = undefined
      })
  }, 2000)
  const events: QwenEvent[] = []
  try {
    console.log(
      `Qwen benchmark: ${media.name}, ${start.toFixed(1)}–${end.toFixed(1)} s, ${windows.length} windows. Loading model…`
    )
    await runtime.start(signal)
    report.backend = runtime.backend
    report.device = runtime.device
    report.startupSeconds = runtime.startupSeconds
    console.log(`Ready in ${runtime.startupSeconds.toFixed(2)} s: ${runtime.device}`)
    for (const [index, window] of windows.entries()) {
      signal.throwIfAborted()
      const file = join(clips, `${index}.mp4`),
        entry: any = { ...window, index }
      try {
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
            file
          ],
          { signal }
        )
        console.log(`Analyzing ${window.start.toFixed(2)}–${window.end.toFixed(2)} s…`)
        const response = await runtime.analyze(file, window.end - window.start, event, signal)
        Object.assign(entry, {
          rawResult: response.result,
          inferenceSeconds: response.seconds,
          usage: response.usage,
          timings: response.timings
        })
        const detected = absoluteEvents(response.result, window)
        Object.assign(entry, {
          ...detected,
          inferenceSeconds: response.seconds,
          usage: response.usage,
          timings: response.timings
        })
        events.push(...detected.events)
        console.log(`${response.seconds.toFixed(2)} s: ${JSON.stringify(detected)}`)
      } catch (error) {
        if (signal.aborted) throw error
        entry.error = String(error)
        console.error(`Window failed: ${String(error)}`)
      } finally {
        report.windows.push(entry)
        await rm(file, { force: true }).catch(() => {})
      }
      report.events = mergeQwenEvents(events)
      await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
    }
    report.status = report.windows.some((window: any) => window.error)
      ? 'partial-failure'
      : 'completed'
    report.evaluation = matchKnownEvents(mergeQwenEvents(events), truth)
    if (values.negative)
      report.negativeEvaluation = {
        expectedEvents: 0,
        falsePositiveDetections: report.events.length,
        fullyAnnotatedRange: { start, end }
      }
    if (values.controlled)
      report.controlledEvaluation = {
        expectedVisibleInterval: { start: 4, end: 7 },
        expectedEmptyWindows: windows.filter((window) => window.start > 7 || window.end < 4),
        detectionsInKnownEmptyWindows: report.windows
          .filter((window: any) => window.start > 7 || window.end < 4)
          .flatMap((window: any) => window.events || []),
        note: 'The controlled fixture is fully annotated. Detections in its known empty windows are false positives, even if the positive event was also found.'
      }
    if (report.status === 'partial-failure') process.exitCode = 1
  } catch (error) {
    report.status = signal.aborted ? 'cancelled' : 'failed'
    report.error = String(error)
    if (!signal.aborted) process.exitCode = 1
  } finally {
    if (cancellation) clearTimeout(cancellation)
    clearInterval(timer)
    await pendingSample
    await sample()
    await runtime.stop()
    await logWrites
    report.elapsedSeconds = (performance.now() - started) / 1000
    report.inferenceSeconds = report.windows.reduce(
      (sum: number, window: any) => sum + (window.inferenceSeconds || 0),
      0
    )
    report.analyzedSourceSeconds = end - start
    report.events = mergeQwenEvents(events)
    report.notes = [
      'Visual-only evaluation: audio and speech are not analyzed.',
      'No claim of accuracy on untested video types.',
      'Input video and model inference stay on this computer. No external inference service is called.'
    ]
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
    console.log(
      JSON.stringify(
        {
          status: report.status,
          backend: report.backend,
          device: report.device,
          startupSeconds: report.startupSeconds,
          elapsedSeconds: report.elapsedSeconds,
          inferenceSeconds: report.inferenceSeconds,
          memory: report.memory,
          events: report.events,
          evaluation: report.evaluation,
          negativeEvaluation: report.negativeEvaluation,
          controlledEvaluation: report.controlledEvaluation,
          report: join(root, 'report.json')
        },
        null,
        2
      )
    )
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
