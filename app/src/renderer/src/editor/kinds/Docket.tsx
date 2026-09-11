// A docket, drawn as a list of matters (MH1, D68, H3).
//
// **The second thing in Tephra shown as something other than running text**, and
// it is a different list from the task list in one way that governs the whole
// design of it: **it is read by two people at one screen, one of whom is not
// driving the keyboard.**
//
// That makes legibility a hard requirement rather than polish (H3, D70). The
// consequences, and none of them are taste:
//
// - **Type at reading size, not at UI size.** A task row is scanned by its
//   owner; a matter is read aloud across a table. The name takes the notebook's
//   reading face at full size.
// - **One row per matter, and the row is wide.** Nothing is truncated that
//   somebody might be about to discuss.
// - **`when` is the loud column**, because the question the conversation is
//   actually about is *when are we doing this*, and for most matters the honest
//   answer is *we have not decided* — which has to be visible as a state rather
//   than as a blank.
// - **No hover-only controls.** Two people cannot both point at the same row,
//   and a control that appears under one person's cursor does not exist for the
//   other.
//
// **Creation order, and it never re-sorts** — the task list's rule, and here it
// matters more: a docket is reasoned about as a whole, so the order things were
// put in is the order both people know their way around.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SurfaceProps } from '../surface.ts'
import { NO_DATE, spellWhen, type Matter } from '../../../../shared/kinds/docket.ts'
import type { DocumentId } from '../../../../shared/document-api.ts'

export function DocketSurface({
  window: docWindow,
  settings,
  onError,
  onHandle,
}: SurfaceProps): React.JSX.Element {
  const id = docWindow.document.id as DocumentId
  const [matters, setMatters] = useState<readonly Matter[]>([])
  const [adding, setAdding] = useState(false)
  /** Which field is open for editing: one at a time, so the row stays legible. */
  const [editing, setEditing] = useState<{ matter: string; field: Field } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setMatters(await window.tephra.docket.matters(id))
  }, [id])

  useEffect(() => {
    void refresh().catch((err: Error) => onError?.(err))
  }, [refresh, onError])

  // **A docket has no editor handle**, the way the task list has none: there is
  // no caret in it and no selection, so a range command has nothing to act on.
  useEffect(() => {
    onHandle?.(null)
    return () => onHandle?.(null)
  }, [onHandle])

  const act = useCallback(
    async (work: Promise<unknown>): Promise<void> => {
      try {
        await work
        setProblem(null)
        await refresh()
      } catch (err) {
        // **Said in the view, not thrown at the app.** A bad date typed during a
        // conversation is an ordinary event and must not put a dialog between
        // two people and the thing they are discussing.
        setProblem((err as Error).message)
      }
    },
    [refresh],
  )

  const type = {
    '--reading-face': settings.typography.font,
    '--reading-size': `${settings.typography.size}px`,
  } as React.CSSProperties

  return (
    <main className="docket" aria-label="Docket" style={type}>
      {problem !== null && <p className="docket-problem">{problem}</p>}

      <ol className="docket-list">
        {matters.map(matter => (
          <Row
            key={matter.id ?? matter.name}
            matter={matter}
            editing={editing?.matter === matter.id ? editing.field : null}
            onEdit={field => setEditing(field === null || matter.id === null ? null : { matter: matter.id, field })}
            onCommit={(field, value) => {
              setEditing(null)
              if (matter.id === null) return
              void act(commit(id, matter.id, field, value))
            }}
            onRemove={() => {
              if (matter.id !== null) void act(window.tephra.docket.remove(id, matter.id))
            }}
          />
        ))}
      </ol>

      {adding ? (
        <NewMatter
          onCancel={() => setAdding(false)}
          onCommit={(name, when) => {
            setAdding(false)
            if (name.trim() !== '') void act(window.tephra.docket.add(id, name, when))
          }}
        />
      ) : (
        <button className="docket-add" onClick={() => setAdding(true)}>
          Add a matter
        </button>
      )}

      {matters.length === 0 && !adding && (
        // Absence that explains itself, as every empty state in this app does —
        // and this one says what the thing is FOR, because a docket's whole
        // claim is completeness and an empty one has not made it yet.
        <p className="docket-empty">
          Everything true about this area of life — including the things with no
          date yet, which is most of them.
        </p>
      )}
    </main>
  )
}

type Field = 'name' | 'when' | 'owner' | 'tags'

function commit(docket: DocumentId, matter: string, field: Field, value: string): Promise<unknown> {
  const said = value.trim()
  switch (field) {
    case 'name':
      return window.tephra.docket.rename(docket, matter, said)
    case 'when':
      return window.tephra.docket.setWhen(docket, matter, said)
    case 'owner':
      return window.tephra.docket.setOwner(docket, matter, said === '' ? null : said)
    case 'tags':
      // One tag at a time is the gesture; the field takes what is typed and the
      // hash is optional, because nobody types punctuation in a conversation.
      return window.tephra.docket.tag(docket, matter, said.replace(/^#/, ''))
  }
}

function Row({
  matter,
  editing,
  onEdit,
  onCommit,
  onRemove,
}: {
  matter: Matter
  editing: Field | null
  onEdit: (field: Field | null) => void
  onCommit: (field: Field, value: string) => void
  onRemove: () => void
}): React.JSX.Element {
  const said = spellWhen(matter.when)
  const undated = matter.when.kind === 'standing'
  return (
    <li className="docket-row">
      <div className="docket-line">
        {editing === 'name' ? (
          <Field1 initial={matter.name} onCommit={v => onCommit('name', v)} onCancel={() => onEdit(null)} />
        ) : (
          <button className="docket-name" onClick={() => onEdit('name')} title="Rename">
            {matter.name}
          </button>
        )}

        {editing === 'when' ? (
          <Field1
            initial={undated ? '' : said}
            placeholder="2026-11-12 · 2026-03..2026-05 · every 90d"
            onCommit={v => onCommit('when', v === '' ? NO_DATE : v)}
            onCancel={() => onEdit(null)}
          />
        ) : (
          <button
            className={`docket-when${undated ? ' undecided' : ''}`}
            onClick={() => onEdit('when')}
            title="When"
          >
            {/* **Not decided yet is a STATE, and says so in words.** A blank
                here would read as missing data; *no date yet* is the honest
                thing, and giving one a date is the point of the review. */}
            {undated ? 'no date yet' : said}
          </button>
        )}
      </div>

      <div className="docket-under">
        {matter.tags.map(tag => (
          <span key={tag} className="pill label">{tag}</span>
        ))}
        {editing === 'tags' ? (
          <Field1 initial="" placeholder="tag" onCommit={v => onCommit('tags', v)} onCancel={() => onEdit(null)} />
        ) : (
          <button className="docket-quiet" onClick={() => onEdit('tags')}>tag</button>
        )}
        {editing === 'owner' ? (
          <Field1
            initial={matter.owner ?? ''}
            placeholder="who"
            onCommit={v => onCommit('owner', v)}
            onCancel={() => onEdit(null)}
          />
        ) : (
          <button className="docket-quiet" onClick={() => onEdit('owner')}>
            {matter.owner ?? 'who'}
          </button>
        )}
        {matter.triggers.length > 0 && (
          // Representation ships in MH1 and editing in MH3, so this says they
          // are there rather than pretending they are not.
          <span className="docket-quiet">{matter.triggers.length} run-up</span>
        )}
        <button className="docket-quiet danger" onClick={onRemove}>remove</button>
      </div>
    </li>
  )
}

/** One short field, committed on Enter and abandoned on Escape. */
function Field1({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string
  placeholder?: string
  onCommit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <input
      ref={input}
      className="docket-field"
      value={value}
      placeholder={placeholder ?? ''}
      spellCheck={false}
      onChange={e => setValue(e.currentTarget.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    />
  )
}

/** Name and `when` together, because that is how a matter is said out loud. */
function NewMatter({
  onCommit,
  onCancel,
}: {
  onCommit: (name: string, when?: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [when, setWhen] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const done = (): void => onCommit(name, when.trim() === '' ? undefined : when)
  return (
    <div className="docket-new">
      <input
        ref={input}
        className="docket-field wide"
        value={name}
        placeholder="what it is"
        spellCheck={false}
        onChange={e => setName(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            done()
          } else if (e.key === 'Escape') onCancel()
        }}
      />
      <input
        className="docket-field"
        value={when}
        placeholder="when, or leave it"
        spellCheck={false}
        onChange={e => setWhen(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            done()
          } else if (e.key === 'Escape') onCancel()
        }}
      />
      <button className="docket-quiet" onClick={done}>add</button>
    </div>
  )
}
