import { z } from 'zod'
import type { HighlightScan, ScanOptions } from './highlights'
import type { QwenStatus } from './qwen'

const finite = z.number().finite()
export const FramingSchema = z.object({
  aspectRatio: z.enum(['9:16', '4:5', '1:1', '16:9']),
  mode: z.enum(['fill', 'fit']),
  zoom: finite.min(0.25).max(3),
  background: z.enum(['blur', 'color']),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  blur: finite.min(4).max(60),
  positionX: finite.min(0).max(1),
  positionY: finite.min(0).max(1)
})
export const KeyframeSchema = z.object({
  id: z.string().uuid(),
  time: finite.nonnegative(),
  x: finite.min(0).max(1),
  y: finite.min(0).max(1)
})
export const ClipSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    start: finite.nonnegative(),
    end: finite.positive(),
    muted: z.boolean(),
    keyframes: z.array(KeyframeSchema).max(200),
    framing: FramingSchema.optional()
  })
  .refine((c) => c.end > c.start, 'End must be after start')
export const MediaSchema = z.object({
  path: z.string(),
  name: z.string(),
  duration: finite.positive(),
  width: finite.positive(),
  height: finite.positive(),
  fps: finite.positive(),
  fpsExpression: z.string(),
  codec: z.string(),
  hasAudio: z.boolean(),
  rotation: finite,
  size: finite.nonnegative(),
  modifiedAt: finite.nonnegative()
})
export const ProjectSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    createdAt: finite,
    updatedAt: finite,
    media: MediaSchema,
    clips: z.array(ClipSchema).max(1000),
    outputDirectory: z.string(),
    framing: FramingSchema.optional()
  })
  .refine(
    (p) => p.clips.every((c) => c.end <= p.media.duration + 0.001),
    'Shot exceeds video duration'
  )
export type CropKeyframe = z.infer<typeof KeyframeSchema>
export type Clip = z.infer<typeof ClipSchema>
export type Media = z.infer<typeof MediaSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectSummary = Pick<Project, 'id' | 'name' | 'updatedAt'> & {
  clipCount: number
  sourceName: string
}
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface ExportJob {
  id: string
  projectId: string
  projectName: string
  clip: Clip
  media: Media
  outputDirectory: string
  status: JobStatus
  progress: number
  outputPath?: string
  error?: string
  createdAt: number
}
export interface QueueState {
  version: 1
  running: boolean
  jobs: ExportJob[]
}
export interface Thumbnail {
  time: number
  url: string
}
export type AppEvent =
  | { type: 'queue'; queue: QueueState }
  | { type: 'proxy-progress'; projectId: string; progress: number }
  | { type: 'highlight-scan'; scan: HighlightScan }
export interface TokFarmAPI {
  bootstrap(): Promise<{ projects: ProjectSummary[]; project: Project | null; queue: QueueState }>
  importVideo(path?: string): Promise<Project | null>
  openProject(id: string): Promise<Project>
  saveProject(project: Project): Promise<void>
  relinkSource(id: string): Promise<Project | null>
  chooseOutputDirectory(): Promise<string | null>
  mediaUrl(projectId: string): Promise<string>
  thumbnails(projectId: string): Promise<Thumbnail[]>
  createProxy(projectId: string): Promise<string>
  cancelProxy(projectId: string): Promise<void>
  getHighlightScan(projectId: string): Promise<HighlightScan | null>
  getQwenStatus(): Promise<QwenStatus>
  chooseQwenFolder(): Promise<QwenStatus>
  startHighlightScan(projectId: string, options: ScanOptions): Promise<HighlightScan>
  cancelHighlightScan(projectId: string): Promise<void>
  acceptHighlight(project: Project, suggestionId: string): Promise<Clip>
  dismissHighlight(projectId: string, suggestionId: string): Promise<HighlightScan>
  enqueue(project: Project, clipIds: string[]): Promise<QueueState>
  queueAction(
    action: 'start' | 'pause' | 'cancel' | 'retry' | 'up' | 'down' | 'clear',
    jobId?: string
  ): Promise<QueueState>
  revealOutput(jobId: string): Promise<void>
  onEvent(callback: (event: AppEvent) => void): () => void
  droppedFilePath(file: File): string
}
