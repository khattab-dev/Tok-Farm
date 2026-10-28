import { _electron as electron, expect } from '@playwright/test'
import executable from 'electron'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ffmpegPath, runProcess, rawProbe } from '../src/main/media'

async function main() {
  const results = resolve('test-results'),
    data = join(results, `highlight-ui-${Date.now()}`),
    output = join(data, 'reels'),
    source = join(data, 'Silent visual activity.mp4')
  await mkdir(output, { recursive: true })
  await runProcess(ffmpegPath, [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    "color=black:s=640x360:r=10:d=55,drawbox=x=0:y=0:w=640:h=360:color=white:t=fill:enable='between(t,20,21)+between(t,44,45)'",
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    source
  ])
  const packaged = !!process.env.TOKFARM_EXECUTABLE
  const launchEnvironment: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, TOKFARM_TEST_DATA: data }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
  if (packaged) {
    for (const key of Object.keys(launchEnvironment))
      if (key.toLowerCase() === 'path') delete launchEnvironment[key]
    launchEnvironment.PATH = `${process.env.SystemRoot || 'C:\\Windows'}\\System32;${process.env.SystemRoot || 'C:\\Windows'}`
  }
  let application = await electron.launch({
    executablePath: process.env.TOKFARM_EXECUTABLE || (executable as unknown as string),
    args: packaged ? [] : [resolve('out/main/index.js')],
    env: launchEnvironment,
    timeout: 60000
  })
  let page = await application.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    if (packaged) {
      const resources = await application.evaluate(() => process.resourcesPath)
      expect(
        (await stat(join(resources, 'analysis-runtime/vision_model_quantized.onnx'))).size
      ).toBeGreaterThan(80000000)
      expect(
        (
          await stat(
            join(resources, 'analysis-runtime/node_modules/onnxruntime-node/dist/index.js')
          )
        ).isFile()
      ).toBe(true)
      expect(
        (
          await stat(
            join(resources, 'analysis-runtime/node_modules/onnxruntime-common/dist/cjs/index.js')
          )
        ).isFile()
      ).toBe(true)
    }
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, source)
    await page.getByRole('button', { name: 'Import video', exact: true }).click()
    await expect(page.locator('video')).toBeVisible({ timeout: 60000 })
    await page.getByRole('button', { name: 'Find highlights', exact: true }).click()
    await page.getByLabel('Highlight content profile').selectOption('general')
    await page.getByRole('button', { name: 'Scan this video', exact: true }).click()
    await expect(page.getByTestId('highlight-suggestion')).toHaveCount(2, { timeout: 120000 })
    const suggestion = page.getByTestId('highlight-suggestion').first()
    await suggestion.getByRole('button', { name: /Preview suggestion/ }).click()
    await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible()
    await page.screenshot({ path: join(results, 'highlight-suggestions.png') })
    await suggestion.getByRole('button', { name: /Add suggestion/ }).click()
    await expect(suggestion.getByText('Added', { exact: true })).toBeVisible()
    const second = page.getByTestId('highlight-suggestion').nth(1)
    await second.getByRole('button', { name: 'Dismiss suggestion' }).click()
    await expect(page.getByTestId('highlight-suggestion')).toHaveCount(1)
    await page.getByRole('button', { name: 'Back to your shots', exact: true }).click()
    await expect(page.getByTestId('shot-card')).toHaveCount(1)
    await page
      .getByRole('textbox', { name: 'Shot name', exact: true })
      .fill('Approved local suggestion')
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, output)
    await page.getByRole('button', { name: 'Queue all shots', exact: true }).click()
    await page.getByRole('button', { name: 'Start queue', exact: true }).click()
    await expect
      .poll(
        async () => {
          const job = (await page.evaluate(() => window.tokfarm.bootstrap())).queue.jobs[0]
          if (job?.status === 'failed') throw new Error(job.error)
          return job?.status
        },
        { timeout: 120000, intervals: [500] }
      )
      .toBe('completed')
    const saved = await page.evaluate(() => window.tokfarm.bootstrap())
    const scan = await page.evaluate((id) => window.tokfarm.getHighlightScan(id), saved.project!.id)
    expect(scan?.suggestions.map((item) => item.status).sort()).toEqual(['accepted', 'dismissed'])
    const exported = await rawProbe(saved.queue.jobs[0].outputPath!)
    expect(exported.streams[0].width).toBe(1080)
    expect(exported.streams[0].height).toBe(1920)
    expect(exported.streams).toHaveLength(1)
    await application.close()
    application = await electron.launch({
      executablePath: process.env.TOKFARM_EXECUTABLE || (executable as unknown as string),
      args: packaged ? [] : [resolve('out/main/index.js')],
      env: launchEnvironment,
      timeout: 60000
    })
    page = await application.firstWindow()
    await expect(page.getByTestId('shot-card')).toHaveCount(1)
    await page.getByRole('button', { name: 'Find highlights', exact: true }).click()
    await expect(page.getByTestId('highlight-suggestion')).toHaveCount(1)
    await expect(page.getByText('Added', { exact: true })).toBeVisible()
    await page.getByLabel('Highlight content profile').selectOption('gaming')
    await page.getByRole('button', { name: 'Scan again', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel scan', exact: true }).click()
    await expect(page.getByText('Scan cancelled. Your saved shots are unchanged.')).toBeVisible({
      timeout: 30000
    })
    expect(errors).toEqual([])
    const summary = {
      packaged,
      restrictedPath: packaged,
      sourceDuration: 55,
      silentInput: true,
      suggestions: 2,
      accepted: 1,
      dismissed: 1,
      exported: true,
      persisted: true,
      cancelled: true,
      rendererErrors: errors
    }
    await writeFile(
      join(results, packaged ? 'packaged-highlights.json' : 'highlights.json'),
      JSON.stringify(summary, null, 2)
    )
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await application.close().catch(() => {})
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
