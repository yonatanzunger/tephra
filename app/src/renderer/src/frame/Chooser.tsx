// Picking a document by name.
//
// **Type to narrow, Enter to open** — the same gesture as every editor's file
// switcher, because that is what this is. Not a file dialog: the corpus is a
// list of documents with names, and asking the OS to browse a directory tree
// would show a person their own notebook as `sections/_index.fileset.md` (D54).
//
// Deliberately the same shape as `Prompt`: one field, one keystroke, no form.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentId } from '../../../shared/document-api.ts'

export interface ChooserRequest {
  readonly title: string
  readonly documents: readonly { readonly id: DocumentId; readonly title: string }[]
  readonly onChoose: (id: DocumentId) => void
}

export function Chooser({
  request,
  onClose,
}: {
  request: ChooserRequest
  onClose: () => void
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (needle === '') return request.documents
    // Matched against the NAME and the path both: someone who knows where a
    // note lives should be able to type that, and someone who only remembers
    // what it is called should be able to type that instead.
    return request.documents.filter(
      d => d.title.toLowerCase().includes(needle) || (d.id as string).toLowerCase().includes(needle),
    )
  }, [filter, request.documents])

  const choose = (id: DocumentId | undefined): void => {
    if (id === undefined) return
    request.onChoose(id)
    onClose()
  }

  return (
    <div className="prompt-scrim" onMouseDown={onClose}>
      <div className="prompt chooser" role="dialog" aria-label={request.title} onMouseDown={e => e.stopPropagation()}>
        <label htmlFor="chooser-input">{request.title}</label>
        <input
          id="chooser-input"
          ref={input}
          type="text"
          value={filter}
          placeholder="Type to narrow"
          spellCheck={false}
          onChange={e => {
            setFilter(e.target.value)
            setAt(0)
          }}
          onKeyDown={e => {
            // Arrows move within the list, Enter takes what is highlighted, and
            // both stop here — otherwise they reach the editor underneath and
            // move the caret in the document this dialog is about.
            e.stopPropagation()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setAt(i => Math.min(i + 1, matches.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setAt(i => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(matches[at]?.id)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <ul className="chooser-list">
          {matches.map((d, i) => (
            <li key={d.id as string}>
              <button
                type="button"
                className={`chooser-row${i === at ? ' active' : ''}`}
                onMouseEnter={() => setAt(i)}
                onClick={() => choose(d.id)}
              >
                <span className="chooser-name">{d.title}</span>
                <span className="chooser-where">{d.id as string}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="chooser-empty">Nothing by that name.</li>}
        </ul>
      </div>
    </div>
  )
}
