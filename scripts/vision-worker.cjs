const workerData = { root: process.argv[2], profile: process.argv[3] }
const parentPort = process.parentPort
  ? {
      on: (_event, listener) => process.parentPort.on('message', (event) => listener(event.data)),
      postMessage: (message) => process.parentPort.postMessage(message)
    }
  : {
      on: (_event, listener) => process.on('message', listener),
      postMessage: (message) => process.send?.(message)
    }
const fs = require('node:fs')
const path = require('node:path')
const ort = require(path.join(__dirname, 'node_modules/onnxruntime-node/dist/index.js'))

async function main() {
  const labels = JSON.parse(
    fs.readFileSync(path.join(workerData.root, 'prompt-vectors.json'), 'utf8')
  )
  const profile = labels[workerData.profile]
  ort.env.logLevel = 'error'
  const session = await ort.InferenceSession.create(
    path.join(workerData.root, 'vision_model_quantized.onnx'),
    {
      executionProviders: ['cpu'],
      intraOpNumThreads: 2,
      interOpNumThreads: 1,
      executionMode: 'sequential',
      graphOptimizationLevel: 'all'
    }
  )
  const mean = [0.48145466, 0.4578275, 0.40821073],
    std = [0.26862954, 0.26130258, 0.27577711]
  let previous
  const similarity = (a, b) => {
    let sum = 0,
      aa = 0,
      bb = 0
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i]
      aa += a[i] * a[i]
      bb += b[i] * b[i]
    }
    return sum / Math.max(1e-12, Math.sqrt(aa * bb))
  }
  parentPort.on('message', async ({ id, data }) => {
    try {
      if (!(data instanceof ArrayBuffer) || data.byteLength !== 224 * 224 * 3)
        throw new Error('Invalid analysis frame payload.')
      const rgb = new Uint8Array(data),
        plane = 224 * 224,
        input = new Float32Array(plane * 3)
      let motion = 0,
        change = 0
      const histogram = new Float32Array(24)
      for (let i = 0; i < plane; i++) {
        for (let c = 0; c < 3; c++) input[c * plane + i] = (rgb[i * 3 + c] / 255 - mean[c]) / std[c]
        if (i % 8 === 0) {
          const value = (rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]) / 3
          histogram[Math.min(23, Math.floor((value / 256) * 24))]++
          if (previous) motion += Math.abs(value - previous.pixels[i / 8]) / 255
        }
      }
      const pixels = new Float32Array(plane / 8)
      for (let i = 0; i < plane; i += 8)
        pixels[i / 8] = (rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]) / 3
      for (let i = 0; i < 24; i++) {
        histogram[i] /= plane / 8
        if (previous) change += Math.abs(histogram[i] - previous.histogram[i])
      }
      motion /= plane / 8
      change /= 2
      previous = { pixels, histogram }
      const result = await session.run({
        pixel_values: new ort.Tensor('float32', input, [1, 3, 224, 224])
      })
      const vector = result.image_embeds?.data || result[session.outputNames[0]].data
      const background = Math.max(
        ...profile.background.map((item) => similarity(vector, item.vector))
      )
      const candidates = profile.events
        .map((item) => ({ label: item.label, score: similarity(vector, item.vector) }))
        .sort((a, b) => b.score - a.score)
      const informative = histogram.filter((value) => value > 0.001).length >= 4
      const margin = informative ? candidates[0].score - background : -1
      parentPort.postMessage({
        id,
        sample: {
          semantic: Math.max(0, Math.min(1, (margin - 0.005) / 0.12)),
          label: margin >= 0.04 ? candidates[0].label : undefined,
          motion,
          change
        }
      })
    } catch (error) {
      parentPort.postMessage({ id, error: error.message })
    }
  })
  parentPort.postMessage({ ready: true })
}
main().catch((error) => parentPort.postMessage({ error: error.message }))
