import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  buildSuggestions,
  cosine,
  ScanOptionsSchema,
  type VisualSample
} from '../src/shared/highlights'

const settings = {
  profile: 'general' as const,
  sensitivity: 'balanced' as const,
  maxSuggestions: 20
}
const sample = (time: number, update: Partial<VisualSample> = {}): VisualSample => ({
  time,
  semantic: 0,
  motion: 0,
  change: 0,
  ...update
})
describe('reviewable highlight candidates', () => {
  it('does not manufacture highlights from quiet static footage', () => {
    expect(
      buildSuggestions(
        Array.from({ length: 30 }, (_, i) => sample(i * 2)),
        [],
        60,
        settings,
        randomUUID
      )
    ).toEqual([])
  })
  it('detects activity without requiring an audio track', () => {
    const result = buildSuggestions(
      [sample(20, { motion: 0.2, change: 0.4 }), sample(44, { motion: 0.2, change: 0.4 })],
      [],
      60,
      settings,
      randomUUID
    )
    expect(result).toHaveLength(2)
    expect(result[0].reasons).toContain('Strong visual activity')
    expect(result.every((clip) => clip.status === 'pending')).toBe(true)
  })
  it('deduplicates nearby activity and respects the maximum number of results', () => {
    const samples = [10, 12, 14, 40, 42, 80].map((time) =>
      sample(time, { semantic: 0.9, label: 'Action candidate', motion: 0.02 })
    )
    const result = buildSuggestions(
      samples,
      [],
      100,
      { ...settings, maxSuggestions: 2 },
      randomUUID
    )
    expect(result).toHaveLength(2)
    expect(Math.abs(result[0].peak - result[1].peak)).toBeGreaterThanOrEqual(22)
    expect(new Set(result.map((clip) => clip.id)).size).toBe(2)
  })
  it('keeps pre-roll and post-roll inside the source duration', () => {
    const result = buildSuggestions(
      [sample(1, { semantic: 1, label: 'Action candidate', motion: 0.02 })],
      [],
      6,
      settings,
      randomUUID
    )
    expect(result[0].start).toBe(0)
    expect(result[0].end).toBe(6)
  })
  it('does not treat sustained loudness as an event, or give activity a false event label', () => {
    const result = buildSuggestions(
      [sample(20, { label: 'Goalkeeper action', semantic: 0.01, motion: 0.2, change: 0.4 })],
      Array(60).fill(0.5),
      60,
      settings,
      randomUUID
    )
    expect(result[0].label).toBe('Activity candidate')
    expect(result[0].reasons.some((reason) => reason.includes('Audio'))).toBe(false)
    expect(buildSuggestions([sample(20)], Array(60).fill(0.5), 60, settings, randomUUID)).toEqual(
      []
    )
  })
  it('uses a score for ranking rather than a calibrated probability', () => {
    const result = buildSuggestions(
      [sample(20, { semantic: 0.8, label: 'Celebration candidate', motion: 0.02 })],
      [],
      60,
      settings,
      randomUUID
    )
    expect(result[0].label).toBe('Celebration candidate')
    expect(result[0].score).toBeLessThan(100)
    expect(cosine([1, 0], [1, 0])).toBe(1)
    expect(cosine([0, 0], [1, 0])).toBe(0)
  })
  it('validates scan options and applies meaningful sensitivity thresholds', () => {
    expect(ScanOptionsSchema.safeParse({ ...settings, profile: 'unknown' }).success).toBe(false)
    expect(ScanOptionsSchema.safeParse({ ...settings, maxSuggestions: 10000 }).success).toBe(false)
    const frames = [sample(20, { motion: 0.15, change: 0.15 })]
    expect(
      buildSuggestions(frames, [], 60, { ...settings, sensitivity: 'more' }, randomUUID)
    ).toHaveLength(1)
    expect(
      buildSuggestions(frames, [], 60, { ...settings, sensitivity: 'fewer' }, randomUUID)
    ).toHaveLength(0)
  })
  it('does not repeatedly suggest an unmoving poster even if its subject matches a prompt', () => {
    expect(
      buildSuggestions(
        Array.from({ length: 50 }, (_, i) =>
          sample(i * 2, { semantic: 0.95, label: 'Celebration candidate' })
        ),
        [],
        100,
        settings,
        randomUUID
      )
    ).toEqual([])
  })
})
