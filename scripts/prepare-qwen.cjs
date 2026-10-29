const { createHash } = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const manifest = require('./qwen-assets.json')
const root = path.resolve(__dirname, '../build/qwen-runtime')
const cache = path.resolve(__dirname, '../build/model-cache/qwen')
const controller = new AbortController()
process.once('SIGINT', () => controller.abort())

async function checksum(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function verified(file, asset) {
  try {
    return (await fs.stat(file)).size === asset.size && (await checksum(file)) === asset.sha256
  } catch {
    return false
  }
}
async function download(asset) {
  const target = path.join(asset.kind === 'model' ? path.join(root, 'models') : cache, asset.name)
  if (await verified(target, asset)) {
    console.log(`Verified ${asset.name}`)
    return target
  }
  const temporary = `${target}.partial`
  for (let attempt = 0; attempt < 3; attempt++) {
    controller.signal.throwIfAborted()
    let offset = await fs.stat(temporary).then(
      (info) => info.size,
      () => 0
    )
    if (offset === asset.size && (await verified(temporary, asset))) {
      await fs.rename(temporary, target)
      return target
    }
    if (offset > asset.size) {
      await fs.truncate(temporary, 0)
      offset = 0
    }
    try {
      console.log(
        `Downloading ${asset.name} (${Math.round(offset / 1048576)}/${Math.round(asset.size / 1048576)} MiB)`
      )
      const response = await fetch(asset.url, {
        headers: offset ? { Range: `bytes=${offset}-` } : {},
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1800000)])
      })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      if (
        response.status === 206 &&
        !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)
      )
        throw new Error('Unexpected download range')
      if (response.status !== 206) offset = 0
      let written = offset,
        last = offset
      const progress = new Transform({
        transform(chunk, _encoding, done) {
          written += chunk.length
          if (written - last >= 64 * 1048576) {
            console.log(`${asset.name}: ${Math.round((written / asset.size) * 100)}%`)
            last = written
          }
          done(null, chunk)
        }
      })
      await pipeline(
        Readable.fromWeb(response.body),
        progress,
        createWriteStream(temporary, { flags: offset ? 'a' : 'w' }),
        { signal: controller.signal }
      )
      if (!(await verified(temporary, asset))) {
        await fs.truncate(temporary, 0)
        throw new Error('Size or SHA-256 verification failed')
      }
      await fs.rename(temporary, target)
      console.log(`Verified ${asset.name}`)
      return target
    } catch (error) {
      if (controller.signal.aborted || attempt === 2) throw error
      console.warn(`Retrying ${asset.name}: ${error.message}`)
    }
  }
}
async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('This pinned benchmark runtime targets Windows x64.')
  await fs.mkdir(path.join(root, 'models'), { recursive: true })
  await fs.mkdir(cache, { recursive: true })
  await Promise.all(
    manifest.assets.map(async (asset) => {
      const file = await download(asset)
      if (asset.kind !== 'model') {
        const destination = path.join(root, manifest.runtimeTag, asset.kind)
        await fs.mkdir(destination, { recursive: true })
        await promisify(execFile)('tar.exe', ['-xf', file, '-C', destination], {
          windowsHide: true
        })
      }
    })
  )
  for (const license of manifest.licenses) {
    const response = await fetch(license.url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Cannot fetch ${license.name}: ${response.status}`)
    await fs.writeFile(path.join(root, license.name), await response.text(), 'utf8')
  }
  await fs.writeFile(path.join(root, 'PROVENANCE.json'), JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`Qwen benchmark assets ready at ${root}. Inference is local.`)
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
