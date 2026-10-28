import type { CropKeyframe } from './model'

function sortedPositions(keyframes: CropKeyframe[]) {
  return [...keyframes]
    .sort((a, b) => a.time - b.time)
    .filter((p, i, all) => i === all.length - 1 || p.time !== all[i + 1].time)
}

export function positionAt(keyframes: CropKeyframe[], time: number): { x: number; y: number } {
  const points = sortedPositions(keyframes)
  if (!points.length) return { x: 0.5, y: 0.5 }
  if (time <= points[0].time) return points[0]
  for (let i = 1; i < points.length; i++) {
    if (time <= points[i].time) {
      const a = points[i - 1],
        b = points[i]
      const t = b.time === a.time ? 1 : (time - a.time) / (b.time - a.time)
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
  }
  return points[points.length - 1]
}

// x/y describe the fraction of available travel, not the center of the crop.
export function cropGeometry(width: number, height: number, x: number, y: number) {
  const cropWidth = Math.max(2, Math.floor(Math.min(width, (height * 9) / 16) / 2) * 2)
  const cropHeight = Math.max(2, Math.floor(Math.min(height, (width * 16) / 9) / 2) * 2)
  return {
    width: cropWidth,
    height: cropHeight,
    x: Math.max(0, width - cropWidth) * x,
    y: Math.max(0, height - cropHeight) * y
  }
}

export function panExpression(keyframes: CropKeyframe[], axis: 'x' | 'y', start: number): string {
  // FFmpeg's t is reset to clip time; stored keyframes stay in source time.
  const points = sortedPositions(keyframes)
  if (!points.length) return '0.5'
  const num = (n: number) => Number(n.toFixed(9)).toString()
  let expression = num(points[points.length - 1][axis])
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i],
      b = points[i + 1]
    const lerp = `${num(a[axis])}+(${num(b[axis] - a[axis])})*(t-(${num(a.time - start)}))/${num(b.time - a.time)}`
    expression = `if(lt(t,${num(b.time - start)}),${lerp},${expression})`
  }
  return `if(lte(t,${num(points[0].time - start)}),${num(points[0][axis])},${expression})`
}

export function timecode(seconds: number, millis = false): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${millis ? `.${String(ms % 1000).padStart(3, '0')}` : ''}`
}

export function parseTimecode(text: string): number | null {
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d{1,3})?$/.test(text.trim())) return null
  return text
    .trim()
    .split(':')
    .reduce((sum, part) => sum * 60 + Number(part), 0)
}
