// The window frame (D42): Reserved, with the capture stream summoned on demand.
//
// The whole point of this component is a guarantee — **the text does not move**.
// Toggling the nav must not shift it, and neither must opening the stream. Two
// rules produce that, and both are easy to lose in a later refactor:
//
//   1. The nav's column is spent whether or not the nav is drawn. Hiding it
//      hides the nav, never its width. That is what distinguishes Reserved from
//      the naive arrangement, which shifts the text by 499px on every toggle.
//   2. The text column is a FIXED track and the slack lives to its right, so the
//      stream can be taken out of the slack rather than out of the measure. The
//      frame studies certified an arrangement as steady while its measure
//      narrowed from 54ch to 36ch, because the left edge never moved — a slow
//      jump is still a jump.
//
// The capture stream is an OVERLAY pinned to the frame's right edge, not a grid
// column, and that single choice removes a mode rather than adding one. On a
// wide screen it lands on the slack that already sits right of the annotation
// gutter and covers nothing; on a laptop it covers the gutter and some text.
// Either way the text does not move, because an overlay cannot reflow what is
// underneath it — and closing it restores the page exactly.
//
// This replaced a rule that refused to open the stream when there was no slack.
// That rule protected the gutter from *reflow* but expressed itself as refusal,
// which meant the surface was unavailable at every width a laptop can produce —
// which is exactly where "type almost blindly while reading" is most wanted.

import { useState } from 'react'
import { NAV_WIDTH, type FrameMetrics } from './useFrame'

export interface FrameProps {
  readonly metrics: FrameMetrics
  readonly navVisible: boolean
  readonly streamOpen: boolean
  readonly nav: React.ReactNode
  readonly stream: React.ReactNode
  readonly children: React.ReactNode
  readonly frameRef: (element: HTMLDivElement | null) => void
  /**
   * Pixels of the reading column something else is standing on (MS4).
   *
   * **The search panel floats, and floating is not free.** Without this the
   * prose ran underneath it, so the passage you had just chosen from the list
   * was the one you could not read the end of. The column narrows instead, and
   * the text reflows — which costs a reflow when the panel opens and is worth
   * it.
   */
  readonly insetRight?: number
}

export function Frame({
  metrics,
  navVisible,
  streamOpen,
  nav,
  stream,
  children,
  frameRef,
  insetRight = 0,
}: FrameProps): React.JSX.Element {
  const showStream = streamOpen

  return (
    <div
      className="frame"
      ref={frameRef}
      data-gutter={metrics.gutterFits ? 'beside' : 'folded'}
      style={
        {
          // One source of truth for every width on screen: all of these come
          // from the same arithmetic that decided whether the stream may open.
          // Two columns always. The stream is not one of them — it floats
          // above, so its arrival changes no track and therefore moves no line.
          gridTemplateColumns: `${NAV_WIDTH}px minmax(0, 1fr)`,
          '--stream-w': `${metrics.streamMax}px`,
          '--measure': `${metrics.measurePx}px`,
          '--gutter': `${metrics.gutterPx}px`,
        } as React.CSSProperties
      }
    >
      <div className="frame-nav-slot" aria-hidden={!navVisible} data-hidden={!navVisible}>
        {nav}
      </div>

      <div className="frame-reading" style={{ paddingRight: `calc(0.3in + ${insetRight}px)` }}>
        {children}
      </div>

      {showStream && (
        <aside className="frame-stream" data-covering={metrics.streamOcclusion > 0}>
          {stream}
        </aside>
      )}
    </div>
  )
}

/**
 * The stream's own toggle state, plus whether it may be shown at all. Kept here
 * rather than in App so the refusal rule and the control that obeys it stay
 * within sight of each other.
 */
export function useStream(_metrics: FrameMetrics): { open: boolean; toggle: () => void } {
  const [open, setOpen] = useState(false)
  return { open, toggle: () => setOpen(previous => !previous) }
}
