import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Store } from './storage'
import { ExportQueue } from './queue'
import { HighlightScanner } from './highlight-scanner'
import { ScanOptionsSchema } from '../shared/highlights'
import { assertSource, generateProxy, generateThumbnails, probeMedia } from './media'
import { ProjectSchema, type AppEvent, type Project } from '../shared/model'

protocol.registerSchemesAsPrivileged([
  { scheme: 'tokfarm', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  {
    scheme: 'tokfarm-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])
if (process.env.TOKFARM_TEST_DATA) app.setPath('userData', resolve(process.env.TOKFARM_TEST_DATA))
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let window: BrowserWindow | null = null
let store: Store
let queue: ExportQueue
let scanner: HighlightScanner
let closing = false
const mediaGrants = new Map<string, string>()
const proxyTasks = new Map<string, AbortController>()
const thumbTasks = new Map<string, Promise<{ time: number; path: string }[]>>()
const idSchema = z.string().uuid()
const emit = (event: AppEvent) => {
  if (window && !window.isDestroyed()) window.webContents.send('app-event', event)
}

function grant(path: string) {
  const found = [...mediaGrants].find(([, value]) => value === path)
  const id = found?.[0] || randomUUID()
  mediaGrants.set(id, path)
  return `tokfarm-media://${id}/${encodeURIComponent(basename(path))}`
}

async function mediaResponse(request: Request): Promise<Response> {
  const path = mediaGrants.get(new URL(request.url).hostname)
  if (!path || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 })
  try {
    const info = await stat(path)
    const type =
      (
        {
          '.mp4': 'video/mp4',
          '.mov': 'video/quicktime',
          '.mkv': 'video/x-matroska',
          '.jpg': 'image/jpeg'
        } as Record<string, string>
      )[extname(path).toLowerCase()] || 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
    let start = 0,
      end = info.size - 1,
      status = 200
    const range = request.headers.get('range')
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${info.size}` }
        })
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]))
      else {
        start = Number(match[1])
        if (match[2]) end = Math.min(end, Number(match[2]))
      }
      if (start > end || start >= info.size)
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${info.size}` }
        })
      status = 206
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
    }
    headers['Content-Length'] = String(end - start + 1)
    const body =
      request.method === 'HEAD'
        ? null
        : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>)
    return new Response(body, { status, headers })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function handle(channel: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Untrusted app request.')
    try {
      return await callback(...args)
    } catch (error) {
      if (error instanceof z.ZodError)
        throw new Error(error.issues[0]?.message || 'Invalid request.')
      throw error
    }
  })
}

const summaries = () =>
  [...store.projects]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      clipCount: p.clips.length,
      sourceName: p.media.name
    }))
async function pickVideo() {
  const result = await dialog.showOpenDialog(window!, {
    title: 'Open video',
    properties: ['openFile'],
    filters: [{ name: 'Video files', extensions: ['mp4', 'mov', 'mkv'] }]
  })
  return result.canceled ? null : result.filePaths[0]
}

function setupHandlers(cache: string) {
  handle('bootstrap', () => ({
    projects: summaries(),
    project: [...store.projects].sort((a, b) => b.updatedAt - a.updatedAt)[0] || null,
    queue: store.queue
  }))
  handle('import-video', async (input?: unknown) => {
    const path = input === undefined ? await pickVideo() : z.string().min(1).max(32767).parse(input)
    if (!path) return null
    if (!['.mp4', '.mov', '.mkv'].includes(extname(path).toLowerCase()))
      throw new Error('Choose an MP4, MOV, or MKV video.')
    const media = await probeMedia(resolve(path))
    const project: Project = {
      version: 1,
      id: randomUUID(),
      name: basename(path, extname(path)).slice(0, 120),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      media,
      clips: [],
      outputDirectory: ''
    }
    store.projects.push(project)
    await store.persist()
    return project
  })
  handle('open-project', (input: unknown) => store.getProject(idSchema.parse(input)))
  handle('save-project', (input: unknown) => store.saveProject(input))
  handle('relink-source', async (input: unknown) => {
    const project = store.getProject(idSchema.parse(input)),
      path = await pickVideo()
    if (!path) return null
    const media = await probeMedia(path)
    if (
      media.width !== project.media.width ||
      media.height !== project.media.height ||
      Math.abs(media.duration - project.media.duration) > 0.25
    )
      throw new Error(
        'Choose the same source video. Its dimensions and duration must match the original.'
      )
    await scanner.cancel(project.id)
    store.scans = store.scans.filter((scan) => scan.projectId !== project.id)
    project.media = media
    project.updatedAt = Date.now()
    for (const job of store.queue.jobs) {
      if (job.projectId === project.id && !['running', 'completed'].includes(job.status))
        job.media = structuredClone(media)
    }
    await store.persist()
    emit({ type: 'queue', queue: store.queue })
    return project
  })
  handle('choose-output', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose export folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('media-url', async (input: unknown) => {
    const project = store.getProject(idSchema.parse(input))
    await assertSource(project.media)
    return grant(project.media.path)
  })
  handle('thumbnails', async (input: unknown) => {
    const project = store.getProject(idSchema.parse(input))
    if (!thumbTasks.has(project.id))
      thumbTasks.set(
        project.id,
        generateThumbnails(project.media, cache).finally(() => thumbTasks.delete(project.id))
      )
    return (await thumbTasks.get(project.id)!).map((item) => ({
      time: item.time,
      url: grant(item.path)
    }))
  })
  handle('create-proxy', async (input: unknown) => {
    const project = store.getProject(idSchema.parse(input))
    if (proxyTasks.has(project.id)) throw new Error('Preview conversion is already running.')
    const controller = new AbortController()
    proxyTasks.set(project.id, controller)
    try {
      return grant(
        await generateProxy(project.media, cache, controller.signal, (progress) =>
          emit({ type: 'proxy-progress', projectId: project.id, progress })
        )
      )
    } finally {
      proxyTasks.delete(project.id)
    }
  })
  handle('cancel-proxy', (input: unknown) => {
    proxyTasks.get(idSchema.parse(input))?.abort()
  })
  handle('get-highlight-scan', (input: unknown) => scanner.get(idSchema.parse(input)))
  handle('start-highlight-scan', (input: unknown, options: unknown) =>
    scanner.start(idSchema.parse(input), ScanOptionsSchema.parse(options))
  )
  handle('cancel-highlight-scan', (input: unknown) => scanner.cancel(idSchema.parse(input)))
  handle('accept-highlight', (project: unknown, id: unknown) =>
    scanner.accept(ProjectSchema.parse(project), idSchema.parse(id))
  )
  handle('dismiss-highlight', (projectId: unknown, id: unknown) =>
    scanner.dismiss(idSchema.parse(projectId), idSchema.parse(id))
  )
  handle('enqueue', async (input: unknown, ids: unknown) => {
    const project = ProjectSchema.parse(input)
    await store.saveProject(project)
    await assertSource(project.media)
    return queue.enqueue(project, z.array(idSchema).min(1).max(1000).parse(ids))
  })
  handle('queue-action', (action: unknown, id?: unknown) =>
    queue.action(
      z.enum(['start', 'pause', 'cancel', 'retry', 'up', 'down', 'clear']).parse(action),
      id === undefined ? undefined : idSchema.parse(id)
    )
  )
  handle('reveal-output', async (input: unknown) => {
    const job = store.queue.jobs.find((item) => item.id === idSchema.parse(input))
    if (!job?.outputPath || job.status !== 'completed')
      throw new Error('This reel has not completed yet.')
    await stat(job.outputPath)
    shell.showItemInFolder(job.outputPath)
  })
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 800,
    backgroundColor: '#101114',
    title: 'Tok Farm',
    show: false,
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(__dirname, '../../build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
  window.once('ready-to-show', () => window?.show())
  window.on('close', (event) => {
    if (closing) return
    event.preventDefault()
    void (async () => {
      if (store.queue.jobs.some((job) => job.status === 'running')) {
        const { response } = await dialog.showMessageBox(window!, {
          type: 'question',
          title: 'Export in progress',
          message: 'Close Tok Farm and interrupt the current export?',
          detail:
            'Your shots and queue are saved. You can retry the interrupted reel when you reopen the app.',
          buttons: ['Keep exporting', 'Close app'],
          defaultId: 0,
          cancelId: 0
        })
        if (response !== 1) return
      }
      closing = true
      for (const controller of proxyTasks.values()) controller.abort()
      await scanner.shutdown()
      await queue.shutdown()
      app.quit()
    })().catch((error) => {
      closing = false
      void dialog.showMessageBox(window!, {
        type: 'error',
        message: 'Could not save your project',
        detail: String(error)
      })
    })
  })
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadURL('tokfarm://app/index.html')
}

if (gotLock)
  void app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('com.tokfarm.editor')
      store = new Store(app.getPath('userData'))
      await store.load()
      for (const job of store.queue.jobs.filter((item) => item.status === 'interrupted')) {
        await rm(join(job.outputDirectory, `.tokfarm-${job.id}.partial.mp4`), {
          force: true
        }).catch(() => {})
        await rm(join(job.outputDirectory, `.tokfarm-${job.id}.filter.txt`), { force: true }).catch(
          () => {}
        )
      }
      const cache = join(app.getPath('userData'), 'media-cache')
      await mkdir(cache, { recursive: true })
      queue = new ExportQueue(store, (value) => emit({ type: 'queue', queue: value }))
      scanner = new HighlightScanner(store, cache, (scan) => emit({ type: 'highlight-scan', scan }))
      protocol.handle('tokfarm-media', mediaResponse)
      const rendererRoot = resolve(__dirname, '../renderer')
      protocol.handle('tokfarm', (request) => {
        const url = new URL(request.url),
          path = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
        if (url.hostname !== 'app' || !path.startsWith(rendererRoot + sep))
          return new Response(null, { status: 403 })
        return net.fetch(pathToFileURL(path).toString())
      })
      setupHandlers(cache)
      await createWindow()
    })
    .catch((error) => {
      dialog.showErrorBox('Tok Farm could not start', String(error))
      app.quit()
    })
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore()
  window?.focus()
})
app.on('window-all-closed', () => app.quit())
