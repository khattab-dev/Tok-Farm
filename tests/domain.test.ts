import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  cropGeometry,
  panExpression,
  parseTimecode,
  positionAt,
  timecode
} from '../src/shared/crop'
import { ClipSchema, type CropKeyframe } from '../src/shared/model'
import { safeFilename } from '../src/main/media'

const point = (time: number, x: number, y = 0.5): CropKeyframe => ({ id: randomUUID(), time, x, y })
describe('source-time crop positions', () => {
  it('holds endpoints and interpolates sorted positions', () => {
    const keys = [point(20, 1), point(10, 0)]
    expect(positionAt(keys, 0).x).toBe(0)
    expect(positionAt(keys, 15).x).toBe(0.5)
    expect(positionAt(keys, 30).x).toBe(1)
    expect(positionAt([], 0)).toEqual({ x: 0.5, y: 0.5 })
  })
  it('retains source anchoring after trim changes', () => {
    const keys = [point(100, 0), point(110, 1)]
    expect(positionAt(keys, 104).x).toBeCloseTo(0.4)
    expect(panExpression(keys, 'x', 104)).toContain('t-(-4)')
    expect(panExpression([point(3, 0), point(3, 1)], 'x', 0)).not.toContain('/0')
    expect(positionAt([point(3, 0), point(3, 1)], 3).x).toBe(1)
  })
  it('keeps crops within even source bounds for landscape and portrait', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [360, 640],
      [800, 800]
    ]) {
      for (const pos of [0, 0.5, 1]) {
        const crop = cropGeometry(w, h, pos, pos)
        expect(crop.x).toBeGreaterThanOrEqual(0)
        expect(crop.x + crop.width).toBeLessThanOrEqual(w)
        expect(crop.y + crop.height).toBeLessThanOrEqual(h)
        expect(crop.width % 2).toBe(0)
        expect(crop.height % 2).toBe(0)
      }
    }
  })
})
describe('timestamps and validation', () => {
  it('round-trips timecode including long videos and milliseconds', () => {
    for (const t of [0, 59.999, 2700.125, 5400.6, 363600])
      expect(parseTimecode(timecode(t, true))).toBeCloseTo(t, 3)
    expect(parseTimecode('1:75:00')).toBeNull()
    expect(parseTimecode('NaN')).toBeNull()
  })
  it('rejects reversed trim and invalid crop data', () => {
    const clip = { id: randomUUID(), name: 'Goal', start: 10, end: 5, muted: false, keyframes: [] }
    expect(ClipSchema.safeParse(clip).success).toBe(false)
    expect(ClipSchema.safeParse({ ...clip, end: 15, keyframes: [point(10, 2)] }).success).toBe(
      false
    )
    expect(ClipSchema.safeParse({ ...clip, start: NaN, end: 15 }).success).toBe(false)
  })
  it('sanitizes reserved Windows names and unsafe filenames', () => {
    expect(safeFilename('CON')).toBe('_CON')
    expect(safeFilename('Goal / attempt: 1?')).toBe('Goal - attempt- 1-')
    expect(safeFilename('...')).toBe('Reel')
    expect(safeFilename('هدف رائع')).toBe('هدف رائع')
  })
})
