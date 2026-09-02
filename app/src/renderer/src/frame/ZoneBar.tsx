// The notebook is filing days somewhere you are not (D63).
//
// **A row across the page, because the offer is worth reading.** This began as
// a pill in the titlebar, and every part of that was wrong: it was small enough
// to miss, it was inside the drag region, and — worst — each window resolved
// the machine's zone in its own process and got its own answer, so two windows
// sat side by side proposing opposite moves. Main answers now, and this only
// renders what it is told.
//
// **It says both zones**, because the decision is a comparison: where the
// notebook has been filing, where the machine says you are, and one control
// that moves the first to the second. Nothing is wrong, so it reads as a
// question rather than an alarm — and it takes no for an answer.

import type { ZoneNotice } from '../../../shared/ipc.ts'

/** A zone as somebody would say it: the city, not the path it is filed under. */
export const place = (zone: string): string => (zone.split('/').pop() ?? zone).replace(/_/g, ' ')

export function ZoneBar({
  notice,
  onAdopt,
  onDismiss,
}: {
  notice: ZoneNotice
  onAdopt: () => void
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div className="zonebar" role="status">
      <span className="zonebar-text">
        Tephra is currently set to the <b>{place(notice.notebook)}</b> time zone. Switch to <b>{place(notice.system)}</b>?
      </span>
      <button type="button" className="zonebar-act" onClick={onAdopt}>
        Switch
      </button>
      {/* Days already written keep the dates they were written under, so there
          is nothing here to confirm — the change is forward-only and the day
          never runs backwards (D9, D63). A dialog would be ceremony. */}
      <button
        type="button"
        className="zonebar-close"
        title="Keep filing days where they are"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  )
}
