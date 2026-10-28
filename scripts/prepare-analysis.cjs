const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { createWriteStream } = require('node:fs')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const root = path.resolve(__dirname, '..')
const destination = path.join(root, 'build/analysis-runtime')
const cache = path.join(root, 'build/model-cache')
const revision = '4c1807b705b1d015fb032789cc4d221b23025a6f'
const base = `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/${revision}`

async function download(url, name, minimum = 1) {
  const target = path.join(cache, name)
  try {
    if ((await fs.stat(target)).size >= minimum) return target
  } catch {}
  console.log(`Downloading local analysis asset: ${name}`)
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) })
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status}): ${name}`)
  const temporary = `${target}.partial`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
  if ((await fs.stat(temporary)).size < minimum) throw new Error(`Incomplete model asset: ${name}`)
  await fs.rename(temporary, target)
  return target
}

async function copyPackage(name) {
  const manifest = require.resolve(`${name}/package.json`)
  const source = path.dirname(manifest),
    target = path.join(destination, 'node_modules', name)
  await fs.mkdir(target, { recursive: true })
  const json = JSON.parse(await fs.readFile(manifest, 'utf8'))
  await fs.copyFile(manifest, path.join(target, 'package.json'))
  for (const entry of ['dist', 'lib']) {
    try {
      await fs.cp(path.join(source, entry), path.join(target, entry), {
        recursive: true,
        force: true
      })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  for (const entry of ['LICENSE', 'ThirdPartyNotices.txt']) {
    try {
      await fs.copyFile(path.join(source, entry), path.join(target, entry))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (name === 'onnxruntime-node') {
    const platformPath = path.join('bin', 'napi-v6', process.platform, process.arch)
    await fs.cp(path.join(source, platformPath), path.join(target, platformPath), {
      recursive: true,
      force: true
    })
  }
  return json
}

async function main() {
  await fs.mkdir(cache, { recursive: true })
  await fs.mkdir(destination, { recursive: true })
  await copyPackage('onnxruntime-node')
  // Resolve the exact matching common package through the native package's module graph.
  let commonRoot = path.dirname(
    require.resolve('onnxruntime-common', {
      paths: [path.dirname(require.resolve('onnxruntime-node/package.json'))]
    })
  )
  while (true) {
    try {
      if (
        JSON.parse(await fs.readFile(path.join(commonRoot, 'package.json'), 'utf8')).name ===
        'onnxruntime-common'
      )
        break
    } catch {}
    const parent = path.dirname(commonRoot)
    if (parent === commonRoot) throw new Error('Could not locate ONNX Runtime common package.')
    commonRoot = parent
  }
  const commonManifest = path.join(commonRoot, 'package.json'),
    commonTarget = path.join(destination, 'node_modules/onnxruntime-common')
  await fs.mkdir(commonTarget, { recursive: true })
  await fs.copyFile(commonManifest, path.join(commonTarget, 'package.json'))
  await fs.cp(path.join(commonRoot, 'dist'), path.join(commonTarget, 'dist'), {
    recursive: true,
    force: true
  })
  const vision = await download(
    `${base}/onnx/vision_model_quantized.onnx`,
    'vision_model_quantized.onnx',
    80000000
  )
  const profilesText = await fs.readFile(
    path.join(root, 'src/shared/highlight-profiles.json'),
    'utf8'
  )
  const profileHash = crypto.createHash('sha256').update(profilesText).digest('hex')
  let previous
  try {
    previous = JSON.parse(
      await fs.readFile(path.join(destination, 'MODEL-PROVENANCE.json'), 'utf8')
    )
  } catch {}
  if (previous?.profileHash !== profileHash) {
    const textModel = await download(
      `${base}/onnx/text_model_quantized.onnx`,
      'text_model_quantized.onnx',
      60000000
    )
    const tokenizerPath = await download(`${base}/tokenizer.json`, 'tokenizer.json', 100000)
    const configPath = await download(`${base}/tokenizer_config.json`, 'tokenizer_config.json')
    const { Tokenizer } = require('@huggingface/tokenizers')
    const ort = require('onnxruntime-node')
    const tokenizer = new Tokenizer(
      JSON.parse(await fs.readFile(tokenizerPath, 'utf8')),
      JSON.parse(await fs.readFile(configPath, 'utf8'))
    )
    const session = await ort.InferenceSession.create(textModel, {
      executionProviders: ['cpu'],
      intraOpNumThreads: 2
    })
    const profiles = JSON.parse(profilesText),
      vectors = {}
    async function encode(text) {
      const { ids } = tokenizer.encode(text),
        tokenIds = ids.slice(0, 77)
      if (ids.length > 77) tokenIds[76] = 49407
      const input = new BigInt64Array(77).fill(49407n),
        mask = new BigInt64Array(77)
      tokenIds.forEach((id, i) => {
        input[i] = BigInt(id)
        mask[i] = 1n
      })
      const feeds = { input_ids: new ort.Tensor('int64', input, [1, 77]) }
      if (session.inputNames.includes('attention_mask'))
        feeds.attention_mask = new ort.Tensor('int64', mask, [1, 77])
      const result = await session.run(feeds)
      return Array.from(result.text_embeds?.data || result[session.outputNames[0]].data)
    }
    for (const [id, profile] of Object.entries(profiles)) {
      vectors[id] = { events: [], background: [] }
      for (const event of profile.events)
        vectors[id].events.push({ label: event.label, vector: await encode(event.text) })
      for (const text of profile.background)
        vectors[id].background.push({ vector: await encode(text) })
    }
    await session.release()
    await fs.writeFile(
      path.join(destination, 'prompt-vectors.json'),
      JSON.stringify(vectors),
      'utf8'
    )
  }
  const target = path.join(destination, 'vision_model_quantized.onnx')
  let targetSize = 0
  try {
    targetSize = (await fs.stat(target)).size
  } catch {}
  if (targetSize !== (await fs.stat(vision)).size) await fs.copyFile(vision, target)
  await fs.copyFile(
    path.join(__dirname, 'vision-worker.cjs'),
    path.join(destination, 'vision-worker.cjs')
  )
  const license = await download(
    'https://raw.githubusercontent.com/openai/CLIP/a1d071733d7111c9c014f024669f959182114e33/LICENSE',
    'CLIP-LICENSE.txt'
  )
  await fs.copyFile(license, path.join(destination, 'CLIP-LICENSE.txt'))
  const ortLicense = await download(
    'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/LICENSE',
    'ONNX-RUNTIME-LICENSE.txt'
  )
  await fs.copyFile(ortLicense, path.join(destination, 'ONNX-RUNTIME-LICENSE.txt'))
  const ortNotices = await download(
    'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/ThirdPartyNotices.txt',
    'ONNX-THIRD-PARTY-NOTICES.txt'
  )
  await fs.copyFile(ortNotices, path.join(destination, 'ONNX-THIRD-PARTY-NOTICES.txt'))
  await fs.writeFile(
    path.join(destination, 'MODEL-PROVENANCE.json'),
    JSON.stringify(
      {
        name: 'CLIP ViT-B/32',
        source: 'Xenova/clip-vit-base-patch32',
        revision,
        profileHash,
        visionSha256: crypto
          .createHash('sha256')
          .update(await fs.readFile(vision))
          .digest('hex'),
        purpose:
          'Reviewable scene candidates. Not a validated event or goal detector. No audio transcription or remote inference.'
      },
      null,
      2
    ),
    'utf8'
  )
  console.log('Local visual analysis ready. Runtime inference uses no network.')
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
