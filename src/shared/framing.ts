export const ASPECT_RATIOS = {
  '9:16': { width: 1080, height: 1920, name: 'Vertical reel' },
  '4:5': { width: 1080, height: 1350, name: 'Portrait video' },
  '1:1': { width: 1080, height: 1080, name: 'Square video' },
  '16:9': { width: 1920, height: 1080, name: 'Landscape video' }
} as const
export type AspectRatio = keyof typeof ASPECT_RATIOS
export interface FramingSettings {
  aspectRatio: AspectRatio
  mode: 'fill' | 'fit'
  zoom: number
  background: 'blur' | 'color'
  backgroundColor: string
  blur: number
  positionX: number
  positionY: number
}
export const DEFAULT_FRAMING: FramingSettings = {
  aspectRatio: '9:16',
  mode: 'fill',
  zoom: 1,
  background: 'blur',
  backgroundColor: '#111114',
  blur: 30,
  positionX: 0.5,
  positionY: 0.5
}
export function resolveFraming(value?: Partial<FramingSettings>): FramingSettings {
  return { ...DEFAULT_FRAMING, ...value }
}
export function outputSize(value?: Partial<FramingSettings>) {
  return ASPECT_RATIOS[resolveFraming(value).aspectRatio]
}
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)
export function frameLayout(
  sourceWidth: number,
  sourceHeight: number,
  framing: FramingSettings,
  position: { x: number; y: number }
) {
  const canvas = outputSize(framing)
  const fit = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight)
  const fill = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight)
  const scale = (framing.mode === 'fit' ? fit : fill) * framing.zoom
  const width = even(sourceWidth * scale),
    height = even(sourceHeight * scale)
  const x = Math.floor(((canvas.width - width) * position.x) / 2) * 2
  const y = Math.floor(((canvas.height - height) * position.y) / 2) * 2
  const sx = width / sourceWidth,
    sy = height / sourceHeight
  const left = Math.max(0, -x / sx),
    top = Math.max(0, -y / sy)
  const right = Math.min(sourceWidth, (canvas.width - x) / sx)
  const bottom = Math.min(sourceHeight, (canvas.height - y) / sy)
  return {
    canvas,
    width,
    height,
    x,
    y,
    visible: { x: left, y: top, width: right - left, height: bottom - top },
    cropped: width > canvas.width || height > canvas.height
  }
}
export function blurredBackgroundLayout(
  sourceWidth: number,
  sourceHeight: number,
  framing: FramingSettings
) {
  const canvas = outputSize(framing),
    padding = Math.ceil((framing.blur * 3) / 2) * 2
  const paddedWidth = canvas.width + padding * 2,
    paddedHeight = canvas.height + padding * 2
  const scale = Math.max(paddedWidth / sourceWidth, paddedHeight / sourceHeight)
  const width = even(sourceWidth * scale),
    height = even(sourceHeight * scale)
  return {
    width,
    height,
    padding,
    paddedWidth,
    paddedHeight,
    x: Math.floor((canvas.width - width) / 4) * 2,
    y: Math.floor((canvas.height - height) / 4) * 2
  }
}
