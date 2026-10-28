import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import electronExecutable from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ffmpegPath, probeMedia, rawProbe, runProcess } from '../src/main/media'
import { timecode } from '../src/shared/crop'

const root = resolve('test-results'),
  userData = join(root, `acceptance-${Date.now()}`),
  output = join(userData, 'reels')
const executablePath = process.env.TOKFARM_EXECUTABLE || (electronExecutable as unknown as string)
const packaged = Boolean(process.env.TOKFARM_EXECUTABLE)

async function createFixture() {
  await mkdir(root, { recursive: true })
  const seed = join(root, 'pitch-seed.mp4'),
    match = join(root, 'City vs United - First Half.mp4')
  try {
    if ((await probeMedia(match)).duration >= 2700) return match
  } catch {
    /* Generate a deterministic long source. */
  }
  const pitch =
    'drawgrid=w=160:h=1080:t=80:c=0x315e3b@0.28,drawbox=x=80:y=65:w=1760:h=950:c=white@0.55:t=3,' +
    'drawbox=x=958:y=65:w=3:h=950:c=white@0.55:t=fill,drawbox=x=80:y=310:w=280:h=460:c=white@0.55:t=3,' +
    'drawbox=x=1560:y=310:w=280:h=460:c=white@0.55:t=3,drawbox=x=80:y=420:w=100:h=240:c=white@0.55:t=3,' +
    'drawbox=x=1740:y=420:w=100:h=240:c=white@0.55:t=3,' +
    [
      '420:370:0xe5ce9e',
      '650:660:0xe5ce9e',
      '1030:400:0xe5ce9e',
      '1350:680:0xe5ce9e',
      '570:510:0x7297ce',
      '870:350:0x7297ce',
      '1180:630:0x7297ce',
      '1520:390:0x7297ce'
    ]
      .map((item) => {
        const [x, y, c] = item.split(':')
        return `drawbox=x=${x}:y=${y}:w=20:h=35:c=${c}:t=fill`
      })
      .join(',')
  await runProcess(ffmpegPath, [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x244b32:s=1920x1080:r=30:d=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=white:s=12x12:r=30:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:sample_rate=48000:duration=2',
    '-filter_complex',
    `[0:v]${pitch}[pitch];[pitch][1:v]overlay=x='480+t*260':y='480+80*sin(t*2)':shortest=1[v]`,
    '-map',
    '[v]',
    '-map',
    '2:a',
    '-af',
    'volume=0.02',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '28',
    '-g',
    '30',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    seed
  ])
  await runProcess(ffmpegPath, [
    '-loglevel',
    'error',
    '-y',
    '-stream_loop',
    '1349',
    '-i',
    seed,
    '-t',
    '2700',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    match
  ])
  return match
}

async function launch() {
  const application = await electron.launch({
    executablePath,
    args: packaged ? [] : [resolve('out/main/index.js')],
    env: { ...process.env, TOKFARM_TEST_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' },
    timeout: 60000
  })
  const page = await application.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('Renderer error:', error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('Renderer console:', message.text())
  })
  await expect(page.getByRole('button', { name: 'Import video' })).toBeVisible()
  return { application, page, errors }
}
async function stubPicker(application: ElectronApplication, path: string) {
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, path)
}
async function inputTime(page: Page, label: string, value: number) {
  const field = page.getByRole('textbox', { name: label, exact: true })
  await field.fill(timecode(value, true))
  await field.press('Tab')
}
async function seekVideo(page: Page, time: number) {
  await page.locator('video').evaluate(
    (element: HTMLVideoElement, time) =>
      new Promise<void>((resolve) => {
        if (Math.abs(element.currentTime - time) < 0.001) {
          resolve()
          return
        }
        element.addEventListener('seeked', () => resolve(), { once: true })
        element.currentTime = time
      }),
    time
  )
}

async function main() {
  const fixture = await createFixture()
  await mkdir(output, { recursive: true })
  const source = await probeMedia(fixture)
  console.log(
    `Fixture: ${source.duration.toFixed(2)} seconds, ${source.width}×${source.height}, ${source.fps} fps`
  )
  let { application, page, errors } = await launch()
  try {
    await page.screenshot({ path: join(root, packaged ? 'packaged-welcome.png' : 'welcome.png') })
    await stubPicker(application, fixture)
    await page.getByRole('button', { name: 'Import video', exact: true }).click()
    await expect(page.locator('video')).toBeVisible({ timeout: 60000 })
    await expect
      .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState), {
        timeout: 30000
      })
      .toBeGreaterThanOrEqual(2)
    await page.locator('.source-stage').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible()
    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: 'Play video', exact: true })).toBeVisible()
    const sourceUrl = await page.locator('video').getAttribute('src')
    // Verify the custom media protocol really supports seeking without full-file reads.
    const rangeResult = await page.evaluate(async (url) => {
      const response = await fetch(url!, { headers: { Range: 'bytes=100-199' } })
      return {
        status: response.status,
        length: (await response.arrayBuffer()).byteLength,
        range: response.headers.get('Content-Range')
      }
    }, sourceUrl)
    expect(rangeResult.status).toBe(206)
    expect(rangeResult.length).toBe(100)
    expect(rangeResult.range).toMatch(/^bytes 100-199\//)
    const moments = [32, 168, 340, 575, 730, 1080, 1380, 1710, 2100, 2540]
    const names = [
      'Opening counter',
      'First chance',
      'A clever through ball',
      'Big save',
      'Quick break',
      'Top corner attempt',
      'The build-up',
      'On the wing',
      'One-touch passing',
      'Late chance'
    ]
    for (let i = 0; i < moments.length; i++) {
      if (i === 0) {
        await seekVideo(page, moments[i])
        await page.keyboard.press('i')
        await seekVideo(page, moments[i] + 1.2)
        await page.keyboard.press('o')
        await page.keyboard.press('Enter')
      } else {
        await inputTime(page, 'Selection out', moments[i] + 1.2)
        await inputTime(page, 'Selection in', moments[i])
        await page.getByRole('button', { name: /Add shot/ }).click()
      }
      await page.getByRole('textbox', { name: 'Shot name', exact: true }).fill(names[i])
      await expect(page.getByTestId('shot-card')).toHaveCount(i + 1)
    }
    // Exercise dragging, source-time keyframes, live preview, and shot audio.
    await page
      .locator('.shot-list')
      .getByRole('button', { name: /Opening counter/ })
      .click()
    await seekVideo(page, 32.05)
    const overlay = page.getByTestId('crop-overlay'),
      bounds = await overlay.boundingBox()
    if (!bounds) throw new Error('Crop frame is missing')
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2 - 70, bounds.y + bounds.height / 2, {
      steps: 8
    })
    await page.mouse.up()
    await seekVideo(page, 33.1)
    const nextBounds = await overlay.boundingBox()
    if (!nextBounds) throw new Error('Crop frame is missing')
    await page.mouse.move(nextBounds.x + nextBounds.width / 2, nextBounds.y + nextBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      nextBounds.x + nextBounds.width / 2 + 110,
      nextBounds.y + nextBounds.height / 2,
      { steps: 8 }
    )
    await page.mouse.up()
    await expect(page.locator('.keyframe-row')).toHaveCount(3)
    await page.getByRole('switch', { name: 'Keep original audio' }).click()
    await expect(page.getByRole('switch', { name: 'Keep original audio' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await stubPicker(application, output)
    await page.getByRole('button', { name: 'Queue all shots' }).click()
    await expect(page.getByTestId('queue-job')).toHaveCount(10)
    await seekVideo(page, 32.5)
    await page.screenshot({ path: join(root, packaged ? 'packaged-editor.png' : 'editor.png') })
    await page.getByRole('button', { name: 'Start queue' }).click()
    await expect
      .poll(
        () =>
          page.evaluate(async () =>
            (await window.tokfarm.bootstrap()).queue.jobs.some((job) => job.status === 'running')
          ),
        { timeout: 30000 }
      )
      .toBe(true)
    // Keep editing during an actual export; queued snapshots must remain unchanged.
    await page
      .locator('.shot-list')
      .getByRole('button', { name: /Late chance/ })
      .click()
    await page
      .getByRole('textbox', { name: 'Shot name', exact: true })
      .fill('Edited while exporting')
    await inputTime(page, 'Selection out', 2671.2)
    await inputTime(page, 'Selection in', 2670)
    await page.getByRole('button', { name: /Add shot/ }).click()
    await expect(page.getByTestId('shot-card')).toHaveCount(11)
    const during = await page.evaluate(() => window.tokfarm.bootstrap())
    expect(during.queue.jobs[9].clip.name).toBe('Late chance')
    expect(during.project?.clips[9].name).toBe('Edited while exporting')
    await expect
      .poll(
        async () => {
          const jobs = (await page.evaluate(() => window.tokfarm.bootstrap())).queue.jobs
          if (jobs.some((job) => job.status === 'failed'))
            throw new Error(jobs.find((job) => job.status === 'failed')?.error)
          return jobs.filter((job) => job.status === 'completed').length
        },
        { timeout: 180000, intervals: [500] }
      )
      .toBe(10)
    const finished = await page.evaluate(() => window.tokfarm.bootstrap())
    for (const job of finished.queue.jobs) {
      const data = await rawProbe(job.outputPath!)
      expect(data.streams[0].width).toBe(1080)
      expect(data.streams[0].height).toBe(1920)
      expect(Number(data.format.duration)).toBeGreaterThanOrEqual(1.19)
    }
    expect((await rawProbe(finished.queue.jobs[0].outputPath!)).streams).toHaveLength(1)
    expect((await rawProbe(finished.queue.jobs[1].outputPath!)).streams).toHaveLength(2)
    await page
      .locator('.shot-list')
      .getByRole('button', { name: /Opening counter/ })
      .click()
    await seekVideo(page, 32.5)
    await page.screenshot({
      path: join(root, packaged ? 'packaged-completed.png' : 'completed.png')
    })
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1180, 800)
    )
    await page.screenshot({ path: join(root, packaged ? 'packaged-compact.png' : 'compact.png') })
    const fits = await page.evaluate(
      () => document.querySelector('.app')!.scrollWidth <= window.innerWidth
    )
    expect(fits).toBe(true)
    const queueFooterFits = await page.evaluate(
      () =>
        document.querySelector('.queue-footer')!.getBoundingClientRect().bottom <=
        document.querySelector('.status-bar')!.getBoundingClientRect().top + 1
    )
    expect(queueFooterFits).toBe(true)
    expect(errors).toEqual([])
    await application.close()
    ;({ application, page, errors } = await launch())
    await expect(page.getByTestId('shot-card')).toHaveCount(11)
    await expect(page.getByTestId('queue-job')).toHaveCount(10)
    const reopened = await page.evaluate(() => window.tokfarm.bootstrap())
    expect(reopened.queue.running).toBe(false)
    expect(reopened.queue.jobs.every((job) => job.status === 'completed')).toBe(true)
    expect(reopened.project?.clips[9].name).toBe('Edited while exporting')
    expect(errors).toEqual([])
    const result = {
      packaged,
      sourceDuration: source.duration,
      sourceDimensions: `${source.width}×${source.height}`,
      exports: 10,
      editedDuringExport: true,
      savedShots: 11,
      sourceByteRanges: true,
      cropDragging: true,
      mute: true,
      keyboardShortcuts: true,
      compactWindow: true,
      reopenedSuccessfully: true,
      rendererErrors: errors,
      outputDirectory: output
    }
    await writeFile(
      join(root, packaged ? 'packaged-acceptance.json' : 'acceptance.json'),
      JSON.stringify(result, null, 2)
    )
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await application.close().catch(() => {})
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
