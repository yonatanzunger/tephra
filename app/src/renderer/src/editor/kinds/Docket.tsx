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
// **Creation order by default, and it never re-sorts on its own** — the task
// list's rule. What a person may do is arrange it: **sections** divide a docket
// for reading (*periodic maintenance*, *need to do*, *major projects*) and a
// matter can be moved between them or nudged up and down inside one. Nothing
// sorts itself; the order is whatever was put there, which is what makes it
// familiar to both readers.
//
// **A docket with no sections looks exactly as it did before they existed.** The
// undivided run is not a section and gets no heading, and the *move* control
// appears only once there is somewhere to move to — sections are optional, and
// an optional feature that clutters the surface of everyone not using it has
// been paid for by the wrong people.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SurfaceProps } from '../surface.ts'
import {
  NO_DATE, readWhen, spellOffset, spellWhen, type Matter, type Section,
} from '../../../../shared/kinds/docket.ts'
import type { DocumentId } from '../../../../shared/document-api.ts'

export function DocketSurface({
  window: docWindow,
  settings,
  onError,
  onHandle,
}: SurfaceProps): React.JSX.Element {
  const id = docWindow.document.id as DocumentId
  const [sections, setSections] = useState<readonly Section[]>([])
  const [adding, setAdding] = useState(false)
  /** Which section header is being renamed, and whether a new one is being typed. */
  const [naming, setNaming] = useState<string | null>(null)
  const [newSection, setNewSection] = useState(false)
  /** Which field is open for editing: one at a time, so the row stays legible. */
  const [editing, setEditing] = useState<{ matter: string; field: Field } | null>(null)
  /**
   * Which matter's run-ups are open.
   *
   * **A matter that HAS one is always open**, because the run-up is the thing
   * the conversation is about — *how long before this do we need to start* — and
   * hiding it behind a click means it is not on the screen both people are
   * reading (H3).
   */
  const [open, setOpen] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setSections(await window.tephra.docket.sections(id))
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

  const total = sections.reduce((n, s) => n + s.matters.length, 0)

  const type = {
    '--reading-face': settings.typography.font,
    '--reading-size': `${settings.typography.size}px`,
  } as React.CSSProperties

  return (
    <main className="docket" aria-label="Docket" style={type}>
      {problem !== null && <p className="docket-problem">{problem}</p>}

      {sections.map(section => (
        <section className="docket-section" key={section.name === '' ? ':unsectioned' : section.name}>
          {/* The undivided run has no heading, because it is not a section:
              nothing was decided about it, and inventing a name for it would
              put a decision on the screen that nobody made. */}
          {section.name !== '' &&
            (naming === section.name ? (
              <Field1
                initial={section.name}
                className="docket-field section"
                onCommit={value => {
                  setNaming(null)
                  const said = value.trim()
                  if (said !== '' && said !== section.name) {
                    void act(window.tephra.docket.renameSection(id, section.name, said))
                  }
                }}
                onCancel={() => setNaming(null)}
              />
            ) : (
              <div className="docket-section-head">
                <h2 className="docket-section-name">{section.name}</h2>
                <button className="docket-quiet" onClick={() => setNaming(section.name)}>rename</button>
                {/* **Not destructive, and says so.** Removing a heading keeps
                    every matter under it — they join whatever now contains
                    them — so this is not in the `danger` ink that `remove` on a
                    matter earns. */}
                <button
                  className="docket-quiet"
                  onClick={() => void act(window.tephra.docket.removeSection(id, section.name))}
                  title="The matters in it stay; only the heading goes"
                >
                  ungroup
                </button>
              </div>
            ))}

          <ol className="docket-list">
            {section.matters.map((matter, at) => (
              <Row
                key={matter.id ?? matter.name}
                matter={matter}
                section={section.name}
                sections={sections.flatMap(s => (s.name === '' ? [] : [s.name]))}
                first={at === 0}
                last={at === section.matters.length - 1}
                editing={editing?.matter === matter.id ? editing.field : null}
                adding={open === matter.id}
                onAdding={want => setOpen(want && matter.id !== null ? matter.id : null)}
                onAddRunUp={(offset, text) => {
                  if (matter.id !== null) void act(window.tephra.docket.addTrigger(id, matter.id, offset, text))
                }}
                onDropRunUp={at2 => {
                  if (matter.id !== null) void act(window.tephra.docket.removeTrigger(id, matter.id, at2))
                }}
                onEdit={field => setEditing(field === null || matter.id === null ? null : { matter: matter.id, field })}
                onCommit={(field, value) => {
                  setEditing(null)
                  if (matter.id === null) return
                  void act(commit(id, matter.id, field, value))
                }}
                onRemove={() => {
                  if (matter.id !== null) void act(window.tephra.docket.remove(id, matter.id))
                }}
                onNudge={delta => {
                  if (matter.id !== null) void act(window.tephra.docket.nudge(id, matter.id, delta))
                }}
                onPlace={into => {
                  if (matter.id === null) return
                  // The menu's own empty value is its prompt, so *out of every
                  // section* travels as a sentinel and is turned back here.
                  void act(window.tephra.docket.place(id, matter.id, into === UNSECTIONED ? '' : into))
                }}
              />
            ))}
          </ol>

          {section.name !== '' && section.matters.length === 0 && (
            // An empty section is a real state — it gets said before it gets
            // filled — so it says what it is rather than looking broken.
            <p className="docket-section-empty">nothing in this one yet</p>
          )}
        </section>
      ))}

      {adding ? (
        <NewMatter
          sections={sections.flatMap(one => (one.name === '' ? [] : [one.name]))}
          onCancel={() => setAdding(false)}
          onCommit={(name, when, into) => {
            setAdding(false)
            if (name.trim() !== '') void act(window.tephra.docket.add(id, name, when, into))
          }}
        />
      ) : newSection ? (
        <Field1
          initial=""
          className="docket-field section"
          placeholder="periodic maintenance · need to do · major projects"
          onCommit={value => {
            setNewSection(false)
            if (value.trim() !== '') void act(window.tephra.docket.addSection(id, value))
          }}
          onCancel={() => setNewSection(false)}
        />
      ) : (
        <div className="docket-adders">
          <button className="docket-add" onClick={() => setAdding(true)}>
            Add a matter
          </button>
          <button className="docket-add quiet" onClick={() => setNewSection(true)}>
            Add a section
          </button>
        </div>
      )}

      {total === 0 && !adding && (
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

type Field = 'name' | 'when' | 'owner' | 'tags' | 'note'

/** *Out of every section*, as a menu value — `''` is the menu's own prompt. */
const UNSECTIONED = ':none'

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
    case 'note':
      // **Lines, because a note is prose and prose has paragraphs.** Split here
      // rather than in main so the field can be an ordinary textarea.
      return window.tephra.docket.setNotes(docket, matter, value.split('\n'))
  }
}

function Row({
  matter,
  section,
  sections,
  first,
  last,
  editing,
  adding,
  onAdding,
  onEdit,
  onCommit,
  onRemove,
  onAddRunUp,
  onDropRunUp,
  onNudge,
  onPlace,
}: {
  matter: Matter
  /** Which section it is in — `''` for the undivided run. */
  section: string
  /** Every named section, so *move to* can offer them. */
  sections: readonly string[]
  /** Whether it is at an end of its section, so a dead gesture is not offered. */
  first: boolean
  last: boolean
  editing: Field | null
  /** Whether the *add a run-up* fields are showing. The list shows regardless. */
  adding: boolean
  onAdding: (open: boolean) => void
  onEdit: (field: Field | null) => void
  onCommit: (field: Field, value: string) => void
  onRemove: () => void
  onAddRunUp: (offset: string, text: string) => void
  onDropRunUp: (at: number) => void
  onNudge: (delta: number) => void
  onPlace: (into: string) => void
}): React.JSX.Element {
  // The round-trip form is what an edit starts from; the reading form is what
  // the row shows. See `readWhen`.
  const said = spellWhen(matter.when)
  const read = readWhen(matter.when)
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
            placeholder="2026-11-12 · 2026-03..2026-05 · every 90 days from 2026-10-01"
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
            {undated ? 'no date yet' : read}
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
        <button className="docket-quiet" onClick={() => onEdit('note')}>
          {matter.notes.length === 0 ? 'note' : 'note…'}
        </button>
        <button className="docket-quiet" onClick={() => onAdding(!adding)}>
          {/* **Named for what it IS, not for the mechanism.** *Run-up* is the
              word the requirements use and the thing being discussed: how long
              before this do we need to start. "Trigger" is the implementation. */}
          {matter.triggers.length === 0
            ? 'run-up'
            : `${matter.triggers.length} run-up${matter.triggers.length === 1 ? '' : 's'}`}
        </button>
        {/* **Arranging is separated from editing by a divider**, because they
            are different kinds of act: everything to the left changes what this
            matter IS, and everything to the right changes where it sits. */}
        <span className="docket-sep" aria-hidden="true" />
        {/* Disabled at the ends rather than hidden: a control that vanishes
            makes the row twitch as things move, and a row that changes shape
            while two people are reading it is worse than a dead button. */}
        <button
          className="docket-quiet"
          disabled={first}
          onClick={() => onNudge(-1)}
          title="Move up"
        >
          ↑
        </button>
        <button
          className="docket-quiet"
          disabled={last}
          onClick={() => onNudge(1)}
          title="Move down"
        >
          ↓
        </button>
        {/* **A menu that says what it DOES, not where this already is.** The
            first cut showed the current section, so every row inside *periodic
            maintenance* read "periodic maintenance" — information the heading
            two inches above it already gives, repeated once per row on a surface
            whose whole requirement is legibility. The heading is the state; this
            is the action, and the section it is already in is not among its
            options because moving there is nothing.

            Offered only when there is somewhere to go, so a docket nobody has
            divided carries nothing extra. A `select` because it is the menu
            everybody already knows, and it works from the keyboard without one
            being invented. */}
        {sections.some(name => name !== section) && (
          <select
            className="docket-where"
            value=""
            onChange={event => {
              if (event.target.value !== '') onPlace(event.target.value)
            }}
            title="Move to another section"
          >
            <option value="">move to…</option>
            {section !== '' && <option value={UNSECTIONED}>no section</option>}
            {sections
              .filter(name => name !== section)
              .map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
          </select>
        )}
        <button className="docket-quiet danger" onClick={onRemove}>remove</button>
      </div>

      {editing === 'note' ? (
        <NoteField
          initial={matter.notes.join('\n')}
          onCommit={value => onCommit('note', value)}
          onCancel={() => onEdit(null)}
        />
      ) : (
        matter.notes.length > 0 && (
          // **Shown whenever there is one, never behind a click.** The quote
          // from the plumber is the thing the conversation needs in front of
          // both people (H3); a note you have to go and find is a note that
          // does not get read.
          <div className="docket-note">
            {matter.notes.map((line, at) => (
              <p key={`${at}-${line.slice(0, 12)}`}>{line}</p>
            ))}
          </div>
        )
      )}

      {/* **Two independent states, and conflating them broke both.** A matter's
          existing run-ups always show, because they are what the conversation is
          about; the *add* fields show only when asked. One flag for both meant
          an empty field sitting under every matter that had any — clutter in a
          list being scanned — and a toggle that could never close, because the
          triggers kept it open. It looked dead. */}
      {(matter.triggers.length > 0 || adding) && (
        <div className="docket-runups">
          {matter.triggers.map((trigger, at) => (
            <div key={`${trigger.offset}-${at}`} className="docket-runup">
              {/* Read back in words, because this is the line somebody says out
                  loud: *two weeks before — book the boiler service.* */}
              <span className="docket-runup-when">{spellOffset(trigger.offset)}</span>
              <span className="docket-runup-what">{trigger.text}</span>
              {trigger.effect !== 'task' && <span className="pill label">{trigger.effect}</span>}
              <button className="docket-quiet danger" onClick={() => onDropRunUp(at)}>drop</button>
            </div>
          ))}
          {adding && (
            <NewRunUp
              onCommit={(offset, text) => onAddRunUp(offset, text)}
              onDone={() => onAdding(false)}
            />
          )}
        </div>
      )}
    </li>
  )
}

/**
 * *This long before — do this.*
 *
 * **Two fields, not three.** A trigger carries an offset, an effect and a text,
 * and asking for three in the middle of a conversation is a form. The effect is
 * `task` unless somebody says otherwise, because every example in the
 * requirements is a task; `note` and `doc` are authored in the file today and
 * get their control when MH3 gives them something to do.
 */
function NewRunUp({
  onCommit,
  onDone,
}: {
  onCommit: (offset: string, text: string) => void
  onDone: () => void
}): React.JSX.Element {
  const [offset, setOffset] = useState('')
  const [text, setText] = useState('')
  const when = useRef<HTMLInputElement>(null)
  // Asked for, so the caret is already in it: the gesture is *add a run-up*,
  // and making somebody click twice for one act is a click too many.
  useEffect(() => when.current?.focus(), [])
  const done = (): void => {
    if (offset.trim() === '' || text.trim() === '') return
    onCommit(offset, text)
    setOffset('')
    setText('')
    // **Stays open, focus back at the start.** A matter with one run-up usually
    // wants two — get quotes, then book it — so the second costs no gesture.
    when.current?.focus()
  }
  return (
    <div className="docket-runup new">
      <input
        ref={when}
        className="docket-field narrow"
        value={offset}
        placeholder="2 weeks"
        aria-label="How long before"
        spellCheck={false}
        onChange={e => setOffset(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            done()
          } else if (e.key === 'Escape') onDone()
        }}
      />
      <span className="docket-runup-when quiet">before</span>
      <input
        className="docket-field wide"
        value={text}
        placeholder="what needs doing then"
        aria-label="What happens"
        spellCheck={false}
        onChange={e => setText(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            done()
          } else if (e.key === 'Escape') onDone()
        }}
      />
      <button className="docket-quiet" onClick={done}>add</button>
      <button className="docket-quiet" onClick={onDone}>done</button>
    </div>
  )
}

/**
 * The prose under a matter, edited as a block.
 *
 * **A textarea, not a line**, because a note is a paragraph or three — what the
 * plumber said, the quote, why this is waiting on something else. Committed on
 * blur or ⌘-Enter rather than on Enter, since Enter is how you write the second
 * sentence.
 */
function NoteField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    field.current?.focus()
    // At the end, not selected: the common case is adding to a note rather than
    // replacing one, which is the opposite of the name fields above.
    const at = field.current?.value.length ?? 0
    field.current?.setSelectionRange(at, at)
  }, [])
  return (
    <textarea
      ref={field}
      className="docket-note-field"
      value={value}
      rows={Math.min(8, Math.max(2, value.split('\n').length + 1))}
      placeholder="what the plumber said, the quote, why it is waiting"
      spellCheck
      onChange={e => setValue(e.currentTarget.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
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

/** One short field, committed on Enter and abandoned on Escape. */
function Field1({
  initial,
  placeholder,
  className,
  onCommit,
  onCancel,
}: {
  initial: string
  placeholder?: string
  /** So the several things this is used for are distinguishable (see below). */
  className?: string
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
      className={className ?? 'docket-field'}
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
  sections,
  onCommit,
  onCancel,
}: {
  /** Every named section, so a new matter can be filed as it is written. */
  sections: readonly string[]
  onCommit: (name: string, when?: string, section?: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [when, setWhen] = useState('')
  /** **Defaults to nowhere**, because adding a matter is not a claim about it. */
  const [section, setSection] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const done = (): void =>
    onCommit(name, when.trim() === '' ? undefined : when, section === '' ? undefined : section)
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
        placeholder="a date, every 90 days from …, or leave it"
        spellCheck={false}
        onChange={e => setWhen(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            done()
          } else if (e.key === 'Escape') onCancel()
        }}
      />
      {/* **Asked at the moment of adding, when the answer is in the air.** The
          alternative was to guess, and the only available guess — the end of
          the file — is inside the *last* section, so *fix the fence* would have
          become a major project without anybody saying so. */}
      {sections.length > 0 && (
        <select
          className="docket-where"
          value={section}
          onChange={event => setSection(event.target.value)}
          title="Which section to put it in"
        >
          <option value="">no section</option>
          {sections.map(one => (
            <option key={one} value={one}>{one}</option>
          ))}
        </select>
      )}
      <button className="docket-quiet" onClick={done}>add</button>
    </div>
  )
}
