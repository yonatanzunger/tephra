// Where format problems surface (format-spec.md, "Open").
//
// The spec's requirement was precise and short: *"Somewhere non-modal has to
// hold that list, and it should not be a dialog."* Three things follow from
// that, and each of them is a choice that could easily have gone the other way.
//
// **It is not a warning.** Every anomaly here has already been handled safely:
// the tag was bounded to its day, the first anchor won, the unreadable
// frontmatter was left untouched. Nothing is broken and nothing is at risk, so
// the surface uses the vocabulary of a note rather than of an error — no red,
// no triangle, no count badge demanding to be cleared.
//
// **It is quiet until asked.** A line in the titlebar, in the muted tone, which
// is absent entirely when there is nothing to say. A notebook that opens with a
// warning strip every morning teaches its owner to stop reading warnings.
//
// **It never blocks.** Opening it is a click and closing it is a click; there
// is nothing to acknowledge and no state that persists. Anomalies are derived
// from the current text, so repairing a file by hand makes the entry disappear
// on the next read with nothing to invalidate.

import { describeAnomaly, labelAnomaly, type Anomaly } from '@shared/anomalies.ts'

export function AnomalyBadge({
  anomalies,
  open,
  onToggle,
}: {
  anomalies: readonly Anomaly[]
  open: boolean
  onToggle: () => void
}): React.JSX.Element | null {
  // Nothing to say, nothing on screen. The common case is silence.
  if (anomalies.length === 0) return null
  return (
    <button
      type="button"
      className="nav anomaly-badge"
      aria-pressed={open}
      title="Notes about how these files were read"
      onClick={onToggle}
    >
      {anomalies.length} {anomalies.length === 1 ? 'note' : 'notes'}
    </button>
  )
}

export function AnomalyList({
  anomalies,
  onClose,
  onGoTo,
}: {
  anomalies: readonly Anomaly[]
  onClose: () => void
  onGoTo: (date: string) => void
}): React.JSX.Element {
  return (
    <aside className="anomaly-panel" aria-label="Format notes">
      <header>
        <span>How these files were read</span>
        <button type="button" className="link" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <p className="anomaly-preamble">
        Nothing here is broken. Each of these is a decision the format made on
        your behalf, recorded so you can change it if you would rather.
      </p>

      <ul>
        {anomalies.map((anomaly, i) => (
          <li key={`${anomaly.file}:${anomaly.line ?? 0}:${i}`}>
            <div className="anomaly-head">
              <span className="anomaly-kind">{labelAnomaly(anomaly.kind)}</span>
              {anomaly.date !== null && (
                <button type="button" className="link" onClick={() => onGoTo(anomaly.date as string)}>
                  {anomaly.date}
                </button>
              )}
              {anomaly.line !== null && <span className="anomaly-line">line {anomaly.line}</span>}
            </div>
            <p>{describeAnomaly(anomaly)}</p>
            {/* The path, because repairing one of these is something you do in
                another editor, and the whole point of R26 is that you can. */}
            <code>{anomaly.file}</code>
          </li>
        ))}
      </ul>
    </aside>
  )
}
