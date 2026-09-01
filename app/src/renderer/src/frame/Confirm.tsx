// Asking before something irreversible.
//
// **Not `window.confirm`**, for the reason `Prompt` is not `window.prompt`: it
// blocks the renderer's entire event loop, including the editor's own painting,
// which is exactly what R1.1 forbids on the writing path. It also cannot be
// styled, so it arrives looking like a browser from 2003 in the middle of a
// page that has had a great deal of attention paid to how it looks.
//
// The verb is on the button, not "OK". A dialog whose buttons are OK and Cancel
// makes you re-read the question to find out what OK does; one whose button
// says `Delete` can be answered without reading it twice.

import { useEffect, useRef } from 'react'

export interface ConfirmRequest {
  readonly title: string
  /** What will happen, in a sentence. Absent when the title says it all. */
  readonly detail?: string
  readonly confirmLabel: string
  /** Destructive answers are coloured as such, and are never the default. */
  readonly destructive?: boolean
  readonly onConfirm: () => void
}

export function Confirm({
  request,
  onClose,
}: {
  request: ConfirmRequest
  onClose: () => void
}): React.JSX.Element {
  const cancel = useRef<HTMLButtonElement>(null)

  // **Focus lands on Cancel.** The keyboard's default answer to a question you
  // did not mean to ask should be the one that changes nothing.
  useEffect(() => {
    cancel.current?.focus()
  }, [])

  return (
    <div className="prompt-scrim" onMouseDown={onClose}>
      <div className="prompt" role="dialog" aria-label={request.title} onMouseDown={e => e.stopPropagation()}>
        <label>{request.title}</label>
        {request.detail !== undefined && <p className="theme-note">{request.detail}</p>}
        <div
          className="prompt-actions"
          onKeyDown={e => {
            // Escape backs out from anywhere in the dialog, and stops here
            // rather than reaching the editor underneath.
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }}
        >
          <button
            type="button"
            className={request.destructive === true ? 'destructive' : ''}
            onClick={() => {
              request.onConfirm()
              onClose()
            }}
          >
            {request.confirmLabel}
          </button>
          <button type="button" className="link" ref={cancel} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
