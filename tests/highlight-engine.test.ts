import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ffmpegPath, probeMedia, runProcess } from '../src/main/media'
import { scanHighlights, VisionAnalyzer } from '../src/main/highlight-engine'

describe('offline visual analysis with the real model', () => {
  let directory: string, source: string
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tokfarm-highlights-'))
    source = join(directory, 'silent-events.mp4')
    await runProcess(ffmpegPath, [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      "color=black:s=320x180:r=10:d=55,drawbox=x=0:y=0:w=320:h=180:color=white:t=fill:enable='between(t,20,21)+between(t,44,45)'",
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      source
    ])
  })
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  it('loads the bundled model and finds reviewable activity in silent footage', async () => {
    const media = await probeMedia(source),
      phases: string[] = []
    expect(media.hasAudio).toBe(false)
    const result = await scanHighlights(
      media,
      { profile: 'general', sensitivity: 'balanced', maxSuggestions: 20 },
      directory,
      new AbortController().signal,
      (event) => phases.push(event.phase)
    )
    expect(result).toHaveLength(2)
    expect(result.some((clip) => Math.abs(clip.peak - 20) <= 2)).toBe(true)
    expect(result.some((clip) => Math.abs(clip.peak - 44) <= 2)).toBe(true)
    expect(phases).toContain('visual')
    expect(phases).not.toContain('audio')
    const cached = await scanHighlights(
      media,
      { profile: 'general', sensitivity: 'balanced', maxSuggestions: 1 },
      directory,
      new AbortController().signal,
      () => {}
    )
    expect(cached).toHaveLength(1)
  })
  it('returns no semantic event for a static blank frame and supports all content profiles', async () => {
    for (const profile of ['general', 'football', 'gaming'] as const) {
      const controller = new AbortController(),
        analyzer = new VisionAnalyzer(profile, controller.signal)
      try {
        const sample = await analyzer.infer(Buffer.alloc(224 * 224 * 3))
        expect(sample.semantic).toBeLessThan(0.32)
        expect(sample.motion).toBe(0)
      } finally {
        await analyzer.dispose()
      }
    }
  })
  it('cancels before decoding or at the start of visual processing', async () => {
    const media = await probeMedia(source),
      controller = new AbortController()
    controller.abort()
    await expect(
      scanHighlights(
        media,
        { profile: 'gaming', sensitivity: 'balanced', maxSuggestions: 10 },
        directory,
        controller.signal,
        () => {}
      )
    ).rejects.toThrow('Cancelled')
    const active = new AbortController()
    await expect(
      scanHighlights(
        media,
        { profile: 'gaming', sensitivity: 'balanced', maxSuggestions: 10 },
        directory,
        active.signal,
        (event) => {
          if (event.phase === 'visual') active.abort()
        }
      )
    ).rejects.toThrow('Cancelled')
  })
  it('can stop model startup without terminating the host process', async () => {
    const controller = new AbortController(),
      analyzer = new VisionAnalyzer('general', controller.signal)
    controller.abort()
    await expect(analyzer.ready).rejects.toThrow('Cancelled')
    await analyzer.dispose()
    const next = new VisionAnalyzer('general', new AbortController().signal)
    try {
      expect((await next.infer(Buffer.alloc(224 * 224 * 3))).motion).toBe(0)
    } finally {
      await next.dispose()
    }
  })
})
