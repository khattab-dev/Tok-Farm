import { randomUUID } from 'node:crypto'
import type { Store } from './storage'
import type { Clip, Project } from '../shared/model'
import type { HighlightScan, ScanOptions } from '../shared/highlights'
import { highlightSourceKey, scanHighlights } from './highlight-engine'
import { assertSource } from './media'
import { resolveFraming } from '../shared/framing'

export class HighlightScanner {
  private active?: { projectId: string; controller: AbortController; task: Promise<void> }
  private closing = false
  private starting = false
  constructor(
    private store: Store,
    private cacheRoot: string,
    private emit: (scan: HighlightScan) => void,
    private engine: typeof scanHighlights = scanHighlights
  ) {}
  get(projectId: string) {
    return this.store.scans.find((scan) => scan.projectId === projectId) || null
  }
  async start(projectId: string, options: ScanOptions) {
    if (this.active)
      throw new Error(
        `A highlight scan is already running for ${this.store.getProject(this.active.projectId).name}. Open that project to cancel it.`
      )
    if (this.starting)
      throw new Error('A highlight scan is already running. Cancel it before starting another.')
    if (this.closing) throw new Error('The app is closing.')
    this.starting = true
    try {
      const project = this.store.getProject(projectId)
      if (
        options.engine === 'qwen' &&
        options.range &&
        options.range.end > project.media.duration + 0.001
      )
        throw new Error(
          'Scan range exceeds the source video. Use video timestamps, not the match clock.'
        )
      await assertSource(project.media)
      const scan: HighlightScan = {
        projectId,
        sourceKey: highlightSourceKey(project.media),
        options,
        status: 'running',
        phase: 'preparing',
        progress: 0,
        startedAt: Date.now(),
        suggestions: []
      }
      this.store.scans = this.store.scans.filter((item) => item.projectId !== projectId)
      this.store.scans.push(scan)
      await this.store.persist()
      this.emit(structuredClone(scan))
      const controller = new AbortController()
      // Reserve the scanner synchronously before launching asynchronous inference.
      const active = { projectId, controller, task: Promise.resolve() }
      this.active = active
      active.task = this.run(scan, controller)
      return structuredClone(scan)
    } finally {
      this.starting = false
    }
  }
  private async run(scan: HighlightScan, controller: AbortController) {
    let lastUpdate = 0
    try {
      scan.suggestions = await this.engine(
        this.store.getProject(scan.projectId).media,
        scan.options,
        this.cacheRoot,
        controller.signal,
        (value) => {
          scan.phase = value.phase
          scan.progress = value.progress
          scan.detail = value.detail
          if (value.suggestions) scan.suggestions = value.suggestions
          if (Date.now() - lastUpdate > 250) {
            lastUpdate = Date.now()
            this.emit(structuredClone(scan))
          }
        }
      )
      scan.status = 'completed'
      scan.phase = 'done'
      scan.progress = 1
    } catch (error) {
      scan.status = this.closing
        ? 'interrupted'
        : controller.signal.aborted
          ? 'cancelled'
          : 'failed'
      scan.error = scan.status === 'failed' ? (error as Error).message : undefined
    } finally {
      scan.finishedAt = Date.now()
      this.active = undefined
      try {
        await this.store.persist()
      } catch (error) {
        scan.status = 'failed'
        scan.error = `Could not save scan results: ${(error as Error).message}`
      }
      this.emit(structuredClone(scan))
    }
  }
  async cancel(projectId: string) {
    if (this.active?.projectId === projectId) {
      this.active.controller.abort()
      await this.active.task
    }
  }
  async accept(project: Project, suggestionId: string): Promise<Clip> {
    await assertSource(project.media)
    await this.store.saveProject(project)
    const scan = this.get(project.id),
      suggestion = scan?.suggestions.find((item) => item.id === suggestionId)
    if (!scan || !suggestion || scan.sourceKey !== highlightSourceKey(project.media))
      throw new Error('This suggestion is no longer valid. Scan the current source again.')
    const current = this.store.getProject(project.id),
      existing = current.clips.find((clip) => clip.id === suggestionId)
    if (existing) {
      suggestion.status = 'accepted'
      await this.store.persist()
      this.emit(structuredClone(scan))
      return existing
    }
    if (current.clips.length >= 1000) throw new Error('This project already has 1,000 shots.')
    const clip: Clip = {
      id: suggestion.id,
      name: suggestion.label,
      start: suggestion.start,
      end: suggestion.end,
      muted: false,
      framing: resolveFraming(current.framing),
      keyframes: [
        {
          id: randomUUID(),
          time: suggestion.start,
          x: current.framing?.positionX ?? 0.5,
          y: current.framing?.positionY ?? 0.5
        }
      ]
    }
    current.clips.push(clip)
    current.updatedAt = Date.now()
    suggestion.status = 'accepted'
    await this.store.persist()
    this.emit(structuredClone(scan))
    return clip
  }
  async dismiss(projectId: string, suggestionId: string) {
    const scan = this.get(projectId),
      suggestion = scan?.suggestions.find((item) => item.id === suggestionId)
    if (!scan || !suggestion) throw new Error('Suggestion not found.')
    suggestion.status = 'dismissed'
    await this.store.persist()
    this.emit(structuredClone(scan))
    return scan
  }
  async shutdown() {
    this.closing = true
    if (this.active) {
      this.active.controller.abort()
      await this.active.task
    }
  }
}
