import { z } from 'zod'
import profileData from './highlight-profiles.json'

export const HighlightProfileSchema = z.enum(['general', 'football', 'gaming'])
export type HighlightProfile = z.infer<typeof HighlightProfileSchema>
export const highlightProfiles = profileData
export const ScanOptionsSchema = z.object({
  engine: z.enum(['clip', 'qwen']).optional(),
  query: z.string().trim().max(2000).optional(),
  range: z
    .object({ start: z.number().finite().nonnegative(), end: z.number().finite().positive() })
    .refine((value) => value.end > value.start, 'Scan end must be after start')
    .optional(),
  profile: HighlightProfileSchema,
  sensitivity: z.enum(['balanced', 'more', 'fewer']).default('balanced'),
  maxSuggestions: z.number().int().min(1).max(50).default(20)
})
export type ScanOptions = z.infer<typeof ScanOptionsSchema>
export const HighlightSuggestionSchema = z.object({
  id: z.string().uuid(),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
  peak: z.number().finite().nonnegative(),
  label: z.string(),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  status: z.enum(['pending', 'accepted', 'dismissed']).default('pending')
})
export type HighlightSuggestion = z.infer<typeof HighlightSuggestionSchema>
export const HighlightScanSchema = z.object({
  projectId: z.string().uuid(),
  sourceKey: z.string(),
  options: ScanOptionsSchema,
  status: z.enum(['running', 'completed', 'cancelled', 'failed', 'interrupted']),
  phase: z.enum(['preparing', 'audio', 'visual', 'ranking', 'done']),
  progress: z.number().min(0).max(1),
  detail: z.string().max(500).optional(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  error: z.string().optional(),
  suggestions: z.array(HighlightSuggestionSchema)
})
export type HighlightScan = z.infer<typeof HighlightScanSchema>
export interface VisualSample {
  time: number
  semantic: number
  label?: string
  motion: number
  change: number
}

const clamp = (x: number) => Math.max(0, Math.min(1, x))
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let product = 0,
    aa = 0,
    bb = 0
  for (let i = 0; i < a.length; i++) {
    product += a[i] * b[i]
    aa += a[i] ** 2
    bb += b[i] ** 2
  }
  return aa && bb ? product / Math.sqrt(aa * bb) : 0
}

export function buildSuggestions(
  samples: VisualSample[],
  audio: number[],
  duration: number,
  options: ScanOptions,
  uuid: () => string
): HighlightSuggestion[] {
  if (!samples.length || duration <= 0) return []
  const threshold = { balanced: 0.29, more: 0.18, fewer: 0.43 }[options.sensitivity]
  const scored = samples
    .map((sample, index) => {
      // Audio is relative to nearby sound levels; a loud recording is not itself a highlight.
      const second = Math.floor(sample.time),
        nearby = audio.slice(Math.max(0, second - 20), Math.min(audio.length, second + 21))
      const baseline = nearby.length
        ? [...nearby].sort((a, b) => a - b)[Math.floor(nearby.length / 2)]
        : 0
      const sound = audio.length
        ? clamp(((audio[second] || 0) - baseline) / Math.max(0.025, baseline * 2))
        : 0
      const motion = clamp(sample.motion / 0.18),
        change = clamp(sample.change / 0.32)
      const previous = samples[index - 1],
        next = samples[index + 1]
      const visual = Math.max(
        sample.semantic,
        (previous?.semantic || 0) * 0.75,
        (next?.semantic || 0) * 0.75
      )
      const temporalEvidence = sample.motion >= 0.004 || sample.change >= 0.01 || sound >= 0.4
      const score = temporalEvidence
        ? clamp(visual * 0.52 + motion * 0.25 + sound * 0.15 + change * 0.1)
        : 0
      const reasons: string[] = []
      if (sample.label && sample.semantic >= 0.32)
        reasons.push(`Visual match: ${sample.label.toLowerCase()}`)
      if (motion >= 0.45) reasons.push('Strong visual activity')
      if (sound >= 0.45) reasons.push('Audio energy above nearby levels')
      if (change >= 0.55) reasons.push('Scene transition')
      return { sample, score, reasons }
    })
    .filter((item) => item.score >= threshold && item.reasons.length)
  scored.sort((a, b) => b.score - a.score || a.sample.time - b.sample.time)
  const suggestions: HighlightSuggestion[] = []
  for (const item of scored) {
    const start = Math.max(0, item.sample.time - 10),
      end = Math.min(duration, item.sample.time + 10)
    if (end - start < Math.min(2, duration)) continue
    // One proposed reel per nearby burst of activity, with context on either side.
    if (
      suggestions.some(
        (clip) =>
          Math.abs(clip.peak - item.sample.time) < 22 ||
          Math.min(clip.end, end) - Math.max(clip.start, start) > 4
      )
    )
      continue
    suggestions.push({
      id: uuid(),
      start,
      end,
      peak: item.sample.time,
      label:
        item.sample.label && item.sample.semantic >= 0.32
          ? item.sample.label
          : 'Activity candidate',
      score: Math.round(item.score * 100),
      reasons: item.reasons,
      status: 'pending'
    })
    if (suggestions.length >= options.maxSuggestions) break
  }
  return suggestions
}
