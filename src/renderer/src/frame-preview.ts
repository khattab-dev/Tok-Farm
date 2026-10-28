import { blurredBackgroundLayout, frameLayout, type FramingSettings } from '../../shared/framing'
import type { Media } from '../../shared/model'

export function drawFramedPreview(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  media: Media,
  framing: FramingSettings,
  position: { x: number; y: number }
) {
  const layout = frameLayout(media.width, media.height, framing, position)
  const scale = context.canvas.width / layout.canvas.width
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  context.fillStyle = framing.backgroundColor
  context.fillRect(0, 0, context.canvas.width, context.canvas.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (
    framing.background === 'blur' &&
    (layout.width < layout.canvas.width || layout.height < layout.canvas.height)
  ) {
    const back = blurredBackgroundLayout(media.width, media.height, framing)
    context.filter = `blur(${framing.blur * scale}px)`
    context.drawImage(
      video,
      back.x * scale,
      back.y * scale,
      back.width * scale,
      back.height * scale
    )
  }
  context.filter = 'none'
  context.drawImage(
    video,
    layout.x * scale,
    layout.y * scale,
    layout.width * scale,
    layout.height * scale
  )
}
