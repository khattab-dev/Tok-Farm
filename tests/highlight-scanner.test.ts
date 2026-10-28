import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from '../src/main/storage'
import { HighlightScanner } from '../src/main/highlight-scanner'
import { CancelledError } from '../src/main/media'
import type { Project } from '../src/shared/model'
import type { HighlightSuggestion } from '../src/shared/highlights'
import { resolveFraming } from '../src/shared/framing'

const options = {
  profile: 'general' as const,
  sensitivity: 'balanced' as const,
  maxSuggestions: 20
}
async function until(check: () => boolean) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > 10000) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
describe('highlight scan lifecycle', () => {
  let directory: string, store: Store, project: Project
  const suggestion = (): HighlightSuggestion => ({
    id: randomUUID(),
    start: 10,
    end: 30,
    peak: 20,
    label: 'Activity candidate',
    score: 45,
    reasons: ['Strong visual activity'],
    status: 'pending'
  })
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tokfarm-scanner-'))
    store = new Store(directory)
    await store.load()
    const path = join(directory, 'source.mp4')
    await writeFile(path, 'fake source for lifecycle tests')
    const info = await stat(path)
    project = {
      version: 1,
      id: randomUUID(),
      name: 'Video',
      createdAt: 1,
      updatedAt: 1,
      outputDirectory: '',
      clips: [],
      media: {
        path,
        name: 'source.mp4',
        duration: 60,
        width: 1920,
        height: 1080,
        fps: 30,
        fpsExpression: '30/1',
        codec: 'h264',
        hasAudio: false,
        rotation: 0,
        size: info.size,
        modifiedAt: info.mtimeMs
      }
    }
    store.projects.push(project)
    await store.persist()
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  it('saves suggestions separately from editor autosaves and adds an approved suggestion as an editable shot', async () => {
    const item = suggestion(),
      scanner = new HighlightScanner(
        store,
        directory,
        () => {},
        async () => [item]
      )
    await scanner.start(project.id, options)
    await until(() => scanner.get(project.id)?.status === 'completed')
    const edited = {
      ...project,
      name: 'My renamed recording',
      framing: resolveFraming({ mode: 'fit', aspectRatio: '1:1', positionY: 0.7 })
    }
    await store.saveProject(edited)
    expect(scanner.get(project.id)?.suggestions).toHaveLength(1)
    const clip = await scanner.accept(edited, item.id)
    expect(clip.start).toBe(10)
    expect(clip.keyframes).toHaveLength(1)
    expect(clip.framing).toEqual(edited.framing)
    expect(clip.keyframes[0].y).toBe(0.7)
    const saved = store.getProject(project.id)
    expect(saved.name).toBe('My renamed recording')
    expect(saved.clips).toHaveLength(1)
    await scanner.accept(structuredClone(saved), item.id)
    expect(store.getProject(project.id).clips).toHaveLength(1)
    const restored = new Store(directory)
    await restored.load()
    expect(restored.scans[0].suggestions[0].status).toBe('accepted')
  })
  it('dismisses candidates without creating or deleting user shots', async () => {
    const item = suggestion(),
      scanner = new HighlightScanner(
        store,
        directory,
        () => {},
        async () => [item]
      )
    await scanner.start(project.id, options)
    await until(() => scanner.get(project.id)?.status === 'completed')
    await scanner.dismiss(project.id, item.id)
    expect(scanner.get(project.id)?.suggestions[0].status).toBe('dismissed')
    expect(store.getProject(project.id).clips).toHaveLength(0)
  })
  it('prevents overlapping scans and cancels an active scan', async () => {
    const scanner = new HighlightScanner(
      store,
      directory,
      () => {},
      async (_media, _options, _cache, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new CancelledError()), { once: true })
        })
    )
    const first = scanner.start(project.id, options)
    await expect(scanner.start(project.id, options)).rejects.toThrow('already running')
    await first
    await scanner.cancel(project.id)
    expect(scanner.get(project.id)?.status).toBe('cancelled')
  })
  it('reports engine failures and restores running scans as interrupted', async () => {
    const scanner = new HighlightScanner(
      store,
      directory,
      () => {},
      async () => {
        throw new Error('Model failed to load')
      }
    )
    await scanner.start(project.id, options)
    await until(() => scanner.get(project.id)?.status === 'failed')
    expect(scanner.get(project.id)?.error).toContain('Model failed')
    store.scans[0].status = 'running'
    await store.persist()
    const restored = new Store(directory)
    await restored.load()
    expect(restored.scans[0].status).toBe('interrupted')
    expect(restored.projects[0].id).toBe(project.id)
  })
  it('rejects outdated suggestions when source contents change', async () => {
    const item = suggestion(),
      scanner = new HighlightScanner(
        store,
        directory,
        () => {},
        async () => [item]
      )
    await scanner.start(project.id, options)
    await until(() => scanner.get(project.id)?.status === 'completed')
    await writeFile(project.media.path, 'changed source contents')
    await expect(scanner.accept(project, item.id)).rejects.toThrow('changed')
  })
  it('loads version 1.0 libraries without deleting projects', async () => {
    await writeFile(store.file, JSON.stringify({ version: 1, projects: [project], jobs: [] }))
    const restored = new Store(directory)
    await restored.load()
    expect(restored.projects[0].id).toBe(project.id)
    expect(restored.scans).toEqual([])
  })
  it('saves an active scan as interrupted when the app closes', async () => {
    const scanner = new HighlightScanner(
      store,
      directory,
      () => {},
      async (_media, _options, _cache, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new CancelledError()), { once: true })
        })
    )
    await scanner.start(project.id, options)
    await scanner.shutdown()
    const restored = new Store(directory)
    await restored.load()
    expect(restored.scans[0].status).toBe('interrupted')
    expect(restored.projects[0].clips).toEqual([])
  })
})
