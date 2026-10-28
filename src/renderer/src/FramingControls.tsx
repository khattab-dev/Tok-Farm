import { Copy, Crosshair, RotateCcw } from 'lucide-react'
import type { FramingSettings } from '../../shared/framing'
import { outputSize } from '../../shared/framing'

export function FramingControls({
  value,
  position,
  onChange,
  onPosition,
  onUseDefault,
  onApplyAll,
  shotCount,
  selected
}: {
  value: FramingSettings
  position: { x: number; y: number }
  onChange: (patch: Partial<FramingSettings>) => void
  onPosition: (value: { x: number; y: number }) => void
  onUseDefault: () => void
  onApplyAll: () => void
  shotCount: number
  selected: boolean
}) {
  const size = outputSize(value)
  return (
    <div className="framing-settings" data-framing-controls>
      <p className="framing-context">
        {selected ? 'Layout for this shot' : 'Default layout for new shots'}{' '}
        <span>
          {size.width} × {size.height}
        </span>
      </p>
      <label className="framing-field">
        PICTURE SIZE
        <select
          aria-label="Framing mode"
          value={value.mode}
          onChange={(event) =>
            onChange({ mode: event.target.value as FramingSettings['mode'], zoom: 1 })
          }
        >
          <option value="fill">Fill frame · crop edges</option>
          <option value="fit">Fit full video · keep everything</option>
        </select>
      </label>
      <label className="framing-field">
        BACKGROUND
        <select
          aria-label="Frame background"
          value={value.background}
          onChange={(event) =>
            onChange({ background: event.target.value as FramingSettings['background'] })
          }
        >
          <option value="blur">Blurred video</option>
          <option value="color">Solid color</option>
        </select>
      </label>
      {value.background === 'color' ? (
        <label className="color-setting">
          <span>Background color</span>
          <input
            type="color"
            aria-label="Background color"
            value={value.backgroundColor}
            onChange={(event) => onChange({ backgroundColor: event.target.value })}
          />
          <code>{value.backgroundColor}</code>
        </label>
      ) : (
        <label className="framing-slider">
          <span>
            Background blur <b>{value.blur}</b>
          </span>
          <input
            aria-label="Background blur"
            type="range"
            min={4}
            max={60}
            step={1}
            value={value.blur}
            onChange={(event) => onChange({ blur: Number(event.target.value) })}
          />
        </label>
      )}
      <label className="framing-slider">
        <span>
          Zoom <b>{Math.round(value.zoom * 100)}%</b>
          <button
            className="icon-button"
            type="button"
            title="Reset zoom to 100%"
            onClick={() => onChange({ zoom: 1 })}
          >
            <RotateCcw size={11} />
          </button>
        </span>
        <input
          aria-label="Video zoom"
          type="range"
          min={25}
          max={300}
          step={1}
          value={Math.round(value.zoom * 100)}
          onChange={(event) => onChange({ zoom: Number(event.target.value) / 100 })}
        />
      </label>
      <label className="framing-slider">
        <span>
          Horizontal position <b>{Math.round(position.x * 100)}%</b>
        </span>
        <input
          aria-label="Horizontal position"
          type="range"
          min={0}
          max={100}
          step={1}
          value={position.x * 100}
          onChange={(event) => onPosition({ ...position, x: Number(event.target.value) / 100 })}
        />
      </label>
      <label className="framing-slider">
        <span>
          Vertical position <b>{Math.round(position.y * 100)}%</b>
        </span>
        <input
          aria-label="Vertical position"
          type="range"
          min={0}
          max={100}
          step={1}
          value={position.y * 100}
          onChange={(event) => onPosition({ ...position, y: Number(event.target.value) / 100 })}
        />
      </label>
      <button
        className="secondary-button full-width center-picture"
        onClick={() => onPosition({ x: 0.5, y: 0.5 })}
      >
        <Crosshair size={12} /> Center at playhead
      </button>
      <p className="framing-help">
        Fit at 100% shows the whole picture. Drag the reel preview to position it. Background fills
        any empty space.
      </p>
      <div className="framing-batch">
        {selected && (
          <button className="secondary-button full-width" onClick={onUseDefault}>
            <Copy size={12} /> Use for new shots
          </button>
        )}
        {shotCount > 0 && (
          <button className="text-button full-width" onClick={onApplyAll}>
            Apply layout to all {shotCount} {shotCount === 1 ? 'shot' : 'shots'}
          </button>
        )}
      </div>
    </div>
  )
}
