import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from '../src/main/storage'
import { ExportQueue, type ExportWorker } from '../src/main/queue'
import { CancelledError } from '../src/main/media'
import type { Project } from '../src/shared/model'

export function fixtureProject(): Project {
  return {
    version: 1,
    id: randomUUID(),
    name: 'Match',
    createdAt: 1,
    updatedAt: 1,
    outputDirectory: tmpdir(),
    media: {
      path: 'source.mp4',
      name: 'source.mp4',
      duration: 2700,
      width: 1920,
      height: 1080,
      fps: 30,
      fpsExpression: '30/1',
      codec: 'h264',
      hasAudio: true,
      rotation: 0,
      size: 1,
      modifiedAt: 1
    },
    clips: ['Goal', 'Save', 'Counter'].map((name, index) => ({
      id: randomUUID(),
      name,
      start: index * 10,
      end: index * 10 + 5,
      muted: false,
      keyframes: []
    }))
  }
}
const until = async (condition: () => boolean) => {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > 5000) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('persistent export queue', () => {
  let directory: string, store: Store
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tokfarm-queue-'))
    store = new Store(directory)
    await store.load()
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  it('requires explicit start, snapshots clips, reorders pending work, and continues after failures', async () => {
    const seen: string[] = []
    const queue = new ExportQueue(
      store,
      () => {},
      async (job) => {
        seen.push(job.clip.name)
        if (job.clip.name === 'Save') throw new Error('Broken source')
        return `${job.clip.name}.mp4`
      }
    )
    const project = fixtureProject()
    await queue.enqueue(
      project,
      project.clips.map((clip) => clip.id)
    )
    expect(seen).toEqual([])
    project.clips[0].name = 'Edited later'
    await queue.action('up', store.queue.jobs[2].id)
    await queue.action('start')
    await until(() => !store.queue.running)
    expect(seen).toEqual(['Goal', 'Counter', 'Save'])
    expect(store.queue.jobs.map((job) => job.status)).toEqual(['completed', 'completed', 'failed'])
    await queue.action('retry', store.queue.jobs[2].id)
    expect(store.queue.jobs[2].status).toBe('pending')
  })
  it('pauses after active work and cancels active work without blocking the next job', async () => {
    let finish: (() => void) | undefined
    const finishers = new Map<string, () => void>()
    const worker: ExportWorker = (job, signal) =>
      new Promise((resolve, reject) => {
        finish = () => resolve('output.mp4')
        finishers.set(job.id, finish)
        signal.addEventListener('abort', () => reject(new CancelledError()), { once: true })
      })
    const queue = new ExportQueue(store, () => {}, worker),
      project = fixtureProject()
    await queue.enqueue(
      project,
      project.clips.map((clip) => clip.id)
    )
    await queue.action('start')
    await until(() => !!finish)
    await queue.action('pause')
    finish!()
    await until(() => store.queue.jobs[0].status === 'completed')
    expect(store.queue.jobs[1].status).toBe('pending')
    finish = undefined
    await queue.action('start')
    await until(() => !!finish)
    await queue.action('cancel', store.queue.jobs[1].id)
    await until(
      () => store.queue.jobs[1].status === 'cancelled' && finishers.has(store.queue.jobs[2].id)
    )
    finishers.get(store.queue.jobs[2].id)!()
    await until(() => !store.queue.running)
  })
  it('restores projects and pending jobs, flags interrupted jobs, and keeps queue paused', async () => {
    const project = fixtureProject()
    store.projects.push(project)
    const queue = new ExportQueue(store, () => {})
    await queue.enqueue(
      project,
      project.clips.map((clip) => clip.id)
    )
    store.queue.jobs[0].status = 'running'
    await store.persist()
    const restored = new Store(directory)
    await restored.load()
    expect(restored.projects).toEqual([project])
    expect(restored.queue.running).toBe(false)
    expect(restored.queue.jobs.map((job) => job.status)).toEqual([
      'interrupted',
      'pending',
      'pending'
    ])
  })
  it('serializes concurrent saves and preserves corrupt data for recovery', async () => {
    const project = fixtureProject()
    store.projects.push(project)
    const writes: Promise<void>[] = []
    for (let i = 0; i < 20; i++) {
      project.name = `Revision ${i}`
      writes.push(store.persist())
    }
    await Promise.all(writes)
    expect(JSON.parse(await readFile(store.file, 'utf8')).projects[0].name).toBe('Revision 19')
    await writeFile(store.file, 'broken json')
    const restored = new Store(directory)
    await restored.load()
    expect(restored.projects).toEqual([])
    const { readdir } = await import('node:fs/promises')
    expect((await readdir(directory)).some((name) => name.includes('.recovery-'))).toBe(true)
  })
  it('stops safely when a queue checkpoint cannot be saved and allows retry', async () => {
    const persist = store.persist.bind(store)
    let writes = 0,
      encoded = 0
    store.persist = async () => {
      if (++writes === 3) throw new Error('Disk full')
      return persist()
    }
    const project = fixtureProject(),
      queue = new ExportQueue(
        store,
        () => {},
        async () => {
          encoded++
          return 'output.mp4'
        }
      )
    await queue.enqueue(project, [project.clips[0].id])
    await queue.action('start')
    await until(() => store.queue.jobs[0].status === 'failed')
    expect(store.queue.running).toBe(false)
    expect(encoded).toBe(0)
    expect(store.queue.jobs[0].error).toContain('Disk full')
    await queue.action('retry', store.queue.jobs[0].id)
    await queue.action('start')
    await until(() => !store.queue.running)
    expect(store.queue.jobs[0].status).toBe('completed')
    expect(encoded).toBe(1)
  })
})
