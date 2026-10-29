import { describe, expect, it } from 'vitest'
import {
  absoluteEvents,
  matchKnownEvents,
  mergeQwenEvents,
  videoWindows,
  type QwenEvent
} from '../src/shared/qwen'
const event = (start: number, end: number, windowStart: number, label = 'Goal'): QwenEvent => ({
  start,
  end,
  windowStart,
  label,
  evidence: 'Visible action'
})
describe('Qwen benchmark event processing', () => {
  it('covers the full range with overlapping windows, including a short final window', () => {
    expect(videoWindows(340, 363, 10, 2)).toEqual([
      { start: 340, end: 350 },
      { start: 348, end: 358 },
      { start: 356, end: 363 }
    ])
    for (const args of [
      [0, 10, 10, 10],
      [-1, 10, 10, 2],
      [10, 0, 10, 2],
      [0, 10, 0, 0],
      [0, NaN, 10, 2]
    ])
      expect(() => videoWindows(...(args as [number, number, number, number]))).toThrow()
  })
  it('validates model output and translates clip-relative times into source timestamps', () => {
    expect(
      absoluteEvents(
        {
          summary: 'Scoring play',
          match_found: true,
          events: [{ start: 5, end: 6, label: 'Goal', evidence: 'Ball crosses the line' }]
        },
        { start: 348, end: 358 }
      ).events[0]
    ).toMatchObject({ start: 353, end: 354 })
    expect(
      absoluteEvents({ summary: 'No event', match_found: false, events: [] }, { start: 0, end: 10 })
        .events
    ).toEqual([])
    for (const patch of [
      { start: -1, end: 2 },
      { start: 5, end: 4 },
      { start: 0, end: 11 },
      { start: NaN, end: 2 }
    ])
      expect(() =>
        absoluteEvents(
          {
            summary: '',
            match_found: true,
            events: [{ ...patch, label: 'Event', evidence: 'Observed' }]
          },
          { start: 0, end: 10 }
        )
      ).toThrow()
    expect(() =>
      absoluteEvents(
        { summary: '', match_found: false, events: [], command: 'do something' },
        { start: 0, end: 10 }
      )
    ).toThrow()
    expect(() =>
      absoluteEvents({ summary: 'No action', match_found: true, events: [] }, { start: 0, end: 10 })
    ).toThrow('Match decision')
  })
  it('deduplicates repeated observations across windows while retaining close separate actions', () => {
    const events = [
      event(353, 354, 348),
      event(353.5, 354, 352),
      event(356, 357, 352),
      event(358, 359, 352),
      event(353, 354, 348, 'Save')
    ]
    expect(mergeQwenEvents(events)).toHaveLength(4)
    expect(mergeQwenEvents(events).find((item) => item.label === 'Goal')).toMatchObject({
      start: 353,
      end: 354
    })
    expect(
      mergeQwenEvents([
        event(0, 0.5, 0, 'Rollout'),
        event(0.5, 1, 0, 'Rollout'),
        event(1, 2, 0, 'Rollout')
      ])
    ).toEqual([event(0, 2, 0, 'Rollout')])
  })
  it('matches ground truth one-to-one and leaves unmatched detections unreviewed', () => {
    const result = matchKnownEvents([event(353, 354, 348), event(360, 361, 356)], [353, 354, 380])
    expect(result.matchedKnownEvents).toBe(1)
    expect(result.recallOnProvidedEvents).toBe(1 / 3)
    expect(result.unmatchedDetections).toHaveLength(1)
    expect(matchKnownEvents([], []).recallOnProvidedEvents).toBeNull()
  })
})
