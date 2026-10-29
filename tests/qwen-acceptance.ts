import { _electron as electron, expect } from '@playwright/test'
import executable from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ffmpegPath, runProcess, rawProbe } from '../src/main/media'

async function main() {
  const results = resolve('test-results'),
    data = join(results, `qwen-ui-${Date.now()}`),
    output = join(data, 'reels')
  await mkdir(output, { recursive: true })
  const supplied = process.env.TOKFARM_QWEN_SOURCE
  const source = supplied || join(data, 'Visible red rectangle.mp4')
  if (!supplied)
    await runProcess(ffmpegPath, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      "color=c=0x242424:s=640x360:r=30:d=10,drawbox=x=220:y=100:w=200:h=160:color=red:t=fill:enable='between(t,2,5)'",
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      source
    ])
  const start = Number(process.env.TOKFARM_QWEN_START || 0),
    end = Number(process.env.TOKFARM_QWEN_END || 10)
  const query = process.env.TOKFARM_QWEN_QUERY || 'A red rectangle appears on the screen.'
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
    await expect(page.getByRole('button', { name: 'Import video', exact: true })).toBeVisible()
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, source)
    await page.getByRole('button', { name: 'Import video', exact: true }).click()
    await expect(page.locator('video')).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Find highlights', exact: true }).click()
    await page.getByLabel('Highlight analysis engine').selectOption('qwen')
    await expect(
      page.getByText('Qwen3-VL 2B is ready · runs on this computer', { exact: true })
    ).toBeVisible()
    await page.getByLabel('Describe what to find').fill(query)
    for (const [label, time] of [
      ['Scan start', start],
      ['Scan end', end]
    ] as const) {
      await page.getByRole('textbox', { name: label, exact: true }).fill(String(time))
      await page.getByRole('textbox', { name: label, exact: true }).press('Tab')
    }
    await page.screenshot({
      path: join(results, packaged ? 'packaged-qwen-settings.png' : 'qwen-settings.png')
    })
    await page.getByRole('button', { name: 'Scan this video', exact: true }).click()
    // Editing remains available during actual native model loading/inference.
    await page.getByRole('button', { name: /Add shot/ }).click()
    await expect(page.getByTestId('shot-card')).toHaveCount(0) // Highlights panel replaces the shot list.
    await expect(page.getByRole('textbox', { name: 'Shot name', exact: true })).toBeVisible()
    const id = (await page.evaluate(() => window.tokfarm.bootstrap())).project!.id
    await expect
      .poll(
        async () => {
          const scan = await page.evaluate((id) => window.tokfarm.getHighlightScan(id), id)
          if (scan?.status === 'failed') throw new Error(scan.error)
          return scan?.status
        },
        { timeout: 180000, intervals: [500] }
      )
      .toBe('completed')
    const scan = await page.evaluate((id) => window.tokfarm.getHighlightScan(id), id)
    expect(scan!.suggestions.length).toBeGreaterThan(0)
    expect(scan!.options).toMatchObject({ engine: 'qwen', query, range: { start, end } })
    const candidate = page.getByTestId('highlight-suggestion').first()
    await candidate.getByRole('button', { name: /Preview suggestion/ }).click()
    await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible()
    await page.screenshot({
      path: join(results, packaged ? 'packaged-qwen-results.png' : 'qwen-results.png')
    })
    await candidate.getByRole('button', { name: /Add suggestion/ }).click()
    await expect(candidate.getByText('Added', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back to shots', exact: true }).click()
    await expect(page.getByTestId('shot-card')).toHaveCount(2)
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, output)
    await page.getByRole('button', { name: 'Queue all shots', exact: true }).click()
    await page.getByRole('button', { name: 'Start queue', exact: true }).click()
    await expect
      .poll(
        async () => {
          const jobs = (await page.evaluate(() => window.tokfarm.bootstrap())).queue.jobs
          if (jobs.some((job) => job.status === 'failed'))
            throw new Error(jobs.find((job) => job.status === 'failed')!.error)
          return jobs.filter((job) => job.status === 'completed').length
        },
        { timeout: 180000, intervals: [500] }
      )
      .toBe(2)
    const done = await page.evaluate(() => window.tokfarm.bootstrap())
    const video = await rawProbe(done.queue.jobs[1].outputPath!)
    expect(video.streams[0].width).toBe(1080)
    expect(video.streams[0].height).toBe(1920)
    await application.close()
    application = await launch()
    page = await application.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByTestId('shot-card')).toHaveCount(2)
    await page.getByRole('button', { name: 'Find highlights', exact: true }).click()
    await expect(page.getByLabel('Highlight analysis engine')).toHaveValue('qwen')
    await expect(page.getByText('Added', { exact: true })).toBeVisible()
    const cachedStart = Date.now()
    await page.getByRole('button', { name: 'Scan again', exact: true }).click()
    await expect
      .poll(
        async () => (await page.evaluate((id) => window.tokfarm.getHighlightScan(id), id))?.status,
        { timeout: 15000 }
      )
      .toBe('completed')
    const cachedSeconds = (Date.now() - cachedStart) / 1000
    // Another query bypasses the cache so cancel exercises the native helper path.
    await page
      .getByLabel('Describe what to find')
      .fill(`${query} Show only clearly visible actions.`)
    await page.getByRole('button', { name: 'Scan again', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel scan', exact: true }).click()
    await expect(page.getByText('Scan cancelled. Your saved shots are unchanged.')).toBeVisible({
      timeout: 30000
    })
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1180, 800)
    )
    const button = page.getByRole('button', { name: 'Scan again', exact: true })
    await button.scrollIntoViewIfNeeded()
    await expect(button).toBeVisible()
    await page.screenshot({
      path: join(results, packaged ? 'packaged-qwen-compact.png' : 'qwen-compact.png')
    })
    expect(errors).toEqual([])
    const summary = {
      packaged,
      realModel: true,
      bundledRuntime: packaged,
      restrictedPath: packaged,
      range: { start, end },
      suggestions: scan!.suggestions.length,
      editedWhileScanning: true,
      approved: true,
      exports: 2,
      persisted: true,
      cachedSeconds,
      cancelled: true,
      compactWindow: true,
      rendererErrors: errors
    }
    await writeFile(
      join(results, packaged ? 'packaged-qwen.json' : 'qwen.json'),
      JSON.stringify(summary, null, 2)
    )
    console.log(JSON.stringify(summary, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(results, 'qwen-ui-failure.png') }).catch(() => {})
    throw error
  } finally {
    await application.close().catch(() => {})
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
