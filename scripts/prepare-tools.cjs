const fs = require('node:fs/promises')
const path = require('node:path')

async function prepare() {
  const destination = path.resolve(__dirname, '../build/video-tools')
  await fs.mkdir(destination, { recursive: true })
  for (const [name, packageName] of [
    ['ffmpeg', 'ffmpeg-static'],
    ['ffprobe', '@derhuerst/ffprobe-static']
  ]) {
    const binary = require(packageName)
    if (!binary) throw new Error(`No ${name} binary is available for this platform.`)
    const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`))
    const filename = path.basename(binary)
    const target = path.join(destination, filename)
    const sourceStat = await fs.stat(binary)
    let current
    try {
      current = await fs.stat(target)
    } catch {}
    if (
      !current ||
      current.size !== sourceStat.size ||
      Math.abs(current.mtimeMs - sourceStat.mtimeMs) > 2
    ) {
      await fs.copyFile(binary, target)
      await fs.utimes(target, sourceStat.atime, sourceStat.mtime)
    }
    for (const [source, output] of [
      [path.join(packageRoot, 'LICENSE'), `${name}-GPL-LICENSE.txt`],
      [`${binary}.README`, `${name}-BUILD-README.txt`]
    ]) {
      await fs.copyFile(source, path.join(destination, output))
    }
  }
  const licenses = []
  for (const packageName of ['react', 'react-dom', 'scheduler', 'lucide-react', 'zod']) {
    const manifest = require.resolve(`${packageName}/package.json`, {
      paths: [path.dirname(require.resolve('react-dom/package.json'))]
    })
    const info = JSON.parse(await fs.readFile(manifest, 'utf8'))
    const license = await fs.readFile(path.join(path.dirname(manifest), 'LICENSE'), 'utf8')
    licenses.push(`${packageName} ${info.version}\n${'='.repeat(64)}\n${license}`)
  }
  await fs.writeFile(
    path.join(destination, 'JAVASCRIPT-LICENSES.txt'),
    licenses.join('\n\n'),
    'utf8'
  )
  console.log('Bundled FFmpeg and FFprobe ready.')
}
prepare().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
