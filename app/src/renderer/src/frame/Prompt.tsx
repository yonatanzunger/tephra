// Asking for one short string.
//
// Bookmark needs a name; so will tag, comment and branch. Built once here
// rather than four times badly, and deliberately small: a range operation
// should feel like a keystroke and a word, not like filling in a form.
//
// **Not `window.prompt`.** Electron still has it, and it blocks the renderer's
// entire event loop — including the editor's own painting — which is precisely
// the thing R1.1 forbids on the writing path. It also cannot be styled, so it
// arrives looking like a browser from 2003 in the middle of a page that has had
// a great deal of attention paid to how it looks.

import { useEffect, useRef, useState } from 'react'

export interface PromptRequest {
  readonly title: string
  readonly placeholder?: string
  /** Prefilled, for the cases where there is an obvious answer. */
  readonly initial?: string
  readonly submitLabel: string
  readonly onSubmit: (value: string) => void
}

export function Prompt({
  request,
  onClose,
}: {
  request: PromptRequest
  onClose: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(request.initial ?? '')
  const input = useRef<HTMLInputElement>(null)

  // Focus on arrival, and select what is prefilled: the common case for a
  // prefilled value is replacing it, not appending to it.
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const submit = (): void => {
    const trimmed = value.trim()
    if (trimmed === '') return // nothing to name; Escape is how you back out
    request.onSubmit(trimmed)
    onClose()
  }

  return (
    <div className="prompt-scrim" onMouseDown={onClose}>
      <div
        className="prompt"
        role="dialog"
        aria-label={request.title}
        onMouseDown={e => e.stopPropagation()}
      >
        <label htmlFor="prompt-input">{request.title}</label>
        <input
          id="prompt-input"
          ref={input}
          type="text"
          value={value}
          placeholder={request.placeholder ?? ''}
          spellCheck={false}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            // Enter commits, Escape abandons. Both stop here rather than
            // reaching the editor underneath, which would otherwise receive a
            // newline into the document the operation is about.
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              onClose()
            }
          }}
        />
        <div className="prompt-actions">
          <button type="button" onClick={submit} disabled={value.trim() === ''}>
            {request.submitLabel}
          </button>
          <button type="button" className="link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
