import { _electron as electron, expect, type Page } from '@playwright/test'
import executable from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ffmpegPath, rawProbe, runProcess } from '../src/main/media'
import { frameLayout, resolveFraming } from '../src/shared/framing'
import { positionAt } from '../src/shared/crop'

async function range(page: Page, label: string, value: number) {
  await page.getByRole('slider', { name: label, exact: true }).fill(String(value))
}
async function main() {
  const root = resolve('test-results'),
    data = join(root, `framing-ui-${Date.now()}`),
    output = join(data, 'reels'),
    source = join(data, 'المباراة — full picture.mp4')
  await mkdir(output, { recursive: true })
  await runProcess(ffmpegPath, [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=640x360:r=30:d=3,drawbox=x=320:y=0:w=320:h=360:color=blue:t=fill',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    source
  ])
  const packaged = Boolean(process.env.TOKFARM_EXECUTABLE)
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, TOKFARM_TEST_DATA: data }).filter(
      (e): e is [string, string] => e[1] !== undefined
    )
  )
  if (packaged) {
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
    env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`
  }
  const launch = () =>
    electron.launch({
      executablePath: process.env.TOKFARM_EXECUTABLE || (executable as unknown as string),
      args: packaged ? [] : [resolve('out/main/index.js')],
      env,
      timeout: 60000
    })
  let application = await launch(),
    page = await application.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, source)
    await page.getByRole('button', { name: 'Import video', exact: true }).click()
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), {
        timeout: 30000
      })
      .toBeGreaterThanOrEqual(2)
    await page.getByRole('button', { name: 'Fit full video', exact: true }).click()
    await page.getByLabel('Frame background', { exact: true }).selectOption('color')
    await page.getByLabel('Background color', { exact: true }).fill('#00ff00')
    await range(page, 'Video zoom', 75)
    await range(page, 'Horizontal position', 20)
    await range(page, 'Vertical position', 80)
    const picture = await page.locator('.source-picture').boundingBox(),
      overlay = await page.getByTestId('crop-overlay').boundingBox()
    expect(overlay!.width).toBeCloseTo(picture!.width, 0)
    expect(overlay!.height).toBeCloseTo(picture!.height, 0)
    await expect(page.locator('.crop-shade')).toBeHidden()
    const canvas = page.getByLabel('Reel framing preview', { exact: true })
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) =>
          Array.from(c.getContext('2d')!.getImageData(10, 10, 1, 1).data).slice(0, 3)
        )
      )
      .toEqual([0, 255, 0])
    await page.getByRole('textbox', { name: 'Selection out', exact: true }).fill('0.8')
    await page.getByRole('textbox', { name: 'Selection out', exact: true }).press('Tab')
    await page.getByRole('button', { name: /Add shot/ }).click()
    await page.getByRole('textbox', { name: 'Shot name', exact: true }).fill('Fit full picture')
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, output)
    await page.getByRole('button', { name: 'Queue all shots', exact: true }).click()
    await expect(page.getByTestId('queue-job')).toHaveCount(1)
    const original = (await page.evaluate(() => window.tokfarm.bootstrap())).queue.jobs[0].clip
    expect(original.framing).toMatchObject({
      mode: 'fit',
      zoom: 0.75,
      background: 'color',
      positionY: 0.8
    })
    await page.getByRole('button', { name: 'Customize framing', exact: true }).click()
    await page.getByLabel('Output aspect ratio', { exact: true }).selectOption('1:1')
    await page.getByLabel('Frame background', { exact: true }).selectOption('blur')
    await range(page, 'Video zoom', 50)
    await range(page, 'Vertical position', 30)
    await page.getByRole('textbox', { name: 'Selection out', exact: true }).fill('1.8')
    await page.getByRole('textbox', { name: 'Selection out', exact: true }).press('Tab')
    await page.getByRole('textbox', { name: 'Selection in', exact: true }).fill('1')
    await page.getByRole('textbox', { name: 'Selection in', exact: true }).press('Tab')
    await page.getByRole('button', { name: /Add shot/ }).click()
    await expect(page.getByTestId('shot-card')).toHaveCount(2)
    await page.getByRole('button', { name: 'Customize framing', exact: true }).click()
    await expect(page.getByLabel('Output aspect ratio', { exact: true })).toHaveValue('9:16')
    await expect(page.getByRole('slider', { name: 'Video zoom', exact: true })).toHaveValue('75')
    await page.getByRole('button', { name: 'Apply layout to all 2 shots', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.tokfarm.bootstrap())).project?.clips[0].framing
            ?.aspectRatio
      )
      .toBe('9:16')
    const afterAll = (await page.evaluate(() => window.tokfarm.bootstrap())).project!
    expect(afterAll.clips[0].keyframes[0].y).toBe(0.3)
    expect(afterAll.clips[1].keyframes[0].y).toBe(0.8)
    await page
      .locator('.shot-list')
      .getByRole('button', { name: /Fit full picture/ })
      .click()
    await page.getByRole('button', { name: 'Customize framing', exact: true }).click()
    await page.getByLabel('Output aspect ratio', { exact: true }).selectOption('1:1')
    await page.getByLabel('Frame background', { exact: true }).selectOption('blur')
    await range(page, 'Video zoom', 50)
    const before = Number(
      await page.getByRole('slider', { name: 'Vertical position', exact: true }).inputValue()
    )
    const bounds = await canvas.boundingBox()
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2 + 20, {
      steps: 8
    })
    await page.mouse.up()
    await expect
      .poll(async () =>
        Number(
          await page.getByRole('slider', { name: 'Vertical position', exact: true }).inputValue()
        )
      )
      .toBeGreaterThan(before)
    await page.getByRole('button', { name: 'Use for new shots', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.tokfarm.bootstrap())).project?.framing?.aspectRatio
      )
      .toBe('1:1')
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(360)
    const snapshot = (await page.evaluate(() => window.tokfarm.bootstrap())).project!
    const first = snapshot.clips[0],
      layout = frameLayout(640, 360, resolveFraming(first.framing), positionAt(first.keyframes, 0))
    const points = [
      [20, 20],
      [1060, 20],
      [layout.x + 40, layout.y + 40],
      [layout.x + layout.width - 40, layout.y + 40]
    ]
    const preview = await canvas.evaluate(
      (c: HTMLCanvasElement, points) =>
        points.map(([x, y]) =>
          Array.from(
            c.getContext('2d')!.getImageData(Math.floor(x / 3), Math.floor(y / 3), 1, 1).data
          ).slice(0, 3)
        ),
      points
    )
    await page.screenshot({ path: join(root, packaged ? 'packaged-framing.png' : 'framing.png') })
    await page.getByRole('button', { name: 'Queue all shots', exact: true }).click()
    await expect(page.getByTestId('queue-job')).toHaveCount(3)
    await page.getByRole('button', { name: 'Start queue', exact: true }).click()
    await page.getByRole('tab', { name: 'Timing & audio', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Shot name', exact: true })
      .fill('Edited layout while exporting')
    await expect
      .poll(
        async () => {
          const jobs = (await page.evaluate(() => window.tokfarm.bootstrap())).queue.jobs
          if (jobs.some((job) => job.status === 'failed'))
            throw new Error(jobs.find((job) => job.status === 'failed')!.error)
          return jobs.filter((job) => job.status === 'completed').length
        },
        { timeout: 90000 }
      )
      .toBe(3)
    const final = await page.evaluate(() => window.tokfarm.bootstrap())
    expect(final.queue.jobs[0].clip).toEqual(original)
    for (let i = 0; i < 3; i++) {
      const info = await rawProbe(final.queue.jobs[i].outputPath!)
      expect(info.streams[0].width).toBe(1080)
      expect(info.streams[0].height).toBe(i === 1 ? 1080 : 1920)
      expect(Number(info.streams[0].duration)).toBeCloseTo(0.8, 1)
    }
    const rgb = join(data, 'export.rgb')
    await runProcess(ffmpegPath, [
      '-loglevel',
      'error',
      '-y',
      '-i',
      final.queue.jobs[1].outputPath!,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      rgb
    ])
    const pixels = await readFile(rgb)
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i],
        pixel = Array.from(pixels.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3))
      for (let channel = 0; channel < 3; channel++)
        expect(Math.abs(pixel[channel] - preview[i][channel])).toBeLessThan(25)
    }
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1180, 800)
    )
    await page.getByRole('button', { name: 'Customize framing', exact: true }).click()
    await page.getByLabel('Output aspect ratio', { exact: true }).selectOption('16:9')
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]))
      .toEqual([640, 360])
    const frame = await page.locator('.vertical-frame').boundingBox()
    expect(frame!.width / frame!.height).toBeCloseTo(16 / 9, 1)
    expect(frame!.width).toBeGreaterThan(100)
    expect(
      await page.evaluate(() => document.querySelector('.app')!.scrollWidth <= innerWidth)
    ).toBe(true)
    expect(
      await page.evaluate(
        () =>
          document.querySelector('.queue-footer')!.getBoundingClientRect().bottom <=
          document.querySelector('.status-bar')!.getBoundingClientRect().top + 1
      )
    ).toBe(true)
    await page.screenshot({
      path: join(root, packaged ? 'packaged-framing-compact.png' : 'framing-compact.png')
    })
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.tokfarm.bootstrap())).project?.clips[0].framing
            ?.aspectRatio
      )
      .toBe('16:9')
    await application.close()
    application = await launch()
    page = await application.firstWindow()
    await expect(page.getByRole('button', { name: 'Import video', exact: true })).toBeVisible()
    page.on('pageerror', (error) => errors.push(error.message))
    const reopened = await page.evaluate(() => window.tokfarm.bootstrap())
    expect(reopened.project?.clips[0].framing?.aspectRatio).toBe('16:9')
    expect(reopened.project?.framing?.aspectRatio).toBe('1:1')
    expect(reopened.queue.jobs[0].clip).toEqual(original)
    expect(errors).toEqual([])
    const result = {
      packaged,
      fitFullPicture: true,
      solidAndBlur: true,
      zoomAndPosition: true,
      dragPreview: true,
      aspectRatios: true,
      previewMatchesExport: true,
      applyAllPreservesKeyframes: true,
      defaultsForNewShots: true,
      queueSnapshots: true,
      reopened: true,
      compactWindow: true,
      exports: 3,
      rendererErrors: errors,
      outputDirectory: output
    }
    await writeFile(
      join(root, packaged ? 'packaged-framing.json' : 'framing.json'),
      JSON.stringify(result, null, 2)
    )
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(root, 'framing-failure.png') }).catch(() => {})
    throw error
  } finally {
    await application.close().catch(() => {})
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
