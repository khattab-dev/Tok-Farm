import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  ASPECT_RATIOS,
  blurredBackgroundLayout,
  frameLayout,
  resolveFraming
} from '../src/shared/framing'
import { ClipSchema, FramingSchema } from '../src/shared/model'
import { panExpression } from '../src/shared/crop'

describe('shared preview/export framing geometry', () => {
  it('keeps the full source visible in Fit and crops it in Fill for every canvas', () => {
    for (const aspectRatio of Object.keys(ASPECT_RATIOS) as (keyof typeof ASPECT_RATIOS)[]) {
      for (const [w, h] of [
        [1920, 1080],
        [1080, 1920],
        [800, 800]
      ]) {
        for (const x of [0, 0.5, 1]) {
          const fit = frameLayout(w, h, resolveFraming({ aspectRatio, mode: 'fit' }), { x, y: x })
          expect(fit.width).toBeLessThanOrEqual(fit.canvas.width)
          expect(fit.height).toBeLessThanOrEqual(fit.canvas.height)
          expect(fit.visible).toEqual({ x: 0, y: 0, width: w, height: h })
          const fill = frameLayout(w, h, resolveFraming({ aspectRatio }), { x, y: x })
          expect(fill.width).toBeGreaterThanOrEqual(fill.canvas.width)
          expect(fill.height).toBeGreaterThanOrEqual(fill.canvas.height)
          expect(fill.visible.x).toBeGreaterThanOrEqual(0)
          expect(fill.visible.y).toBeGreaterThanOrEqual(0)
          expect(fill.visible.x + fill.visible.width).toBeLessThanOrEqual(w + 1e-6)
          expect(fill.visible.y + fill.visible.height).toBeLessThanOrEqual(h + 1e-6)
          expect(fill.x % 2).toBeCloseTo(0)
          expect(fill.y % 2).toBeCloseTo(0)
        }
      }
    }
  })
  it('uses all available padding or overflow for placement, including custom zoom', () => {
    const framing = resolveFraming({ mode: 'fit', zoom: 0.5 })
    const left = frameLayout(1920, 1080, framing, { x: 0, y: 0 })
    const right = frameLayout(1920, 1080, framing, { x: 1, y: 1 })
    expect(left.x).toBe(0)
    expect(left.y).toBe(0)
    expect(right.x + right.width).toBe(right.canvas.width)
    expect(right.y + right.height).toBe(right.canvas.height)
    const zoomed = frameLayout(1920, 1080, resolveFraming({ zoom: 3 }), { x: 1, y: 1 })
    expect(zoomed.visible.width).toBeLessThan(1920 / 3)
    expect(zoomed.visible.height).toBeCloseTo(1080 / 3)
    expect(panExpression([], 'x', 0, 0.27)).toBe('0.27')
  })
  it('overscans blurred backgrounds beyond all canvas edges', () => {
    for (const blur of [4, 30, 60]) {
      const back = blurredBackgroundLayout(1920, 1080, resolveFraming({ blur }))
      expect(back.x).toBeLessThanOrEqual(-blur * 3)
      expect(back.y).toBeLessThanOrEqual(-blur * 3)
      expect(back.x + back.width).toBeGreaterThanOrEqual(1080 + blur * 3 - 2)
      expect(back.y + back.height).toBeGreaterThanOrEqual(1920 + blur * 3 - 2)
    }
  })
  it('loads legacy clips with the original layout and rejects unsafe framing values', () => {
    const clip = { id: randomUUID(), name: 'Legacy', start: 0, end: 1, muted: false, keyframes: [] }
    expect(resolveFraming(ClipSchema.parse(clip).framing)).toMatchObject({
      aspectRatio: '9:16',
      mode: 'fill',
      zoom: 1
    })
    for (const patch of [
      { zoom: 0 },
      { zoom: NaN },
      { zoom: 4 },
      { positionX: 2 },
      { blur: 0 },
      { backgroundColor: 'red;movie=evil' },
      { aspectRatio: '3:2' }
    ]) {
      expect(FramingSchema.safeParse({ ...resolveFraming(), ...patch }).success).toBe(false)
    }
  })
})
