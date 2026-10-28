import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { probeMedia } from '../src/main/media'
import { scanHighlights } from '../src/main/highlight-engine'

async function main() {
  const root = resolve('test-results'),
    source = resolve(process.argv[2] || join(root, 'City vs United - First Half.mp4'))
  await mkdir(root, { recursive: true })
  const media = await probeMedia(source),
    start = Date.now()
  let last = 0
  const suggestions = await scanHighlights(
    media,
    { profile: 'football', sensitivity: 'balanced', maxSuggestions: 20 },
    join(root, `scan-benchmark-cache-${Date.now()}`),
    new AbortController().signal,
    (event) => {
      if (Date.now() - last > 10000) {
        last = Date.now()
        console.log(`${event.phase}: ${Math.round(event.progress * 100)}%`)
      }
    }
  )
  const result = {
    duration: media.duration,
    dimensions: `${media.width}x${media.height}`,
    elapsedSeconds: (Date.now() - start) / 1000,
    suggestions: suggestions.length,
    source,
    profile: 'football'
  }
  await writeFile(join(root, 'scan-benchmark.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
