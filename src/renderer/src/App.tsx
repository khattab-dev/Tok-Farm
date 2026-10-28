import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crop,
  Download,
  Film,
  FolderOpen,
  Frame,
  Keyboard,
  LoaderCircle,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  ScanSearch,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type {
  Clip,
  CropKeyframe,
  ExportJob,
  Media,
  Project,
  ProjectSummary,
  QueueState,
  Thumbnail
} from '../../shared/model'
import type { HighlightScan, HighlightSuggestion, ScanOptions } from '../../shared/highlights'
import { HighlightPanel } from './HighlightPanel'
import { cropGeometry, parseTimecode, positionAt, timecode } from '../../shared/crop'

const api = window.tokfarm
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const durationLabel = (value: number) =>
  value < 60 ? `${value.toFixed(1)}s` : `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`
const errorText = (error: unknown) =>
  String((error as Error)?.message || error).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  )

function TimeInput({
  value,
  onChange,
  label
}: {
  value: number
  onChange: (value: number) => void
  label: string
}) {
  const [text, setText] = useState(timecode(value, true))
  useEffect(() => setText(timecode(value, true)), [value])
  function commit() {
    const parsed = parseTimecode(text)
    if (parsed !== null) onChange(parsed)
    setText(timecode(value, true))
  }
  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setText(timecode(value, true))
            e.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

function Logo() {
  return (
    <div className="brand">
      <div className="brand-icon">
        <Scissors size={22} strokeWidth={2.7} />
      </div>
      <span>
        tok<span className="brand-light">farm</span>
        <span className="brand-period">.</span>
      </span>
    </div>
  )
}

function Player({
  media,
  url,
  clip,
  draftKeys,
  videoRef,
  currentTime,
  onTime,
  onCrop,
  notify,
  onDecodeError
}: {
  media: Media
  url: string
  clip?: Clip
  draftKeys: CropKeyframe[]
  videoRef: RefObject<HTMLVideoElement | null>
  currentTime: number
  onTime: (time: number) => void
  onCrop: (position: { x: number; y: number }, time: number) => void
  notify: (message: string) => void
  onDecodeError: () => void
}) {
  const stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 640, height: 360 })
  const [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{
    pointerX: number
    pointerY: number
    x: number
    y: number
    time: number
    latest: { x: number; y: number }
  } | null>(null)
  const keys = clip?.keyframes || draftKeys
  const pos = drag || positionAt(keys, currentTime),
    geometry = cropGeometry(media.width, media.height, pos.x, pos.y)
  const state = useRef({ keys, drag, clip })
  state.current = { keys, drag, clip }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const ratio = media.width / media.height,
        width = Math.min(entry.contentRect.width, entry.contentRect.height * ratio)
      setSize({ width, height: width / ratio })
    })
    if (stage.current) observer.observe(stage.current)
    return () => observer.disconnect()
  }, [media.width, media.height])
  useEffect(() => {
    let frame = 0,
      lastTime = -1
    function draw() {
      const video = videoRef.current,
        context = canvas.current?.getContext('2d')
      if (video && video.readyState >= 2) {
        if (Math.abs(video.currentTime - lastTime) > 0.02) {
          lastTime = video.currentTime
          onTime(video.currentTime)
        }
        const position = state.current.drag || positionAt(state.current.keys, video.currentTime)
        const rect = cropGeometry(media.width, media.height, position.x, position.y)
        context?.drawImage(
          video,
          (rect.x / media.width) * video.videoWidth,
          (rect.y / media.height) * video.videoHeight,
          (rect.width / media.width) * video.videoWidth,
          (rect.height / media.height) * video.videoHeight,
          0,
          0,
          360,
          640
        )
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [media, videoRef, onTime])
  function togglePlayback() {
    const video = videoRef.current
    if (video) {
      if (video.paused) void video.play().catch((e) => notify(errorText(e)))
      else video.pause()
    }
  }
  function moveCrop(event: ReactPointerEvent) {
    const start = dragRef.current
    if (!start) return
    const availableX = size.width * (1 - geometry.width / media.width),
      availableY = size.height * (1 - geometry.height / media.height)
    const next = {
      x:
        availableX > 0 ? clamp(start.x + (event.clientX - start.pointerX) / availableX, 0, 1) : 0.5,
      y: availableY > 0 ? clamp(start.y + (event.clientY - start.pointerY) / availableY, 0, 1) : 0.5
    }
    start.latest = next
    setDrag(next)
  }
  return (
    <section className="viewer-panel">
      <div className="viewer-head">
        <div>
          <span className="section-kicker">THE BIG PICTURE</span>
          <h2>
            Source monitor <span className="subtle-badge">{media.height}p</span>
          </h2>
        </div>
        <div className="source-meta">
          <span className="green-dot" />
          {Math.round(media.fps * 100) / 100} fps <span>·</span> {timecode(media.duration)}
        </div>
      </div>
      <div className="monitors">
        <div className="source-column">
          <div className="source-stage" ref={stage}>
            <div className="source-picture" style={{ width: size.width, height: size.height }}>
              <video
                ref={videoRef}
                src={url}
                crossOrigin="anonymous"
                preload="auto"
                muted={clip?.muted || false}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={onDecodeError}
                onLoadedMetadata={() => {
                  if (videoRef.current) videoRef.current.playbackRate = speed
                }}
              />
              <div
                className="crop-shade"
                style={{
                  left: `${(geometry.x / media.width) * 100}%`,
                  top: `${(geometry.y / media.height) * 100}%`,
                  width: `${(geometry.width / media.width) * 100}%`,
                  height: `${(geometry.height / media.height) * 100}%`
                }}
              />
              <div
                className={`crop-overlay ${drag ? 'is-dragging' : ''}`}
                data-testid="crop-overlay"
                style={{
                  left: `${(geometry.x / media.width) * 100}%`,
                  top: `${(geometry.y / media.height) * 100}%`,
                  width: `${(geometry.width / media.width) * 100}%`,
                  height: `${(geometry.height / media.height) * 100}%`
                }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  const time = clip
                    ? clamp(videoRef.current?.currentTime || 0, clip.start, clip.end)
                    : videoRef.current?.currentTime || 0
                  if (videoRef.current) {
                    videoRef.current.pause()
                    videoRef.current.currentTime = time
                  }
                  dragRef.current = {
                    pointerX: event.clientX,
                    pointerY: event.clientY,
                    x: pos.x,
                    y: pos.y,
                    time,
                    latest: pos
                  }
                  setDrag(pos)
                }}
                onPointerMove={moveCrop}
                onPointerUp={() => {
                  if (dragRef.current) onCrop(dragRef.current.latest, dragRef.current.time)
                  dragRef.current = null
                  setDrag(null)
                }}
                onPointerCancel={() => {
                  dragRef.current = null
                  setDrag(null)
                }}
              >
                <span className="crop-tag">
                  <Crop size={10} /> 9:16
                </span>
                <span className="crop-cross">+</span>
                <i className="corner tl" />
                <i className="corner tr" />
                <i className="corner bl" />
                <i className="corner br" />
              </div>
            </div>
          </div>
          <div className="player-controls">
            <span className="player-time">
              {timecode(currentTime, true)}
              <span> / {timecode(media.duration)}</span>
            </span>
            <div className="transport">
              <button
                className="icon-button"
                title="Back 5 seconds"
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = Math.max(0, currentTime - 5)
                }}
              >
                <SkipBack size={16} />
              </button>
              <button
                className="play-button"
                aria-label={playing ? 'Pause playback' : 'Play video'}
                onClick={togglePlayback}
              >
                {playing ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
              </button>
              <button
                className="icon-button"
                title="Forward 5 seconds"
                onClick={() => {
                  if (videoRef.current)
                    videoRef.current.currentTime = Math.min(media.duration, currentTime + 5)
                }}
              >
                <SkipForward size={16} />
              </button>
            </div>
            <select
              className="speed-select"
              aria-label="Playback speed"
              value={speed}
              onChange={(event) => {
                const next = Number(event.target.value)
                setSpeed(next)
                if (videoRef.current) videoRef.current.playbackRate = next
              }}
            >
              {[0.25, 0.5, 1, 1.5, 2].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}×
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="vertical-column">
          <div className="preview-label">
            <Frame size={13} /> REEL PREVIEW
          </div>
          <div className="vertical-frame">
            <canvas ref={canvas} width={360} height={640} />
            <span className="preview-live">LIVE</span>
          </div>
          <span className="preview-resolution">
            1080 × 1920 <span>·</span> 9:16
          </span>
        </div>
      </div>
      <div className="viewer-foot">
        <Crop size={13} />
        <span>Drag the frame to set a crop position at the playhead.</span>
        <span className="original-audio">
          {clip?.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          {clip?.muted ? 'Audio muted' : 'Original audio'}
        </span>
      </div>
    </section>
  )
}

function Timeline({
  media,
  thumbnails,
  clips,
  range,
  time,
  activeId,
  seek,
  select
}: {
  media: Media
  thumbnails: Thumbnail[]
  clips: Clip[]
  range: { start: number; end: number }
  time: number
  activeId?: string
  seek: (time: number) => void
  select: (clip: Clip) => void
}) {
  const [zoom, setZoom] = useState(1),
    [scrubbing, setScrubbing] = useState(false)
  const pointerSeek = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    seek(clamp(((event.clientX - rect.left) / rect.width) * media.duration, 0, media.duration))
  }
  return (
    <section className="timeline-panel">
      <div className="panel-heading">
        <div>
          <Film size={15} />
          <h3>Video timeline</h3>
          <span className="muted">{clips.length} shots marked</span>
        </div>
        <div className="zoom-controls">
          <button
            className="icon-button"
            aria-label="Zoom out timeline"
            disabled={zoom === 1}
            onClick={() => setZoom(Math.max(1, zoom / 2))}
          >
            <Minus size={14} />
          </button>
          <span>{zoom}×</span>
          <button
            className="icon-button"
            aria-label="Zoom in timeline"
            disabled={zoom === 8}
            onClick={() => setZoom(Math.min(8, zoom * 2))}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="timeline-scroll">
        <div
          className="timeline-content"
          style={{ width: `${zoom * 100}%` }}
          onPointerDown={(event) => {
            setScrubbing(true)
            event.currentTarget.setPointerCapture(event.pointerId)
            pointerSeek(event)
          }}
          onPointerMove={(event) => {
            if (scrubbing) pointerSeek(event)
          }}
          onPointerUp={() => setScrubbing(false)}
          onPointerCancel={() => setScrubbing(false)}
        >
          <div className="ruler">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} style={{ left: `${(i / 8) * 100}%` }}>
                {timecode((i / 8) * media.duration)}
              </span>
            ))}
          </div>
          <div className="filmstrip">
            {thumbnails.length
              ? thumbnails.map((thumb) => (
                  <img src={thumb.url} alt="" key={thumb.time} draggable={false} />
                ))
              : Array.from({ length: 14 }, (_, i) => (
                  <div className="thumbnail-placeholder" key={i}>
                    <Film size={16} />
                  </div>
                ))}
          </div>
          <div
            className="range-highlight"
            style={{
              left: `${(range.start / media.duration) * 100}%`,
              width: `${((range.end - range.start) / media.duration) * 100}%`
            }}
          />
          <div className="shot-track">
            {clips.map((clip, i) => (
              <button
                key={clip.id}
                className={`timeline-clip ${activeId === clip.id ? 'active' : ''}`}
                title={`${clip.name}: ${timecode(clip.start)} – ${timecode(clip.end)}`}
                style={{
                  left: `${(clip.start / media.duration) * 100}%`,
                  width: `${((clip.end - clip.start) / media.duration) * 100}%`,
                  minWidth: 4
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  select(clip)
                }}
              >
                <span>
                  {String(i + 1).padStart(2, '0')} {clip.name}
                </span>
              </button>
            ))}
          </div>
          <div className="playhead" style={{ left: `${(time / media.duration) * 100}%` }}>
            <i />
          </div>
        </div>
      </div>
      <div className="timeline-legend">
        <span>
          <i className="legend-square orange" /> New selection
        </span>
        <span>
          <i className="legend-square green" /> Saved shots
        </span>
        <span className="timeline-tip">Click to seek · Drag to scrub</span>
      </div>
    </section>
  )
}

function JobCard({
  job,
  onAction,
  onReveal
}: {
  job: ExportJob
  onAction: (action: 'cancel' | 'retry' | 'up' | 'down', id: string) => void
  onReveal: (id: string) => void
}) {
  const statusLabels = {
    pending: 'Waiting',
    running: 'Exporting',
    completed: 'Ready',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted'
  }
  return (
    <div className={`job-card job-${job.status}`} data-testid="queue-job">
      <div className="job-top">
        <div className={`job-symbol ${job.status}`}>
          {job.status === 'completed' ? (
            <Check size={14} />
          ) : job.status === 'running' ? (
            <LoaderCircle size={14} className="spin" />
          ) : job.status === 'failed' || job.status === 'interrupted' ? (
            <RotateCcw size={13} />
          ) : (
            <Film size={13} />
          )}
        </div>
        <div className="job-name">
          <strong title={job.clip.name}>{job.clip.name}</strong>
          <span>
            {durationLabel(job.clip.end - job.clip.start)} <span>·</span> {statusLabels[job.status]}{' '}
            {job.status === 'running' ? `${Math.round(job.progress * 100)}%` : ''}
          </span>
        </div>
        {job.status === 'completed' ? (
          <button
            className="icon-button"
            title="Show exported reel in folder"
            onClick={() => onReveal(job.id)}
          >
            <FolderOpen size={15} />
          </button>
        ) : ['failed', 'cancelled', 'interrupted'].includes(job.status) ? (
          <button
            className="icon-button"
            title="Retry export"
            onClick={() => onAction('retry', job.id)}
          >
            <RotateCcw size={14} />
          </button>
        ) : (
          <button
            className="icon-button"
            title="Cancel export"
            onClick={() => onAction('cancel', job.id)}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {job.status === 'running' && (
        <div className="progress-track">
          <i style={{ width: `${job.progress * 100}%` }} />
        </div>
      )}
      {job.status === 'pending' && (
        <div className="job-reorder">
          <span>Queued from {job.projectName}</span>
          <button
            className="icon-button"
            title="Move earlier"
            onClick={() => onAction('up', job.id)}
          >
            <ArrowUp size={12} />
          </button>
          <button
            className="icon-button"
            title="Move later"
            onClick={() => onAction('down', job.id)}
          >
            <ArrowDown size={12} />
          </button>
        </div>
      )}
      {job.error && (
        <details className="job-error">
          <summary>View error</summary>
          <p>{job.error}</p>
        </details>
      )}
    </div>
  )
}

export function App() {
  const [showHighlights, setShowHighlights] = useState(false),
    [highlightScan, setHighlightScan] = useState<HighlightScan | null>(null)
  const [project, setProject] = useState<Project | null>(null),
    [projects, setProjects] = useState<ProjectSummary[]>([])
  const [queue, setQueue] = useState<QueueState>({ version: 1, running: false, jobs: [] })
  const [url, setUrl] = useState(''),
    [thumbnails, setThumbnails] = useState<Thumbnail[]>([])
  const [time, setTime] = useState(0),
    [range, setRange] = useState({ start: 0, end: 15 })
  const [activeId, setActiveId] = useState<string>(),
    [checked, setChecked] = useState<Set<string>>(new Set())
  const [draftKeys, setDraftKeys] = useState<CropKeyframe[]>([])
  const [loading, setLoading] = useState(false),
    [saved, setSaved] = useState('Saved locally')
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [mediaError, setMediaError] = useState(false),
    [sourceError, setSourceError] = useState('')
  const [proxyProgress, setProxyProgress] = useState<number | null>(null),
    [help, setHelp] = useState(false),
    [draggingFile, setDraggingFile] = useState(false)
  const video = useRef<HTMLVideoElement>(null),
    currentProject = useRef(project),
    saveSequence = useRef(0),
    loadSequence = useRef(0)
  const previewUntil = useRef<number | null>(null)
  currentProject.current = project
  const active = project?.clips.find((clip) => clip.id === activeId)
  const notify = useCallback((text: string, error = true) => setMessage({ text, error }), [])
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 6500)
    return () => clearTimeout(timer)
  }, [message])
  const report = useCallback((error: unknown) => notify(errorText(error)), [notify])

  const loadProject = useCallback(async (next: Project) => {
    if (currentProject.current && currentProject.current.id !== next.id)
      void api.cancelProxy(currentProject.current.id).catch(() => {})
    const sequence = ++loadSequence.current
    setProject(next)
    setActiveId(undefined)
    setChecked(new Set(next.clips.map((clip) => clip.id)))
    setRange({ start: 0, end: Math.min(15, next.media.duration) })
    setTime(0)
    setUrl('')
    setThumbnails([])
    setDraftKeys([])
    setSourceError('')
    setMediaError(false)
    setProxyProgress(null)
    setHighlightScan(null)
    void api
      .getHighlightScan(next.id)
      .then((scan) => {
        if (sequence === loadSequence.current) setHighlightScan(scan)
      })
      .catch(console.warn)
    try {
      const mediaUrl = await api.mediaUrl(next.id)
      if (sequence === loadSequence.current) setUrl(mediaUrl)
    } catch (error) {
      if (sequence === loadSequence.current) setSourceError(errorText(error))
    }
    void api
      .thumbnails(next.id)
      .then((items) => {
        if (sequence === loadSequence.current) setThumbnails(items)
      })
      .catch((error) => {
        if (sequence === loadSequence.current) console.warn('Thumbnail generation:', error)
      })
  }, [])
  useEffect(() => {
    void api
      .bootstrap()
      .then((data) => {
        setProjects(data.projects)
        setQueue(data.queue)
        if (data.project) void loadProject(data.project)
      })
      .catch(report)
    return api.onEvent((event) => {
      if (event.type === 'queue') setQueue(event.queue)
      else if (event.type === 'proxy-progress' && event.projectId === currentProject.current?.id)
        setProxyProgress(event.progress)
      else if (
        event.type === 'highlight-scan' &&
        event.scan.projectId === currentProject.current?.id
      )
        setHighlightScan(event.scan)
    })
  }, [loadProject, report])
  useEffect(() => {
    if (!project) return
    const sequence = ++saveSequence.current
    setSaved('Saving…')
    void api
      .saveProject(project)
      .then(() => {
        if (sequence === saveSequence.current) setSaved('Saved locally')
        setProjects((previous) => {
          const summary = {
            id: project.id,
            name: project.name,
            updatedAt: Date.now(),
            clipCount: project.clips.length,
            sourceName: project.media.name
          }
          return [summary, ...previous.filter((item) => item.id !== project.id)]
        })
      })
      .catch((error) => {
        if (sequence === saveSequence.current) setSaved('Save failed')
        report(error)
      })
  }, [project, report])

  const seek = useCallback((next: number) => {
    previewUntil.current = null
    setTime(next)
    if (video.current) video.current.currentTime = next
  }, [])
  const updatePlayhead = useCallback((value: number) => {
    setTime(value)
    if (previewUntil.current !== null && value >= previewUntil.current) {
      video.current?.pause()
      previewUntil.current = null
    }
  }, [])
  async function startHighlightScan(options: ScanOptions) {
    if (!project) return
    try {
      setHighlightScan(await api.startHighlightScan(project.id, options))
    } catch (error) {
      report(error)
    }
  }
  async function acceptHighlight(suggestion: HighlightSuggestion) {
    if (!project) return
    try {
      const clip = await api.acceptHighlight(project, suggestion.id)
      if (currentProject.current?.id !== project.id) return
      setProject((previous) =>
        previous?.id === project.id
          ? {
              ...previous,
              clips: previous.clips.some((item) => item.id === clip.id)
                ? previous.clips
                : [...previous.clips, clip]
            }
          : previous
      )
      setChecked((previous) => new Set([...previous, clip.id]))
      setActiveId(clip.id)
      seek(clip.start)
      notify('Suggestion added. Fine-tune its trim and framing in Shot settings.', false)
    } catch (error) {
      report(error)
    }
  }
  function previewHighlight(suggestion: HighlightSuggestion) {
    setActiveId(undefined)
    setDraftKeys([])
    setRange({ start: suggestion.start, end: suggestion.end })
    seek(suggestion.start)
    previewUntil.current = suggestion.end
    void video.current?.play().catch(report)
  }
  const updateClip = useCallback(
    (id: string, update: Partial<Clip>) =>
      setProject((previous) =>
        previous
          ? {
              ...previous,
              clips: previous.clips.map((clip) => (clip.id === id ? { ...clip, ...update } : clip))
            }
          : previous
      ),
    []
  )
  const selectClip = useCallback(
    (clip: Clip) => {
      setActiveId(clip.id)
      seek(clip.start)
    },
    [seek]
  )
  async function importVideo(path?: string) {
    setLoading(true)
    try {
      const next = await api.importVideo(path)
      if (next) {
        await loadProject(next)
        notify('Video imported. Mark your first moment with I and O.', false)
      }
    } catch (error) {
      report(error)
    } finally {
      setLoading(false)
    }
  }
  const addShot = useCallback(() => {
    if (!project || range.end <= range.start || range.end > project.media.duration) {
      notify('Set a valid start and end within the source video.')
      return
    }
    const clip: Clip = {
      id: crypto.randomUUID(),
      name: `Shot ${String(project.clips.length + 1).padStart(2, '0')}`,
      ...range,
      muted: false,
      keyframes: draftKeys.length
        ? structuredClone(draftKeys)
        : [{ id: crypto.randomUUID(), time: range.start, x: 0.5, y: 0.5 }]
    }
    setProject({ ...project, clips: [...project.clips, clip] })
    setActiveId(clip.id)
    setChecked((previous) => new Set([...previous, clip.id]))
    notify(`${clip.name} added to your shots.`, false)
  }, [project, range, draftKeys, notify])
  const markIn = useCallback(() => {
    if (!project) return
    const at = video.current?.currentTime || 0
    if (at >= project.media.duration - 0.01) return
    setRange((previous) => ({
      start: at,
      end: previous.end > at ? previous.end : Math.min(project.media.duration, at + 15)
    }))
    setActiveId(undefined)
  }, [project])
  const markOut = useCallback(() => {
    if (!project) return
    const at = video.current?.currentTime || 0
    if (at <= range.start) {
      notify('The out point must be after the in point.')
      return
    }
    setRange((previous) => ({ ...previous, end: Math.min(at, project.media.duration) }))
    setActiveId(undefined)
  }, [project, range.start, notify])
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (
        help ||
        (event.target as HTMLElement)?.closest(
          'input, textarea, select, [contenteditable="true"], [data-highlight-panel]'
        ) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return
      if (!project) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (video.current?.paused) void video.current.play().catch(report)
        else video.current?.pause()
      } else if (event.key.toLowerCase() === 'i') {
        event.preventDefault()
        markIn()
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        markOut()
      } else if (event.key === 'Enter') {
        if ((event.target as HTMLElement)?.closest('button')) return
        event.preventDefault()
        addShot()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        seek(
          clamp(
            (video.current?.currentTime || 0) +
              (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 5 : 1 / project.media.fps),
            0,
            project.media.duration
          )
        )
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [project, help, markIn, markOut, addShot, seek, report])

  function setCrop(position: { x: number; y: number }, at: number) {
    const existing = active?.keyframes || draftKeys
    const keyTime = active ? clamp(at, active.start, active.end) : at
    const near = existing.find(
      (key) => Math.abs(key.time - keyTime) < 0.5 / (project?.media.fps || 30)
    )
    const keyframes = near
      ? existing.map((key) => (key.id === near.id ? { ...key, ...position } : key))
      : [...existing, { id: crypto.randomUUID(), time: keyTime, ...position }]
    if (keyframes.length > 200) {
      notify('A shot can have up to 200 crop positions.')
      return
    }
    if (active) updateClip(active.id, { keyframes: keyframes.sort((a, b) => a.time - b.time) })
    else setDraftKeys(keyframes.sort((a, b) => a.time - b.time))
  }
  function changeTrim(axis: 'start' | 'end', value: number) {
    if (!project || !active) return
    const next = { ...active, [axis]: value }
    if (next.start < 0 || next.end > project.media.duration || next.end <= next.start) {
      notify('Shot start and end must form a valid range inside the video.')
      return
    }
    updateClip(active.id, { [axis]: value })
  }
  async function chooseOutput() {
    try {
      const directory = await api.chooseOutputDirectory()
      if (directory)
        setProject((previous) =>
          previous ? { ...previous, outputDirectory: directory } : previous
        )
    } catch (error) {
      report(error)
    }
  }
  async function enqueue(all = false) {
    if (!project) return
    let next = project
    try {
      if (!next.outputDirectory) {
        const directory = await api.chooseOutputDirectory()
        if (!directory) return
        next = { ...next, outputDirectory: directory }
        setProject(next)
      }
      const ids = all ? next.clips.map((clip) => clip.id) : [...checked]
      if (!ids.length) {
        notify('Check the shots you want to export.')
        return
      }
      setQueue(await api.enqueue(next, ids))
      notify(
        `${ids.length} ${ids.length === 1 ? 'reel' : 'reels'} added to the export queue.`,
        false
      )
    } catch (error) {
      report(error)
    }
  }
  async function queueAction(
    action: 'start' | 'pause' | 'cancel' | 'retry' | 'up' | 'down' | 'clear',
    id?: string
  ) {
    try {
      setQueue(await api.queueAction(action, id))
    } catch (error) {
      report(error)
    }
  }
  async function convertPreview() {
    if (!project) return
    const id = project.id
    setProxyProgress(0)
    try {
      const proxyUrl = await api.createProxy(id)
      if (currentProject.current?.id === id) {
        setUrl(proxyUrl)
        setMediaError(false)
      }
    } catch (error) {
      if (!errorText(error).includes('Cancelled')) report(error)
    } finally {
      if (currentProject.current?.id === id) setProxyProgress(null)
    }
  }
  async function relink() {
    if (!project) return
    try {
      const next = await api.relinkSource(project.id)
      if (next) await loadProject(next)
    } catch (error) {
      report(error)
    }
  }
  const pending = queue.jobs.filter((job) => job.status === 'pending').length,
    completed = queue.jobs.filter((job) => job.status === 'completed').length
  const running = queue.jobs.find((job) => job.status === 'running')

  return (
    <div
      className={`app ${draggingFile ? 'file-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        if (event.dataTransfer.types.includes('Files')) setDraggingFile(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingFile(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDraggingFile(false)
        const file = event.dataTransfer.files[0]
        if (file) {
          try {
            void importVideo(api.droppedFilePath(file))
          } catch (error) {
            report(error)
          }
        }
      }}
    >
      <header className="app-header">
        <Logo />
        <span className="header-divider" />
        <span className="app-tagline">Long videos. Great moments.</span>
        <div className="header-actions">
          <span className="local-label">
            <span className="green-dot" /> LOCAL WORKSPACE
          </span>
          <button
            className={`secondary-button scan-launch-button ${showHighlights ? 'selected' : ''}`}
            disabled={!project}
            onClick={() => setShowHighlights(!showHighlights)}
          >
            <ScanSearch size={14} /> Find highlights{' '}
            {highlightScan?.status === 'running' && <LoaderCircle size={12} className="spin" />}
          </button>
          <button
            className="icon-button help-button"
            title="Keyboard shortcuts"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={19} />
          </button>
          <button
            className="primary-button import-button"
            onClick={() => void importVideo()}
            disabled={loading}
          >
            {loading ? <LoaderCircle size={15} className="spin" /> : <Plus size={17} />}{' '}
            {loading ? 'Opening video…' : 'Import video'}
          </button>
        </div>
      </header>

      <div className="editor-layout">
        <aside className="library-sidebar">
          <div className="library-heading">
            <span className="section-kicker">YOUR WORKSPACE</span>
            <span className="version-label">v1.1</span>
          </div>
          <div className="project-selector">
            <div className="project-folder">
              <FolderOpen size={18} />
            </div>
            <div>
              <span>Current project</span>
              <select
                aria-label="Open project"
                value={project?.id || ''}
                onChange={(event) => {
                  void api.openProject(event.target.value).then(loadProject).catch(report)
                }}
              >
                {!project && <option value="">No video imported</option>}
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <ChevronDown size={13} />
          </div>
          {showHighlights && project ? (
            <HighlightPanel
              key={project.id}
              scan={highlightScan}
              onStart={startHighlightScan}
              onCancel={async () => {
                try {
                  await api.cancelHighlightScan(project.id)
                } catch (error) {
                  report(error)
                }
              }}
              onPreview={previewHighlight}
              onAccept={acceptHighlight}
              onDismiss={async (id) => {
                try {
                  await api.dismissHighlight(project.id, id)
                } catch (error) {
                  report(error)
                }
              }}
              onBack={() => setShowHighlights(false)}
            />
          ) : (
            <>
              <div className="shots-heading">
                <h2>
                  <Scissors size={16} /> Your shots <span>{project?.clips.length || 0}</span>
                </h2>
                <button
                  className="icon-button"
                  title="New selection"
                  disabled={!project}
                  onClick={() => {
                    setActiveId(undefined)
                    setDraftKeys([])
                    setRange({
                      start: Math.min(time, (project?.media.duration || 1) - 0.01),
                      end: Math.min(time + 15, project?.media.duration || 15)
                    })
                  }}
                >
                  <Plus size={16} />
                </button>
              </div>
              <p className="sidebar-description">Little moments. Ready for the feed.</p>
              <div className="shot-list">
                {project?.clips.length ? (
                  project.clips.map((clip, index) => (
                    <div
                      key={clip.id}
                      className={`shot-card ${activeId === clip.id ? 'selected' : ''}`}
                      data-testid="shot-card"
                    >
                      <input
                        type="checkbox"
                        className="shot-checkbox"
                        aria-label={`Select ${clip.name} for export`}
                        checked={checked.has(clip.id)}
                        onChange={(event) =>
                          setChecked((previous) => {
                            const next = new Set(previous)
                            if (event.target.checked) next.add(clip.id)
                            else next.delete(clip.id)
                            return next
                          })
                        }
                      />
                      <button className="shot-select" onClick={() => selectClip(clip)}>
                        <div className="shot-thumbnail">
                          {thumbnails.length ? (
                            <img
                              src={
                                thumbnails[
                                  Math.min(
                                    thumbnails.length - 1,
                                    Math.floor(
                                      (clip.start / project.media.duration) * thumbnails.length
                                    )
                                  )
                                ].url
                              }
                              alt=""
                            />
                          ) : (
                            <Film size={18} />
                          )}
                          <span>{String(index + 1).padStart(2, '0')}</span>
                        </div>
                        <div className="shot-info">
                          <strong>{clip.name}</strong>
                          <span>
                            {timecode(clip.start)} <span>·</span>{' '}
                            {durationLabel(clip.end - clip.start)}
                          </span>
                          <span className="shot-format">
                            9:16 <span>•</span> {clip.keyframes.length} crop{' '}
                            {clip.keyframes.length === 1 ? 'position' : 'positions'}{' '}
                            {clip.muted && <VolumeX size={10} />}
                          </span>
                        </div>
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-shots">
                    <div className="empty-shot-icon">
                      <Scissors size={24} />
                    </div>
                    <strong>Your highlights start here</strong>
                    <p>
                      Mark an in and out point,
                      <br />
                      then add your first shot.
                    </p>
                    <div className="key-sequence">
                      <kbd>I</kbd>
                      <ChevronRight size={11} />
                      <kbd>O</kbd>
                      <ChevronRight size={11} />
                      <kbd>↵</kbd>
                    </div>
                  </div>
                )}
              </div>
              <div className="sidebar-bottom">
                <button
                  className="primary-button full-width"
                  disabled={!project?.clips.length || !checked.size}
                  onClick={() => void enqueue()}
                >
                  <Download size={15} /> Queue selected{' '}
                  <span className="button-counter">{checked.size}</span>
                </button>
                <button
                  className="text-button full-width"
                  disabled={!project?.clips.length}
                  onClick={() => void enqueue(true)}
                >
                  Queue all shots <ArrowRight size={13} />
                </button>
                <div className="sidebar-tip">
                  <Sparkles size={13} />
                  <span>
                    One shot. One reel.
                    <br />
                    Keep the moments coming.
                  </span>
                </div>
              </div>
            </>
          )}
        </aside>

        <main className="workspace">
          <div className="workspace-title">
            <div className="breadcrumb">
              WORKSPACE <ChevronRight size={11} />{' '}
              <span>{project ? 'Video editor' : 'Getting started'}</span>
            </div>
            <div className="project-title-row">
              {project ? (
                <input
                  className="project-title"
                  aria-label="Project name"
                  value={project.name}
                  maxLength={120}
                  onChange={(event) => {
                    if (event.target.value.trim())
                      setProject({ ...project, name: event.target.value })
                  }}
                />
              ) : (
                <h1>Make every moment count.</h1>
              )}
              <span className="autosave">
                <CheckCircle2 size={12} />
                {project ? saved : 'Made for your highlights'}
              </span>
            </div>
          </div>
          {project ? (
            <>
              {sourceError ? (
                <div className="source-error">
                  <Film size={32} />
                  <h2>Let’s find your source video</h2>
                  <p>{sourceError}</p>
                  <button className="primary-button" onClick={() => void relink()}>
                    <FolderOpen size={15} /> Relink source
                  </button>
                </div>
              ) : (
                <div className="viewer-container">
                  <Player
                    media={project.media}
                    url={url}
                    clip={active}
                    draftKeys={draftKeys}
                    videoRef={video}
                    currentTime={time}
                    onTime={updatePlayhead}
                    onCrop={setCrop}
                    notify={notify}
                    onDecodeError={() => {
                      if (url) setMediaError(true)
                    }}
                  />
                  {mediaError && (
                    <div className="decode-overlay">
                      <Film size={30} />
                      <h3>This video needs a preview copy</h3>
                      <p>
                        Convert it for smooth playback. Your reels will still export from the
                        original video.
                      </p>
                      {proxyProgress !== null ? (
                        <>
                          <div className="progress-track">
                            <i style={{ width: `${proxyProgress * 100}%` }} />
                          </div>
                          <span>{Math.round(proxyProgress * 100)}% · Preparing preview</span>
                          <button
                            className="secondary-button"
                            onClick={() => void api.cancelProxy(project.id).catch(report)}
                          >
                            Cancel conversion
                          </button>
                        </>
                      ) : (
                        <button className="primary-button" onClick={() => void convertPreview()}>
                          Create preview copy
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="mark-panel">
                <div className="mark-heading">
                  <span className="step-number">01</span>
                  <div>
                    <h3>Catch a moment</h3>
                    <span>Set your boundaries. Make it a shot.</span>
                  </div>
                </div>
                <div className="mark-inputs">
                  <div className="mark-control">
                    <button title="Mark in at playhead (I)" onClick={markIn}>
                      <span>[</span> IN <kbd>I</kbd>
                    </button>
                    <TimeInput
                      label="Selection in"
                      value={range.start}
                      onChange={(value) => {
                        if (value >= 0 && value < range.end) setRange({ ...range, start: value })
                        else notify('In point must be before the out point.')
                      }}
                    />
                  </div>
                  <span className="mark-arrow">→</span>
                  <div className="mark-control">
                    <button title="Mark out at playhead (O)" onClick={markOut}>
                      <span>]</span> OUT <kbd>O</kbd>
                    </button>
                    <TimeInput
                      label="Selection out"
                      value={range.end}
                      onChange={(value) => {
                        if (value > range.start && value <= project.media.duration)
                          setRange({ ...range, end: value })
                        else notify('Out point must be after the in point and inside the video.')
                      }}
                    />
                  </div>
                  <div className="selection-duration">
                    <Clock3 size={12} />
                    {durationLabel(range.end - range.start)}
                  </div>
                  <button className="primary-button add-shot" onClick={addShot}>
                    <Plus size={15} /> Add shot <kbd>↵</kbd>
                  </button>
                </div>
              </div>
              <Timeline
                media={project.media}
                thumbnails={thumbnails}
                clips={project.clips}
                range={range}
                time={time}
                activeId={activeId}
                seek={seek}
                select={selectClip}
              />
              <div className="workspace-hint">
                <Keyboard size={14} />
                <span>
                  <kbd>Space</kbd> Play / pause
                </span>
                <span>
                  <kbd>I</kbd> Mark in
                </span>
                <span>
                  <kbd>O</kbd> Mark out
                </span>
                <span>
                  <kbd>↵</kbd> Add shot
                </span>
                <span>
                  <kbd>←</kbd>
                  <kbd>→</kbd> Step frame
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="welcome-panel">
                <div className="welcome-grid" />
                <div className="welcome-topline">
                  <span className="green-dot" /> FROM FOOTAGE TO FEED
                </div>
                <div className="welcome-graphic">
                  <div className="graphic-landscape">
                    <div className="pitch">
                      <i className="pitch-center" />
                      <i className="pitch-left" />
                      <i className="pitch-right" />
                      <i className="pitch-ball" />
                    </div>
                    <div className="graphic-crop">
                      <span>9:16</span>
                    </div>
                    <div className="graphic-play">
                      <Play size={19} fill="currentColor" />
                    </div>
                  </div>
                  <div className="graphic-reel">
                    <div className="mini-pitch">
                      <i />
                    </div>
                    <span>
                      <Scissors size={12} /> REEL READY
                    </span>
                  </div>
                  <span className="graphic-arrow">↗</span>
                </div>
                <h2>
                  Your full video.
                  <br />
                  <span>Only the moments that matter.</span>
                </h2>
                <p>
                  Bring your footage. Pick the action.
                  <br />
                  Turn every great play into a reel of its own.
                </p>
                <button
                  className="primary-button welcome-import"
                  onClick={() => void importVideo()}
                  disabled={loading}
                >
                  <Upload size={17} />
                  {loading ? 'Opening your video…' : 'Choose a video'}
                  <ArrowRight size={16} />
                </button>
                <span className="drop-hint">
                  or drop your video anywhere here <span>·</span> MP4, MOV, MKV
                </span>
              </div>
              <div className="workflow-cards">
                <div>
                  <span>01</span>
                  <Scissors size={18} />
                  <h3>Mark your moments</h3>
                  <p>Find the play. Set the start and end.</p>
                </div>
                <div>
                  <span>02</span>
                  <Crop size={18} />
                  <h3>Follow the action</h3>
                  <p>Move the vertical frame as the play unfolds.</p>
                </div>
                <div>
                  <span>03</span>
                  <Download size={18} />
                  <h3>Queue. Export. Repeat.</h3>
                  <p>Keep editing while your reels render.</p>
                </div>
              </div>
            </>
          )}
        </main>

        <aside className="details-sidebar">
          <section className="inspector">
            <div className="panel-heading">
              <div>
                <Crop size={15} />
                <h3>Shot settings</h3>
              </div>
              <span className="subtle-badge">9:16</span>
            </div>
            {active && project ? (
              <>
                <label className="field-label">
                  SHOT NAME
                  <input
                    aria-label="Shot name"
                    maxLength={120}
                    value={active.name}
                    onChange={(event) => {
                      if (event.target.value.trim())
                        updateClip(active.id, { name: event.target.value })
                    }}
                  />
                </label>
                <div className="trim-fields">
                  <TimeInput
                    label="Shot start"
                    value={active.start}
                    onChange={(value) => changeTrim('start', value)}
                  />
                  <TimeInput
                    label="Shot end"
                    value={active.end}
                    onChange={(value) => changeTrim('end', value)}
                  />
                </div>
                <div className="audio-setting">
                  <span>
                    {active.muted ? <VolumeX size={14} /> : <Volume2 size={14} />} Original audio
                  </span>
                  <button
                    className={`toggle ${!active.muted ? 'on' : ''}`}
                    role="switch"
                    aria-checked={!active.muted}
                    aria-label="Keep original audio"
                    onClick={() => updateClip(active.id, { muted: !active.muted })}
                  >
                    <i />
                  </button>
                </div>
                <div className="keyframe-heading">
                  <span>
                    CROP POSITIONS <b>{active.keyframes.length}</b>
                  </span>
                  <button
                    className="icon-button"
                    title="Add crop keyframe at playhead"
                    aria-label="Add crop position"
                    onClick={() => setCrop(positionAt(active.keyframes, time), time)}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="keyframe-list">
                  {active.keyframes.map((key, index) => (
                    <div
                      className={`keyframe-row ${key.time < active.start || key.time > active.end ? 'outside' : ''}`}
                      key={key.id}
                    >
                      <button
                        className="keyframe-seek"
                        onClick={() => seek(key.time)}
                        title="Seek to crop position"
                      >
                        <span className="keyframe-diamond" />{' '}
                        <span>{timecode(key.time, true)}</span>
                        <span>{index + 1}</span>
                      </button>
                      <input
                        type="range"
                        min={active.start}
                        max={active.end}
                        step={1 / project.media.fps}
                        aria-label={`Crop position ${index + 1} time`}
                        value={clamp(key.time, active.start, active.end)}
                        onChange={(event) =>
                          updateClip(active.id, {
                            keyframes: active.keyframes
                              .map((item) =>
                                item.id === key.id
                                  ? { ...item, time: Number(event.target.value) }
                                  : item
                              )
                              .sort((a, b) => a.time - b.time)
                          })
                        }
                      />
                      <button
                        className="icon-button"
                        title="Delete crop position"
                        onClick={() =>
                          updateClip(active.id, {
                            keyframes: active.keyframes.filter((item) => item.id !== key.id)
                          })
                        }
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="keyframe-note">
                  Drag the source frame to add a position.
                  <br />
                  The crop pans between your positions.
                </p>
                <div className="shot-actions">
                  <button
                    className="secondary-button"
                    onClick={() => {
                      seek(active.start)
                      void video.current?.play().catch(report)
                      const element = video.current
                      if (!element) return
                      const stop = () => {
                        if (element.currentTime >= active.end || element.paused) {
                          if (element.currentTime >= active.end) element.pause()
                          element.removeEventListener('timeupdate', stop)
                        }
                      }
                      element.addEventListener('timeupdate', stop)
                    }}
                  >
                    <Play size={12} /> Play shot
                  </button>
                  <button
                    className="icon-button danger-button"
                    title="Delete shot"
                    onClick={() => {
                      setProject({
                        ...project,
                        clips: project.clips.filter((clip) => clip.id !== active.id)
                      })
                      setChecked((previous) => {
                        const next = new Set(previous)
                        next.delete(active.id)
                        return next
                      })
                      setActiveId(undefined)
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-inspector">
                <Frame size={30} />
                <strong>A little room to reframe</strong>
                <p>
                  Select a shot to fine-tune its timing,
                  <br />
                  audio, and moving crop.
                </p>
                <span className="inspector-preview">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </section>

          <section className="export-panel">
            <div className="panel-heading">
              <div>
                <Download size={15} />
                <h3>Export queue</h3>
                <span className="queue-count">{queue.jobs.length}</span>
              </div>
              <span className={`queue-indicator ${running ? 'active' : ''}`}>
                {running ? 'WORKING' : 'READY'}
              </span>
            </div>
            <div className="export-preset">
              <div className="preset-icon">
                <Frame size={18} />
              </div>
              <div>
                <strong>Vertical reel</strong>
                <span>
                  1080 × 1920 <span>·</span> MP4 / H.264
                </span>
              </div>
              <span className="preset-badge">HD</span>
            </div>
            <button
              className="export-folder"
              onClick={() => void chooseOutput()}
              disabled={!project}
              title={project?.outputDirectory || 'Choose where your reels will be saved'}
            >
              <FolderOpen size={14} />
              <span>
                {project?.outputDirectory
                  ? project.outputDirectory.split(/[\\/]/).filter(Boolean).pop()
                  : 'Choose export folder'}
              </span>
              <ChevronRight size={13} />
            </button>
            <div className="queue-list">
              {queue.jobs.length ? (
                queue.jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onAction={(action, id) => void queueAction(action, id)}
                    onReveal={(id) => void api.revealOutput(id).catch(report)}
                  />
                ))
              ) : (
                <div className="empty-queue">
                  <div className="queue-stack">
                    <i />
                    <i />
                    <Film size={22} />
                  </div>
                  <strong>Your next reel is waiting</strong>
                  <p>
                    Add shots to the queue.
                    <br />
                    We’ll take it from here.
                  </p>
                </div>
              )}
            </div>
            <div className="queue-footer">
              <div className="queue-summary">
                <span>
                  {pending} waiting <span>·</span> {completed} completed
                </span>
                {queue.jobs.some((job) => !['pending', 'running'].includes(job.status)) && (
                  <button className="text-button" onClick={() => void queueAction('clear')}>
                    Clear finished
                  </button>
                )}
              </div>
              <button
                className={`primary-button full-width ${queue.running ? 'pause-queue' : ''}`}
                disabled={!queue.running && !pending}
                onClick={() => void queueAction(queue.running ? 'pause' : 'start')}
              >
                {queue.running ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
                {queue.running ? 'Pause after current reel' : 'Start queue'}
                {!queue.running && <ArrowRight size={14} />}
              </button>
              <span className="queue-footnote">
                {running && !queue.running
                  ? 'Pausing after the current export finishes'
                  : 'Exports run locally. Keep the app open.'}
              </span>
            </div>
          </section>
        </aside>
      </div>
      <footer className="status-bar">
        <span>
          <span className="green-dot" /> All local. All yours.
        </span>
        <span>
          {project
            ? `${project.media.name} · ${(project.media.size / 1024 ** 3).toFixed(2)} GB`
            : 'Your footage stays on your computer.'}
        </span>
        <button onClick={() => setHelp(true)}>
          <Keyboard size={12} /> Keyboard shortcuts
        </button>
      </footer>
      {message && (
        <div
          className={`toast ${message.error ? 'error' : ''}`}
          role={message.error ? 'alert' : 'status'}
        >
          {message.error ? <CircleHelp size={17} /> : <CheckCircle2 size={17} />}
          <span>{message.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setMessage(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {draggingFile && (
        <div className="drop-overlay">
          <Upload size={50} />
          <h2>Drop your match video</h2>
          <span>MP4, MOV, or MKV</span>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <div
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <Keyboard size={18} />
                <h2>Keep your hands on the action</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close shortcuts"
                onClick={() => setHelp(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p>A few shortcuts for a faster edit.</p>
            {[
              ['Space', 'Play / pause'],
              ['I', 'Mark selection in'],
              ['O', 'Mark selection out'],
              ['Enter', 'Add shot'],
              ['← / →', 'Step one frame'],
              ['Shift + ← / →', 'Seek five seconds']
            ].map(([key, description]) => (
              <div className="shortcut-row" key={key}>
                <span>{description}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
            <p className="help-note">
              To follow the action, select a shot and drag its crop frame at different points in
              time.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
