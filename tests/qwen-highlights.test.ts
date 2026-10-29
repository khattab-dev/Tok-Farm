import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { ffmpegPath, probeMedia, runProcess } from '../src/main/media'
import { qwenCandidates, scanQwenHighlights } from '../src/main/qwen-highlights'
import { getQwenStatus } from '../src/main/qwen-runtime'
import { ScanOptionsSchema } from '../src/shared/highlights'
import type { Media } from '../src/shared/model'

describe('Qwen app scan pipeline', () => {
  let folder: string, media: Media
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tokfarm-qwen-'))
    const source = join(folder, 'مقطع.mp4')
    await runProcess(ffmpegPath, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=160x90:r=10:d=12',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      source
    ])
    media = await probeMedia(source)
  })
  afterAll(async () => {
    if (resolve(folder).startsWith(resolve(tmpdir()) + sep))
      await rm(folder, { recursive: true, force: true })
  })
  const options = {
    engine: 'qwen' as const,
    profile: 'general' as const,
    sensitivity: 'balanced' as const,
    maxSuggestions: 20,
    query: 'A moving shape',
    range: { start: 2, end: 3 }
  }
  const ready = async () => ({ ready: true, message: 'Test runtime' })
  it('maps to bounded review candidates, retains close events, and limits shot names', () => {
    const result = qwenCandidates(
      [
        { start: 0.1, end: 0.3, label: 'x'.repeat(160), evidence: 'Seen', windowStart: 0 },
        { start: 1, end: 1.2, label: 'Other', evidence: 'Seen', windowStart: 0 }
      ],
      2
    )
    expect(result).toHaveLength(2)
    expect(result[0].label).toHaveLength(120)
    expect(result[0].start).toBe(0)
    expect(result[0].end).toBe(2)
  })
  it('validates new options while loading legacy settings and reporting missing model packs', async () => {
    expect(ScanOptionsSchema.parse({ profile: 'general' }).engine).toBeUndefined()
    expect(ScanOptionsSchema.safeParse({ ...options, query: 'x'.repeat(2001) }).success).toBe(false)
    expect(ScanOptionsSchema.safeParse({ ...options, range: { start: 5, end: 1 } }).success).toBe(
      false
    )
    expect((await getQwenStatus(join(folder, 'missing'))).ready).toBe(false)
  })
  it('reuses validated per-window caches and invalidates them for another search', async () => {
    let calls = 0,
      starts = 0
    const runtime = () => ({
      async start() {
        starts++
      },
      async stop() {},
      async analyze() {
        calls++
        return {
          result: {
            summary: 'Shape moving',
            match_found: true,
            events: [{ start: 0.2, end: 0.5, label: 'Motion', evidence: 'A visible shape moves' }]
          }
        }
      }
    })
    const cache = join(folder, 'cached')
    const first = await scanQwenHighlights(
      media,
      options,
      cache,
      new AbortController().signal,
      () => {},
      folder,
      runtime,
      ready
    )
    expect(first[0].peak).toBeCloseTo(2.2)
    await scanQwenHighlights(
      media,
      options,
      cache,
      new AbortController().signal,
      () => {},
      folder,
      runtime,
      ready
    )
    expect(calls).toBe(1)
    expect(starts).toBe(1)
    await scanQwenHighlights(
      media,
      { ...options, query: 'Different action' },
      cache,
      new AbortController().signal,
      () => {},
      folder,
      runtime,
      ready
    )
    expect(calls).toBe(2)
  })
  it('keeps completed-window candidates on cancellation and cleans temporary snippets', async () => {
    const controller = new AbortController()
    let stopped = false,
      partial = 0
    const runtime = () => ({
      async start() {},
      async stop() {
        stopped = true
      },
      async analyze() {
        return {
          result: {
            summary: 'Observed',
            match_found: true,
            events: [{ start: 1, end: 2, label: 'Action', evidence: 'Visible action' }]
          }
        }
      }
    })
    const cache = join(folder, 'cancelled')
    await expect(
      scanQwenHighlights(
        media,
        { ...options, range: { start: 0, end: 12 } },
        cache,
        controller.signal,
        (value) => {
          if (value.suggestions) {
            partial = value.suggestions.length
            controller.abort()
          }
        },
        folder,
        runtime,
        ready
      )
    ).rejects.toThrow()
    expect(partial).toBe(1)
    expect(stopped).toBe(true)
    const cached = join(cache, (await readdir(cache))[0])
    expect((await readdir(cached)).some((name) => name.startsWith('working-'))).toBe(false)
  })
  it('rejects invalid model timing and does not cache it', async () => {
    const runtime = () => ({
      async start() {},
      async stop() {},
      async analyze() {
        return {
          result: {
            summary: 'Invalid',
            match_found: true,
            events: [{ start: 0, end: 99, label: 'Wrong', evidence: 'Wrong' }]
          }
        }
      }
    })
    await expect(
      scanQwenHighlights(
        media,
        options,
        join(folder, 'invalid'),
        new AbortController().signal,
        () => {},
        folder,
        runtime,
        ready
      )
    ).rejects.toThrow('exceeds window')
  })
})
