import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Film, LoaderCircle, Play, Plus, ScanSearch, X } from 'lucide-react'
import type { HighlightScan, HighlightSuggestion, ScanOptions } from '../../shared/highlights'
import highlightProfiles from '../../shared/highlight-profiles.json'
import { timecode } from '../../shared/crop'

interface Props {
  scan: HighlightScan | null
  onStart: (options: ScanOptions) => Promise<void>
  onCancel: () => Promise<void>
  onPreview: (suggestion: HighlightSuggestion) => void
  onAccept: (suggestion: HighlightSuggestion) => Promise<void>
  onDismiss: (id: string) => Promise<void>
  onBack: () => void
}
export function HighlightPanel({
  scan,
  onStart,
  onCancel,
  onPreview,
  onAccept,
  onDismiss,
  onBack
}: Props) {
  const [options, setOptions] = useState<ScanOptions>(
    scan?.options || { profile: 'general', sensitivity: 'balanced', maxSuggestions: 20 }
  )
  const [starting, setStarting] = useState(false),
    [accepting, setAccepting] = useState<string>()
  useEffect(() => {
    if (scan) setOptions(scan.options)
  }, [scan?.startedAt])
  const [showDismissed, setShowDismissed] = useState(false)
  const running = starting || scan?.status === 'running'
  const visible = (scan?.suggestions || []).filter(
    (item) => showDismissed || item.status !== 'dismissed'
  )
  const phase = {
    preparing: 'Loading local vision model',
    audio: 'Measuring audio activity',
    visual: 'Scanning visual moments',
    ranking: 'Ranking suggested clips',
    done: 'Scan complete'
  }
  return (
    <section className="highlights-panel" data-highlight-panel>
      <div className="highlights-heading">
        <div>
          <ScanSearch size={16} />
          <h2>Find highlights</h2>
        </div>
        <button
          className="icon-button"
          title="Back to your shots"
          aria-label="Back to shots"
          onClick={onBack}
        >
          <ArrowLeft size={15} />
        </button>
      </div>
      <p className="highlights-intro">
        Find moments worth a closer look.
        <br />
        Review first. Make them yours.
      </p>
      <div className="scan-settings">
        <label>
          CONTENT PROFILE
          <select
            aria-label="Highlight content profile"
            value={options.profile}
            disabled={running}
            onChange={(event) =>
              setOptions({ ...options, profile: event.target.value as ScanOptions['profile'] })
            }
          >
            {Object.entries(highlightProfiles).map(([id, profile]) => (
              <option key={id} value={id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <div className="scan-setting-row">
          <label>
            SENSITIVITY
            <select
              aria-label="Highlight sensitivity"
              value={options.sensitivity}
              disabled={running}
              onChange={(event) =>
                setOptions({
                  ...options,
                  sensitivity: event.target.value as ScanOptions['sensitivity']
                })
              }
            >
              <option value="balanced">Balanced</option>
              <option value="more">More moments</option>
              <option value="fewer">Fewer moments</option>
            </select>
          </label>
          <label>
            LIMIT
            <select
              aria-label="Maximum highlight suggestions"
              value={options.maxSuggestions}
              disabled={running}
              onChange={(event) =>
                setOptions({ ...options, maxSuggestions: Number(event.target.value) })
              }
            >
              {[10, 20, 40].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="primary-button full-width"
          disabled={starting}
          onClick={() => {
            if (running) {
              void onCancel()
              return
            }
            setStarting(true)
            void onStart(options).finally(() => setStarting(false))
          }}
        >
          {running ? (
            <>
              <X size={13} /> Cancel scan
            </>
          ) : (
            <>
              <ScanSearch size={14} />
              {scan ? 'Scan again' : 'Scan this video'}
            </>
          )}
        </button>
      </div>
      {running && (
        <div className="scan-progress" role="status">
          <div>
            <LoaderCircle size={12} className="spin" />
            <span>{phase[scan?.phase || 'preparing']}</span>
          </div>
          <div className="progress-track">
            <i style={{ width: `${(scan?.progress || 0) * 100}%` }} />
          </div>
          <span>{Math.round((scan?.progress || 0) * 100)}% · Editing stays available</span>
        </div>
      )}
      {scan?.error && (
        <p className="scan-error" role="alert">
          {scan.error}
        </p>
      )}
      {scan?.status === 'cancelled' && (
        <p className="scan-note">Scan cancelled. Your saved shots are unchanged.</p>
      )}
      {scan?.status === 'interrupted' && (
        <p className="scan-note">The previous scan was interrupted. Start a new scan when ready.</p>
      )}
      <div className="suggestion-heading">
        <span>SUGGESTED MOMENTS</span>
        <b>{scan?.suggestions.length || 0}</b>
      </div>
      <div className="suggestion-list">
        {visible.map((item) => (
          <article
            className={`suggestion-card ${item.status}`}
            key={item.id}
            data-testid="highlight-suggestion"
          >
            <div className="suggestion-title">
              <Film size={13} />
              <strong>{item.label}</strong>
            </div>
            <div className="suggestion-time">
              {timecode(item.start)} <span>→</span> {timecode(item.end)}
            </div>
            <span
              className="interest-score"
              title="A relative ranking signal, not the probability of a goal or event."
            >
              Interest {item.score}/100
            </span>
            <ul>
              {item.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <div className="suggestion-actions">
              <button
                className="secondary-button"
                aria-label={`Preview suggestion at ${timecode(item.start)}`}
                onClick={() => onPreview(item)}
              >
                <Play size={10} /> Preview
              </button>
              {item.status === 'accepted' ? (
                <span className="suggestion-added">
                  <Check size={11} /> Added
                </span>
              ) : item.status === 'dismissed' ? (
                <span className="scan-note">Dismissed</span>
              ) : (
                <>
                  <button
                    className="suggestion-add"
                    aria-label={`Add suggestion at ${timecode(item.start)} to shots`}
                    disabled={!!accepting}
                    onClick={() => {
                      setAccepting(item.id)
                      void onAccept(item).finally(() => setAccepting(undefined))
                    }}
                  >
                    {accepting === item.id ? (
                      <LoaderCircle size={11} className="spin" />
                    ) : (
                      <Plus size={11} />
                    )}{' '}
                    Add shot
                  </button>
                  <button
                    className="icon-button"
                    title="Dismiss suggestion"
                    onClick={() => void onDismiss(item.id)}
                  >
                    <X size={11} />
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
        {!visible.length && !running && (
          <div className="suggestions-empty">
            <ScanSearch size={26} />
            <strong>
              {scan?.status === 'completed'
                ? 'No strong candidates found'
                : 'Your next moment is out there'}
            </strong>
            <p>
              {scan?.status === 'completed'
                ? 'Try More moments, choose another profile, or mark a shot manually.'
                : 'Scan the full video, then preview and add the moments you like.'}
            </p>
          </div>
        )}
      </div>
      <div className="highlight-footer">
        <p>
          Visual analysis runs on this computer. Sound is optional; commentary language is not used.
        </p>
        <p>
          Suggestions can miss events or include false matches. They do not confirm goals or saves.
        </p>
        {!!scan?.suggestions.some((item) => item.status === 'dismissed') && (
          <button className="text-button" onClick={() => setShowDismissed(!showDismissed)}>
            {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
          </button>
        )}
        <button className="secondary-button full-width" onClick={onBack}>
          Back to your shots <ArrowLeft size={12} />
        </button>
      </div>
    </section>
  )
}
