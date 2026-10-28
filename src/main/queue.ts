import { randomUUID } from 'node:crypto'
import type { ExportJob, Project, QueueState } from '../shared/model'
import type { Store } from './storage'
import { CancelledError, exportClip } from './media'

export type ExportWorker = (
  job: ExportJob,
  signal: AbortSignal,
  progress: (p: number) => void
) => Promise<string>
export class ExportQueue {
  private busy = false
  private active?: { jobId: string; controller: AbortController }
  private lastProgress = 0
  private shuttingDown = false
  constructor(
    private store: Store,
    private emit: (state: QueueState) => void,
    private worker: ExportWorker = (job, signal, progress) =>
      exportClip(job.media, job.clip, job.outputDirectory, signal, progress, job.id)
  ) {}
  private async commit() {
    await this.store.persist()
    this.emit(structuredClone(this.store.queue))
  }
  async enqueue(project: Project, clipIds: string[]) {
    if (!project.outputDirectory) throw new Error('Choose an export folder first.')
    const clips = project.clips.filter((clip) => clipIds.includes(clip.id))
    if (!clips.length) throw new Error('Select at least one shot to queue.')
    this.store.queue.jobs.push(
      ...clips.map((clip) => ({
        id: randomUUID(),
        projectId: project.id,
        projectName: project.name,
        clip: structuredClone(clip),
        media: structuredClone(project.media),
        outputDirectory: project.outputDirectory,
        status: 'pending' as const,
        progress: 0,
        createdAt: Date.now()
      }))
    )
    await this.commit()
    this.kick()
    return structuredClone(this.store.queue)
  }
  async action(action: string, jobId?: string) {
    const queue = this.store.queue
    const job = queue.jobs.find((item) => item.id === jobId)
    if (action === 'start') queue.running = true
    else if (action === 'pause') queue.running = false
    else if (action === 'clear')
      queue.jobs = queue.jobs.filter((item) => ['running', 'pending'].includes(item.status))
    else if (!job) throw new Error('Queue item not found.')
    else if (action === 'cancel') {
      if (job.status === 'running') this.active?.controller.abort()
      else if (job.status === 'pending') {
        job.status = 'cancelled'
        job.error = undefined
      }
    } else if (action === 'retry' && ['failed', 'cancelled', 'interrupted'].includes(job.status)) {
      job.status = 'pending'
      job.progress = 0
      job.error = undefined
      job.outputPath = undefined
    } else if ((action === 'up' || action === 'down') && job.status === 'pending') {
      const pending = queue.jobs.filter((item) => item.status === 'pending')
      const other = pending[pending.indexOf(job) + (action === 'up' ? -1 : 1)]
      if (other) {
        const a = queue.jobs.indexOf(job),
          b = queue.jobs.indexOf(other)
        ;[queue.jobs[a], queue.jobs[b]] = [queue.jobs[b], queue.jobs[a]]
      }
    }
    await this.commit()
    this.kick()
    return structuredClone(queue)
  }
  private kick() {
    void this.pump().catch((error) => {
      console.error('Queue persistence error:', error)
      this.store.queue.running = false
      const job = this.store.queue.jobs.find((item) => item.id === this.active?.jobId)
      this.active?.controller.abort()
      if (job?.status === 'running') {
        job.status = 'failed'
        job.error = `Could not save export state: ${(error as Error).message}`
        job.progress = 0
      }
      this.active = undefined
      this.emit(structuredClone(this.store.queue))
      void this.store.persist().catch(() => {})
    })
  }
  private async pump() {
    if (this.busy || !this.store.queue.running) return
    this.busy = true
    try {
      while (this.store.queue.running) {
        const job = this.store.queue.jobs.find((item) => item.status === 'pending')
        if (!job) {
          this.store.queue.running = false
          await this.commit()
          break
        }
        const controller = new AbortController()
        this.active = { jobId: job.id, controller }
        job.status = 'running'
        job.error = undefined
        job.progress = 0
        await this.commit()
        try {
          job.outputPath = await this.worker(job, controller.signal, (progress) => {
            job.progress = Math.max(0, Math.min(0.99, progress))
            if (Date.now() - this.lastProgress > 200) {
              this.lastProgress = Date.now()
              this.emit(structuredClone(this.store.queue))
            }
          })
          job.status = 'completed'
          job.progress = 1
        } catch (error) {
          job.status = this.shuttingDown
            ? 'interrupted'
            : error instanceof CancelledError || controller.signal.aborted
              ? 'cancelled'
              : 'failed'
          job.error =
            job.status === 'cancelled'
              ? undefined
              : this.shuttingDown
                ? 'App closed during export. Retry to start this reel again.'
                : (error as Error).message
          job.progress = 0
        }
        this.active = undefined
        await this.commit()
      }
    } finally {
      this.busy = false
    }
  }
  async shutdown() {
    this.shuttingDown = true
    this.store.queue.running = false
    if (this.active) {
      const job = this.store.queue.jobs.find((item) => item.id === this.active?.jobId)
      this.active.controller.abort()
      if (job) {
        job.status = 'interrupted'
        job.progress = 0
        job.error = 'App closed during export. Retry to start this reel again.'
      }
    }
    await this.commit()
  }
}
