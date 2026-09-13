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
// - **Controls present enough to be found**, which is a weaker rule than the one
//   this file used to state. It said *no hover-only controls*, reasoning that two
//   people cannot both point at the same row — an inference from H3, not
//   anything the requirements ask for, and corrected from use: sitting next to
//   somebody and working together is not obstructed by a control that appears
//   under the cursor. What the surface does owe is **discoverability**, which is
//   a different thing and the one that actually failed: the move control was the
//   quietest mark in the row and the report back was *I'm not sure how to move
//   things into and out of sections*.
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
import { RowMenu, type RowMenuRequest } from '../../frame/RowMenu'
import {
  addInterval, backInterval, instancesIn, MODES, readInterval, readSchedule, readStepWhen,
  shapeOf, spellInterval,
  spellStepWhen,
  type Interval, type Matter, type Mode, type NewMatter as NewMatterShape, type Section,
  type StepKind,
} from '../../../../shared/kinds/docket.ts'
import type { DateKey, DocumentId } from '../../../../shared/document-api.ts'
import { addDays, dateKeyAt, DEFAULT_ZONE } from '../../../../shared/dates.ts'

export function DocketSurface({
  window: docWindow,
  settings,
  onError,
  onHandle,
}: SurfaceProps): React.JSX.Element {
  const id = docWindow.document.id as DocumentId
  const [sections, setSections] = useState<readonly Section[]>([])
  /**
   * Which section is having a matter added to it — `''` for the undivided run,
   * `null` for nobody.
   *
   * **A place rather than a flag**, which is the task list's shape (`+ Add to
   * house`) and for the same reason: you ask from where you are looking, so the
   * matter lands where you asked and there is no question left over. The flag
   * version put one button at the foot of the page and then had to ask which
   * section in a dropdown — a question whose answer was already in the gesture.
   */
  const [adding, setAdding] = useState<string | null>(null)
  /** Which section header is being renamed, and whether a new one is being typed. */
  const [naming, setNaming] = useState<string | null>(null)
  const [newSection, setNewSection] = useState(false)
  /**
   * Which matters are showing their steps.
   *
   * **Collapsed by default, and the reason is the seeded step.** Every matter is
   * born with one — explicitly, so that nothing downstream has to infer *a
   * matter with no steps, of this mode, behaves as though it had one*, which is
   * a rule nobody could reason about. Shown, that step reads as an echo of the
   * matter's own name; folded away, a one-step matter is one line, which is what
   * it is.
   *
   * **Ephemeral, and never written to the file.** Opening one is a reading act.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  /** The context menu, which is where everything a matter needs rarely lives. */
  const [menu, setMenu] = useState<RowMenuRequest | null>(null)
  const show = useCallback((matter: string, want: boolean): void => {
    // **Folding a matter puts away everything about its steps**, the half-typed
    // new one included. Without this the add row kept them on screen after a
    // fold, since it is rendered with them — so the disclosure looked broken
    // on exactly the matter somebody had just been working on.
    if (!want) setOpen(was => (was === matter ? null : was))
    setExpanded(was => {
      const next = new Set(was)
      if (want) next.add(matter)
      else next.delete(matter)
      return next
    })
  }, [])
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
  /**
   * What day it is, for the schedule panel's preview of the next instances.
   *
   * **Asked of main, which owns the clock** (D62/D63) — a surface that took it
   * from `new Date()` would disagree with the app either side of midnight and in
   * a notebook whose zone is not the machine's, which is the ordinary case here.
   */
  const [today, setToday] = useState<DateKey | null>(null)
  /**
   * The zone both dates are computed in (D63), for turning a completion stamp
   * into the day it fell on.
   *
   * **Asked of main rather than assumed**, which `dueOn` had to learn the hard
   * way: a stamp is an instant, the day it fell on is a question about *where*,
   * and answering it for Greenwich put a task finished at 17:42 on tomorrow.
   */
  const [zone, setZone] = useState<string>(DEFAULT_ZONE)
  useEffect(() => {
    void window.tephra.doc.open().then(info => {
      setToday(info.today as DateKey)
      setZone(info.zone)
    }).catch(() => undefined)
  }, [])
  const [problem, setProblem] = useState<string | null>(null)
  /**
   * What is being dragged, and where it would land.
   *
   * **Held here rather than in the row, and not read out of `dataTransfer`.**
   * The drop has to be resolved against the *sections* — which section the row
   * under the pointer is in, and which matter follows it — and only this
   * component knows that. `dataTransfer` is still filled in, because a drag
   * with no data attached does not start in every browser, but nothing reads it
   * back: the truth is here, where it cannot be mangled in transit.
   */
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<Landing | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setSections(await window.tephra.docket.sections(id))
  }, [id])

  useEffect(() => {
    void refresh().catch((err: Error) => onError?.(err))
  }, [refresh, onError])

  /**
   * And again whenever this document is written to by anybody else.
   *
   * **Without this a docket left open goes quietly stale.** It redraws from
   * what the service tells it and only asked after its own verbs, so another
   * window editing the same file — or, from MH3b, generation running in the
   * background at midnight — would change it underneath and nothing would say
   * so. The surface is a view of a document, so it has to hear when the
   * document moves.
   */
  useEffect(() => {
    return window.tephra.nav.onDocumentsChanged(written => {
      if (!written.includes(id)) return
      void refresh().catch((err: Error) => onError?.(err))
    })
  }, [id, refresh, onError])

  // **A docket has no editor handle**, the way the task list has none: there is
  // no caret in it and no selection, so a range command has nothing to act on.
  useEffect(() => {
    onHandle?.(null)
    return () => onHandle?.(null)
  }, [onHandle])

  const act = useCallback(
    /**
     * Do one thing, and **say whether it worked**.
     *
     * **Null means it failed, and anything else is what the verb returned.** A
     * row that closes the moment it fires a
     * verb throws away what somebody typed if the verb then fails — reported
     * from use: a step with an unreadable `when` vanished on Enter, taking its
     * text with it, and the complaint said *it drops the item*. A caller that
     * can see the failure can keep the words on the screen to be corrected.
     */
    async <T,>(work: Promise<T>): Promise<T | null> => {
      try {
        const got = await work
        setProblem(null)
        await refresh()
        return got
      } catch (err) {
        // **Said in the view, not thrown at the app.** A bad date typed during a
        // conversation is an ordinary event and must not put a dialog between
        // two people and the thing they are discussing.
        setProblem((err as Error).message)
        return null
      }
    },
    [refresh],
  )

  const total = sections.reduce((n, s) => n + s.matters.length, 0)
  const divided = sections.some(one => one.name !== '')

  /**
   * The groups to draw — which is the sections, plus an empty undivided run
   * when the docket is divided and everything happens to be filed.
   *
   * **Because there has to be somewhere to drag a matter OUT to.** The first cut
   * conjured a strip for the duration of the drag, and that was a bad bug rather
   * than a neat trick: it appeared on `pointerdown`, pushed every row down by
   * its own height, and so the row you had aimed at was no longer under your
   * cursor. Nothing that appears *because* a drag started may occupy space.
   */
  const groups: readonly Section[] = sections.length === 0
    // A docket with nothing on it still needs the one place to put something.
    ? [{ name: '', matters: [] }]
    : divided && !sections.some(one => one.name === '')
      ? [{ name: '', matters: [] as readonly Matter[] }, ...sections]
      : sections

  /**
   * Where a dropped matter actually goes.
   *
   * **A drop on a row means *before it* or *after it* by which half of the row
   * the pointer is in**, and *after* is expressed as *before the next one* —
   * which is the same verb, so there is one call and one thing to get wrong. The
   * last row in a section has no next one, and that absence IS *the end of this
   * section*, which is exactly what `place` does with no `before`.
   */
  const land = useCallback(
    (landing: Landing): void => {
      if (dragging === null) return
      if ('section' in landing) {
        void act(window.tephra.docket.place(id, dragging, landing.section))
        return
      }
      const holder = sections.find(one => one.matters.some(m => m.id === landing.id))
      if (holder === undefined) return
      const at = holder.matters.findIndex(m => m.id === landing.id)
      const next = landing.edge === 'before' ? landing.id : holder.matters[at + 1]?.id
      const before = next === null || next === undefined ? undefined : next
      void act(window.tephra.docket.place(id, dragging, holder.name, before))
    },
    [act, dragging, id, sections],
  )

  /** Every drag ends the same way, however it ended. */
  const rest = useCallback((): void => {
    setDragging(null)
    setOver(null)
  }, [])

  /**
   * What is under the pointer, read off the DOM rather than out of React.
   *
   * **The rows announce themselves with `data-` attributes** so this is one
   * geometric lookup instead of a hit-test threaded through every child. A row
   * answers *above or below me*; a heading, an empty section and the loose strip
   * all answer *into this group*.
   */
  const landingAt = useCallback((x: number, y: number): Landing | null => {
    const at = document.elementFromPoint(x, y)
    if (at === null) return null
    const row = at.closest('[data-matter]')
    if (row !== null) {
      const held = row.getAttribute('data-matter')
      const box = row.getBoundingClientRect()
      if (held !== null) {
        return { id: held, edge: y < box.top + box.height / 2 ? 'before' : 'after' }
      }
    }
    const zone = at.closest('[data-drop-section]')
    const name = zone?.getAttribute('data-drop-section')
    return name === null || name === undefined ? null : { section: name }
  }, [])

  /**
   * The drag itself, on pointer events rather than HTML5 drag-and-drop.
   *
   * **Twice this was built on `draggable` and twice it did not start.** First
   * the handle was a `<button>`, which is not a drag source; then it was a span
   * that the engine still would not lift. What made the bug expensive was not
   * the cause but that it was *invisible to the tests*: an acceptance scene can
   * only dispatch `dragstart` itself, which proves the handlers and skips the
   * single open question — whether a drag ever begins. Eight checks passed on a
   * feature that did nothing at all.
   *
   * Pointer events have no such question. `pointerdown` fires because a button
   * went down, the same event a test dispatches is the one a hand produces, and
   * nothing in the engine gets to decide whether this element is liftable. It
   * also means the feedback is ours to draw rather than the platform's to
   * withhold — *nothing is lifted* was the other half of the report.
   */
  useEffect(() => {
    if (dragging === null) return undefined
    const move = (event: PointerEvent): void => {
      setOver(landingAt(event.clientX, event.clientY))
    }
    const up = (event: PointerEvent): void => {
      const landing = landingAt(event.clientX, event.clientY)
      if (landing !== null && !('id' in landing && landing.id === dragging)) land(landing)
      rest()
    }
    // On `window`, not on the handle: the pointer leaves the handle immediately
    // and a capture that fails silently would strand the drag.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', rest)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', rest)
    }
  }, [dragging, land, landingAt, rest])

  const type = {
    '--reading-face': settings.typography.font,
    '--reading-size': `${settings.typography.size}px`,
  } as React.CSSProperties

  return (
    <main
      className={`docket${dragging === null ? '' : ' lifting'}`}
      aria-label="Docket"
      style={type}
    >
      {problem !== null && <p className="docket-problem">{problem}</p>}

      {groups.map(section => (
        <section className="docket-section" key={section.name === '' ? ':unsectioned' : section.name}>
          {/* **The undivided run is labelled only once the docket is divided.**
              On a docket with no sections it has no heading at all, because
              there is nothing to tell it apart from — naming it would put a
              decision on the screen that nobody made. Once there are sections it
              needs saying, both as a fact about those matters and because it has
              to be a place you can drag something back to. It gets no rename and
              no ungroup: it is not a section and there is nothing to remove. */}
          {section.name === '' && divided && (
            <div className="docket-section-head loose" data-drop-section="">
              <h2 className="docket-section-name">no section</h2>
            </div>
          )}

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
              <div
                // **Dropping on the heading means *into this section*, at its
                // end** — the one thing a heading can unambiguously mean, and
                // the only way to reach a section that has nothing in it yet.
                data-drop-section={section.name}
                className={`docket-section-head${
                  over !== null && 'section' in over && over.section === section.name ? ' over' : ''
                }`}
              >
                <h2 className="docket-section-name">{section.name}</h2>
                {/* **Beside the title, and quiet until the heading is under the
                    pointer.** At the far right of the row they read as belonging
                    to the matter below — reported from use — because that is
                    what is directly beneath them. Proximity is what says which
                    thing a control acts on; nothing else does. */}
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
                open={matter.id !== null && expanded.has(matter.id)}
                onMenu={at => {
                  if (matter.id === null) return
                  const who = matter.id
                  setMenu({
                    at,
                    about: matter.name,
                    // **Sentences, because there is room for them.** The row of
                    // buttons this replaced forced every one of these down to a
                    // single word — *tag*, *who*, *note* — which said what the
                    // field was called rather than what pressing it would do.
                    items: [
                      { label: 'Rename…', onChoose: () => setEditing({ matter: who, field: 'name' }) },
                      { label: 'Add a step…', onChoose: () => { show(who, true); setOpen(who) } },
                      'rule',
                      { label: 'Add a tag…', onChoose: () => setEditing({ matter: who, field: 'tags' }) },
                      {
                        label: matter.owner === null ? 'Say who has it…' : 'Change who has it…',
                        onChoose: () => setEditing({ matter: who, field: 'owner' }),
                      },
                      {
                        label: matter.notes.length === 0 ? 'Add a note…' : 'Edit the note…',
                        onChoose: () => setEditing({ matter: who, field: 'note' }),
                      },
                      {
                        label: matter.link === null ? 'Link to a document…' : 'Change the link…',
                        onChoose: () => setEditing({ matter: who, field: 'link' }),
                      },
                      // **The two verbs that act on the INSTANCE, not the
                      // matter's fields.** They belong here because that is what
                      // they are — acts on the matter — and the task list offers
                      // them only as a shortcut from where you happen to notice
                      // you want one (H1: one source, and the list is a
                      // projection of it).
                      //
                      // *Skip* only exists where there IS a next instance: on a
                      // one-off it would collapse into *suspend*, and an option
                      // that cannot do anything is the affordance mistake MH1
                      // made three times, inverted.
                      ...(matter.when.every !== null && matter.when.start !== null
                        ? ['rule' as const, {
                          label: 'Skip to the next one',
                          onChoose: () => { void act(window.tephra.docket.advance(id, who)) },
                        }]
                        : []),
                      ...(matter.when.start !== null
                        ? [{
                          label: 'Suspend this matter',
                          onChoose: () => { void act(window.tephra.docket.suspend(id, who)) },
                        }]
                        : []),
                      'rule',
                      {
                        label: 'Remove this matter',
                        destructive: true,
                        onChoose: () => { void act(window.tephra.docket.remove(id, who)) },
                      },
                    ],
                  })
                }}
                onShow={want => { if (matter.id !== null) show(matter.id, want) }}
                onAdding={want => {
                  setOpen(want && matter.id !== null ? matter.id : null)
                  // Asking to add a step is asking to see them.
                  if (want && matter.id !== null) show(matter.id, true)
                }}
                onAddStep={async (when, text, kind) => {
                  if (matter.id === null) return null
                  return act(window.tephra.docket.addStep(id, matter.id, when, text, kind))
                }}
                onDropStep={step => {
                  if (matter.id !== null) void act(window.tephra.docket.removeStep(id, matter.id, step))
                }}
                onEditStep={async (step, text) => {
                  if (matter.id === null) return null
                  return act(window.tephra.docket.editStep(id, matter.id, step, text))
                }}
                onStepWhen={async (step, when) => {
                  if (matter.id === null) return null
                  return act(window.tephra.docket.setStepWhen(id, matter.id, step, when))
                }}
                onStepKind={(step, kind) => {
                  if (matter.id !== null) {
                    void act(window.tephra.docket.setStepKind(id, matter.id, step, kind))
                  }
                }}
                onSetAfter={step => {
                  if (matter.id !== null) void act(window.tephra.docket.setAfter(id, matter.id, step))
                }}
                onSetMode={mode => {
                  if (matter.id !== null) void act(window.tephra.docket.setMode(id, matter.id, mode))
                }}
                onSetDates={dates => {
                  if (matter.id !== null) void act(window.tephra.docket.setDates(id, matter.id, dates))
                }}
                today={today}
                zone={zone}
                onActivate={() => {
                  if (matter.id !== null) void act(window.tephra.docket.activate(id, matter.id))
                }}
                onSuspend={() => {
                  if (matter.id !== null) void act(window.tephra.docket.suspend(id, matter.id))
                }}
                onEdit={field => setEditing(field === null || matter.id === null ? null : { matter: matter.id, field })}
                onCommit={(field, value) => {
                  // **The schedule panel stays open while it is edited.** Every
                  // other field here is one commit and done, so committing closed
                  // the editor — and a panel with four controls in it closed on
                  // the first click, which looked exactly like the control not
                  // working.
                  if (field !== 'when' && field !== 'every') setEditing(null)
                  if (matter.id === null) return
                  void act(commit(id, matter.id, field, value))
                }}
                onRemove={() => {
                  if (matter.id !== null) void act(window.tephra.docket.remove(id, matter.id))
                }}
                onNudge={delta => {
                  if (matter.id !== null) void act(window.tephra.docket.nudge(id, matter.id, delta))
                }}
                dragging={dragging === matter.id}
                edge={over !== null && 'id' in over && over.id === matter.id ? over.edge : null}
                onLift={() => setDragging(matter.id)}
                onPlace={into => {
                  if (matter.id === null) return
                  // The menu's own empty value is its prompt, so *out of every
                  // section* travels as a sentinel and is turned back here.
                  void act(window.tephra.docket.place(id, matter.id, into === UNSECTIONED ? '' : into))
                }}
              />
            ))}
          </ol>

          {section.matters.length === 0 && divided && (
            // An empty section is a real state — it gets said before it gets
            // filled — so it says what it is rather than looking broken.
            <p
              data-drop-section={section.name}
              className={`docket-section-empty${
                over !== null && 'section' in over && over.section === section.name ? ' over' : ''
              }`}
            >
              {dragging === null ? 'nothing in this one yet' : 'drop it here'}
            </p>
          )}

          {/* **Add INTO the group you are looking at** — the task list's
              gesture (`+ Add to house`), and the same argument: the section is
              already decided by which button you reached for, so the add row
              has nothing left to ask. */}
          {adding === section.name ? (
            <NewMatter
              onCancel={() => setAdding(null)}
              onCommit={(name, shape) => {
                setAdding(null)
                if (name.trim() === '') return
                // **Folded on arrival.** It used to open itself, on the
                // reasoning that the seeded step is the first thing anybody
                // will want to change — but that step's text *is* the matter's
                // name (D76), so unfolding showed one line repeating the
                // heading above it. The same redundancy the horizon had to
                // suppress when it stopped printing a matter's name beside a
                // row that already said it. Reported from use.
                void act(window.tephra.docket.add(
                  id, name, shape, section.name === '' ? undefined : section.name,
                ))
              }}
            />
          ) : (
            <button className="docket-add here" onClick={() => setAdding(section.name)}>
              {section.name === '' ? '+ Add a matter' : `+ Add to ${section.name}`}
            </button>
          )}
        </section>
      ))}

      {/* **Only one thing left down here**, now that adding a matter happens in
          the group it is being added to. It is an ordinary button rather than a
          quiet one: muted ink beside a bordered neighbour read as *disabled*,
          which was reported, and there is no longer a neighbour to be quieter
          than anyway. */}
      {newSection ? (
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
        <button className="docket-add" onClick={() => setNewSection(true)}>
          Add a section
        </button>
      )}

      {menu !== null && <RowMenu request={menu} onClose={() => setMenu(null)} />}

      {total === 0 && adding === null && (
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

type Field = 'name' | 'when' | 'every' | 'owner' | 'tags' | 'note' | 'untag' | 'link'

/** *Out of every section*, as a menu value — `''` is the menu's own prompt. */
const UNSECTIONED = ':none'

/**
 * What a step refers to when it says *after this one*.
 *
 * **The file holds an id and a person reads a name.** The reference has to be by
 * id to survive a step being inserted above it (D56's rule), and `after 4c8e11a2`
 * means nothing said out loud — so the surface looks the name up.
 */
/**
 * Which number a step is, one-based, as the row shows it.
 *
 * **What an edit field is prefilled with**, so that correcting a dependency
 * hands back `after step 2` rather than `after okc8kiff` — the id being the one
 * reference nobody can type, which is why the index exists at all.
 */
const indexOfStep = (matter: Matter, id: string): number | null => {
  const at = matter.steps.findIndex(one => one.id === id)
  return at < 0 ? null : at + 1
}

/** Which side of a row a drop lands on. */
type Edge = 'before' | 'after'

/**
 * Where a drag would land: beside a matter, or inside a section.
 *
 * Two shapes because there are two targets with two meanings — *put it here in
 * this order* and *put it in this group* — and collapsing them would mean one of
 * them guessing at the other.
 */
type Landing = { id: string; edge: Edge } | { section: string }

function commit(docket: DocumentId, matter: string, field: Field, value: string): Promise<unknown> {
  const said = value.trim()
  switch (field) {
    case 'name':
      return window.tephra.docket.rename(docket, matter, said)
    case 'when':
      return window.tephra.docket.setStart(docket, matter, said === '' ? null : said)
    case 'every':
      return window.tephra.docket.setEvery(docket, matter, said === '' ? null : said)
    case 'owner':
      return window.tephra.docket.setOwner(docket, matter, said === '' ? null : said)
    case 'tags':
      // One tag at a time is the gesture; the field takes what is typed and the
      // hash is optional, because nobody types punctuation in a conversation.
      return window.tephra.docket.tag(docket, matter, said.replace(/^#/, ''))
    case 'untag':
      return window.tephra.docket.untag(docket, matter, said.replace(/^#/, ''))
    case 'link':
      // **One relative link to one document** (H14) — the matter's plans, its
      // quotes, the thread it came out of.
      return window.tephra.docket.setLink(docket, matter, said === '' ? null : said)
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
  onAddStep,
  onDropStep,
  onEditStep,
  onStepWhen,
  onStepKind,
  onSetAfter,
  onSetMode,
  onSetDates,
  today,
  zone,
  open,
  onShow,
  onMenu,
  onActivate,
  onSuspend,
  onNudge,
  onPlace,
  dragging,
  edge,
  onLift,
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
  /** The instances, listed outright — the alternative to an interval (H7). */
  onSetDates: (dates: readonly DateKey[]) => void
  today: DateKey | null
  /** The zone dates are computed in (D63), for reading completion stamps. */
  zone: string
  onRemove: () => void
  onAddStep: (when: string, text: string, kind: StepKind) => Promise<unknown>
  onDropStep: (step: string) => void
  /** Both answer whether it worked, so a bad value keeps the field open. */
  onEditStep: (step: string, text: string) => Promise<unknown>
  onStepWhen: (step: string, when: string) => Promise<unknown>
  onStepKind: (step: string, kind: StepKind) => void
  /** Which step's completion starts the next instance — null for the calendar. */
  onSetAfter: (step: string | null) => void
  onSetMode: (mode: Mode) => void
  /** Whether the steps are showing, and how to say otherwise. */
  open: boolean
  onShow: (want: boolean) => void
  onMenu: (at: { x: number; y: number }) => void
  onActivate: () => void
  onSuspend: () => void
  onNudge: (delta: number) => void
  onPlace: (into: string) => void
  /** Whether this row is the one being dragged. */
  dragging: boolean
  /** Which side of this row the drop would land on, if any. */
  edge: Edge | null
  /** Picked up. Everything after this is the surface's pointer session. */
  onLift: () => void
}): React.JSX.Element {
  // The round-trip form is what an edit starts from; the reading form is what
  // the row shows. See `readWhen`.
  const read = readSchedule(matter.when, matter.mode, today ?? undefined)
  /**
   * **Inactive is *no start date*, and nothing else** (D76). There is no
   * suspended flag: a matter with no date cannot compute `T±N`, so it cannot
   * generate, so it is on the backlog. A periodic matter with no anchor is the
   * same state wearing a rule.
   */
  /** Which half of which step is being corrected. Local: it is one gesture. */
  const [fixing, setFixing] = useState<{ step: string; part: 'when' | 'what' } | null>(null)
  const inactive = matter.when.start === null
  return (
    <li
      // **Right-click anywhere on a matter** (D10's idiom, as the sidebar and
      // the task list already use): everything a matter needs rarely lives
      // here, where an item can be a sentence rather than a word squeezed into
      // a row, and where opening it moves nothing.
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
        onMenu({ x: event.clientX, y: event.clientY })
      }}
      // **The whole row is the drop target, not just the handle** — aiming at a
      // grip to *land* on is a harder act than aiming at one to *pick up* by,
      // and a row is a big target. Which half the pointer is in decides above
      // or below, worked out in `landingAt` from this attribute.
      data-matter={matter.id ?? undefined}
      className={`docket-row${dragging ? ' lifted' : ''}${
        edge === null ? '' : ` over-${edge}`
      }`}
    >
      <div className="docket-line">
        {/* **Faint, but never invisible.** Hover-only would be allowed here and
            is still the wrong call for *this* control: the thing being reported
            was not knowing that rows could be moved at all, and an affordance
            you have to find by sweeping the pointer over the page does not
            answer that. So it sits there quietly and firms up under the cursor.

            It is also a button, and a focused one takes ↑ and ↓ — which is the
            keyboard path that the arrows used to be, kept without spending two
            controls on it. */}
        {/* **A span, not a button, and that is the whole reason it works.** It
            was a `<button draggable>`: the cursor changed, the handlers were
            wired, and nothing happened when you grabbed it — because a form
            control is not a drag source in this engine. `mousedown` on a button
            is an activation gesture and the drag is never begun, so `dragstart`
            never fires and there is nothing to debug. Focusable and labelled by
            hand instead, which keeps the keyboard path. */}
        <span
          className="docket-grip"
          role="button"
          tabIndex={0}
          aria-label={`Move ${matter.name}`}
          title="Drag to move — or focus and use ↑ ↓"
          onPointerDown={event => {
            if (event.button !== 0 || matter.id === null) return
            // Stops the press becoming a text selection, and is the reason a
            // lift does not need the engine's permission.
            event.preventDefault()
            onLift()
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowUp' && !first) {
              event.preventDefault()
              onNudge(-1)
            } else if (event.key === 'ArrowDown' && !last) {
              event.preventDefault()
              onNudge(1)
            }
          }}
        />
        {editing === 'name' ? (
          <Field1 initial={matter.name} onCommit={v => onCommit('name', v)} onCancel={() => onEdit(null)} />
        ) : (
          <button className="docket-name" onClick={() => onEdit('name')} title="Rename">
            {matter.name}
          </button>
        )}

        {/* **The tools live in the slack between the name and the date**, which
            was dead space, and they appear on hover. **Hover may fill space
            that is already reserved and may never add or remove a line** — a
            control row that materialised under the pointer would push every
            step down, which is the same fault as the drop strip that shifted
            the list the moment a drag began. Clicking may reflow; hovering may
            not, because the thing that moved is then the thing you asked to
            move. */}
        {/* **Only where it means something**, and **left of the disclosure**.
            Adding a step to a matter whose steps are folded away offers to make
            something you cannot see, so it appears on unfolding. It used to
            appear to the RIGHT of the disclosure: the row flushes right, so a
            control arriving there widened that group and shoved the disclosure
            leftwards — expand and immediately collapse, and the second click
            landed on `+ step` and silently added one. Reported from use. On this
            side it grows into the name's slack and nothing that was already
            there moves (D42).

            The `⋯` that used to sit beside it has gone entirely: it opened a row
            *below* this line, so the steps jumped down — the no-jumping rule
            broken by the very thing meant to obey it — and a row of buttons
            forces every name down to one word. Right-click anywhere on a matter
            instead, where the items can be sentences. */}
        {open && (
          <span className="docket-tools">
            <button className="docket-quiet" onClick={() => onAdding(!adding)}>+ step</button>
          </span>
        )}
        {/* **Structure, not a control** — always visible, quiet, and carrying
            the count, so it does not repeat the mistake of a bare number that
            looked like a label. */}
        <button
          className="docket-open"
          aria-expanded={open}
          onClick={() => { if (matter.id !== null) onShow(!open) }}
          title={open ? 'Hide the steps' : 'Show the steps'}
        >
          <span className="docket-open-mark" aria-hidden="true" />
          {matter.steps.length}
        </button>
        {/* **One thing to click for the whole schedule.** The column already
            read as a sentence that encodes the mode — *no date yet*, *every 90
            days after it is done* — so it is the obvious place to change it,
            and folding the mode, the date and the interval behind it takes
            three controls out of the resting row. The black-bordered dropdown
            that used to sit here was the heaviest mark on a page of quiet
            ones, for a setting that is usually at its default. */}
        {editing === 'when' ? (
          // **The slug stays where it was, and the panel opens below.** Replacing
          // the sentence with the editor moved everything right of it; the row
          // keeps its shape and the panel grows underneath, which is a reflow
          // somebody asked for by clicking (D42).
          <span className="docket-when open">{read}</span>
        ) : (
          <button
            className={`docket-when${inactive ? ' undecided' : ''}`}
            onClick={() => onEdit('when')}
            title="When this happens, and what sort of thing it is"
          >
            {read}
          </button>
        )}

        {/* **The one button that turns a backlog into work** (D76). Inactive
            means no start date, which means `T±N` is not computable and so
            nothing can generate; activating chooses the date that puts the first
            step on the list today. Suspending clears it again — which is what a
            deferred talk actually is, *still happening, date to be decided* —
            and leaves completed steps completed, so a mis-press costs nothing. */}
        {inactive ? (
          <button className="docket-start" onClick={onActivate} title="Start work on this now">
            activate
          </button>
        ) : (
          <button
            className="docket-start quiet"
            onClick={onSuspend}
            title="Stop work on this, keeping what is already done"
          >
            suspend
          </button>
        )}
      </div>

      {editing === 'when' && (
        <SchedulePanel
          matter={matter}
          today={today}
          onMode={onSetMode}
          onStart={v => onCommit('when', v ?? '')}
          onEvery={v => onCommit('every', v ?? '')}
          onAfter={onSetAfter}
          onDates={onSetDates}
          onClose={() => onEdit(null)}
        />
      )}

      {/* **Only what HAS content, and only then.** Tags and an owner are facts
          about the matter and belong on the page; *tag* and *who* are controls
          and have gone to the menu. The row is empty and absent when there is
          nothing to say, which is most of the time. */}
      {(matter.tags.length > 0 || matter.owner !== null || matter.link !== null
        || editing === 'tags' || editing === 'owner' || editing === 'link') && (
        <div className="docket-under">
          {matter.tags.map(tag => (
            <button
              key={tag}
              className="pill label"
              title="Remove this tag"
              onClick={() => onCommit('untag', tag)}
            >
              {tag}
            </button>
          ))}
          {editing === 'tags' && (
            <Field1
              initial=""
              placeholder="tag"
              onCommit={v => onCommit('tags', v)}
              onCancel={() => onEdit(null)}
            />
          )}
          {editing === 'owner' ? (
            <Field1
              initial={matter.owner ?? ''}
              placeholder="who"
              onCommit={v => onCommit('owner', v)}
              onCancel={() => onEdit(null)}
            />
          ) : (
            matter.owner !== null && <span className="docket-owner">{matter.owner}</span>
          )}
          {editing === 'link' ? (
            <Field1
              initial={matter.link ?? ''}
              className="docket-field wide"
              placeholder="../notes/the-quote.md"
              title="A relative path to one document"
              onCommit={v => onCommit('link', v)}
              onCancel={() => onEdit(null)}
            />
          ) : (
            matter.link !== null && (
              <a className="docket-link" href={matter.link} title={matter.link}>
                {matter.link.split('/').pop() ?? matter.link}
              </a>
            )
          )}
        </div>
      )}

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
      {(open || adding) && (
        <div className="docket-steps">
          {matter.steps.map((step, at) => (
            <div
              key={step.id ?? `${at}`}
              className={`docket-step${step.done === null ? '' : ' done'}`}
            >
              {/* **The number a reference points at.** *After #1* was sayable
                  before this was visible, which was reported in as many words.
                  It is the handle a person can type: the real id is eight
                  random characters and belongs in the file. */}
              <span className="docket-step-at" aria-hidden="true">{at + 1}</span>

              {/* **The words first, in the column the matter's name is in.**
                  They used to sit behind the schedule and at an indent of their
                  own, so the strong marks in a step did not line up with
                  anything and the steps read as a separate stratum near the
                  matter rather than as part of it. Editable in place, because a
                  step has an identity: dropping and retyping it orphans
                  whatever waits on it and forgets that it was done. */}
              {fixing?.step === step.id && fixing.part === 'what' ? (
                <Field1
                  initial={step.text}
                  className="docket-field wide"
                  onCommit={value => {
                    if (step.id === null) return
                    const one = step.id
                    void onEditStep(one, value).then(ok => { if (ok !== null) setFixing(null) })
                  }}
                  onCancel={() => setFixing(null)}
                />
              ) : (
                <button
                  className="docket-step-what"
                  title="Fix what this step says"
                  onClick={() => { if (step.id !== null) setFixing({ step: step.id, part: 'what' }) }}
                >
                  {step.text}
                </button>
              )}

              {/* And the schedule after them, quietly, as the rest of the
                  sentence: *find an electrician · right away*. */}
              {fixing?.step === step.id && fixing.part === 'when' ? (
                <Field1
                  initial={spellStepWhen(step.when, one => indexOfStep(matter, one))}
                  className="docket-field narrow"
                  placeholder="when"
                  onCommit={value => {
                    if (step.id === null) return
                    const one = step.id
                    void onStepWhen(one, value).then(ok => { if (ok !== null) setFixing(null) })
                  }}
                  onCancel={() => setFixing(null)}
                />
              ) : (
                <button
                  className={`docket-step-when${step.done === null ? '' : ' finished'}`}
                  title={step.done === null
                    ? 'When this step happens — right away · 2 weeks · +3 days · then · after #1'
                    : 'When this step was finished'}
                  onClick={() => { if (step.id !== null) setFixing({ step: step.id, part: 'when' }) }}
                >
                  {/* **A finished step says WHEN it was finished**, not when it
                      was due. *Right away* on something already done describes a
                      plan nobody needs any more, and the useful fact — the one
                      that answers *where is this up to* — was nowhere on the
                      page. It is also what makes a matter's last action legible
                      by reading its steps. */}
                  {step.done === null
                    ? readStepWhen(step.when, one => indexOfStep(matter, one))
                    : `completed ${dateKeyAt(new Date(step.done * 1000), zone)}`}
                </button>
              )}

              {/* **The rest fills this line's own slack, on hover.** Never a new
                  line: the steps below must not move because the pointer
                  crossed this one. */}
              <span className="docket-step-tools">
                {shapeOf(matter.mode).fromCompletion && (
                  <label className="docket-step-clock" title="Doing this starts the next one">
                    <input
                      type="radio"
                      name={`clock-${matter.id ?? 'x'}`}
                      checked={matter.when.after === step.id}
                      disabled={step.id === null}
                      onChange={() => { if (step.id !== null) onSetAfter(step.id) }}
                    />
                    and mark this complete
                  </label>
                )}
                <select
                  className={`docket-step-kind${step.kind === 'task' ? ' ordinary' : ''}`}
                  value={step.kind}
                  disabled={step.id === null}
                  title="A task to do · a status to be aware of"
                  onChange={event => {
                    if (step.id !== null) onStepKind(step.id, event.target.value as StepKind)
                  }}
                >
                  <option value="task">Do a task</option>
                  <option value="status">Raise a reminder</option>
                </select>
                <button
                  className="docket-quiet danger"
                  onClick={() => { if (step.id !== null) onDropStep(step.id) }}
                >
                  drop
                </button>
              </span>
            </div>
          ))}
          {adding && (
            <NewRunUp
              onCommit={(when, text, kind) => onAddStep(when, text, kind)}
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
  /** Answers whether it worked; the row stays open if it did not. */
  onCommit: (offset: string, text: string, kind: StepKind) => Promise<unknown>
  onDone: () => void
}): React.JSX.Element {
  const [offset, setOffset] = useState('')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<StepKind>('task')
  const what = useRef<HTMLInputElement>(null)
  // **The caret starts in *what*, not in *when*.** The text is the one required
  // part and the schedule has a good default — blank is `T+0` — so the field
  // that always needs typing is the one to be in. Asked for at all because the
  // gesture is *add a step*: making somebody click twice for one act is a click
  // too many.
  useEffect(() => what.current?.focus(), [])
  const done = (): void => {
    // **Only the text is required.** A blank *when* used to make this return
    // silently, so pressing Enter did nothing and said nothing — which read as
    // a broken key rather than a missing field. Blank means `T+0`: due as soon
    // as the matter is started, which is the commonest step there is.
    if (text.trim() === '') return
    void onCommit(offset, text, kind).then(ok => {
      // **A failure keeps the words.** Closing on the way out threw away the
      // typing whenever the schedule was unreadable, which read as *it just
      // drops the item*; the complaint appears above and the text stays put.
      if (ok === null) return
      // **A success opens the next one.** Work comes in sequences — find a
      // shop, then have the car fixed, then claim it back — so the row clears
      // and waits rather than making the whole gesture again per step. What
      // made this confusing the first time round was the *exit* being called
      // `done`, which reads as *cancel* beside an `add`; it says `cancel` now,
      // and Escape from either field does the same.
      setOffset('')
      setText('')
      setKind('task')
      what.current?.focus()
    })
  }
  return (
    <div className="docket-step new">
      <input
        className="docket-field narrow"
        value={offset}
        placeholder="when"
        aria-label="When this step happens"
        title="right away · 2 weeks · +3 days · then · after step 1"
        spellCheck={false}
        onChange={e => setOffset(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            done()
          } else if (e.key === 'Escape') onDone()
        }}
      />
      <input
        ref={what}
        className="docket-field wide"
        value={text}
        placeholder="what happens then"
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
      {/* **Which of the two kinds it is.** Asked from use — *how do I create
          an interval-scheduled task?* — and the answer was that you could not:
          every step was authored as a task, so the kind that makes a matter
          recur from its own completion had no way in at all. */}
      <select
        className="docket-step-kind"
        value={kind}
        onChange={event => setKind(event.target.value as StepKind)}
        title="A task to do · a status to be aware of · the next instance of this matter"
      >
        <option value="task">Do a task</option>
        <option value="status">Raise a reminder</option>
      </select>
      <button className="docket-quiet" onClick={done}>add</button>
      <button className="docket-quiet" onClick={onDone}>cancel</button>
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
/**
 * The schedule, edited structurally rather than typed (MH4, H7).
 *
 * **A panel, because the field was too small to say this much in.** The schedule
 * was one narrow text box: a date, or `every 90d`, parsed leniently on the way
 * in. Adding a list of dates to that would have made it a long unreadable
 * string in a box you cannot see the end of — reported from use before it was
 * built, which is the cheapest moment to hear it.
 *
 * **Structural, not parsed.** Text flexible enough to feel natural is hard to
 * get right without a language model, and a grammar that *nearly* works is worse
 * than controls: it fails on the cases somebody assumed would work. So the four
 * shapes are four radio buttons and every field under them means exactly one
 * thing.
 *
 * **The four shapes are the whole vocabulary** — no date, one date, an interval
 * from a date or from completion, or a list. They are mutually exclusive by
 * construction here, which is what keeps a matter from holding two answers about
 * when it comes round.
 */
function SchedulePanel({
  matter,
  today,
  onMode,
  onStart,
  onEvery,
  onAfter,
  onDates,
  onClose,
}: {
  matter: Matter
  today: DateKey | null
  onMode: (mode: Mode) => void
  onStart: (start: string | null) => void
  onEvery: (every: string | null) => void
  onAfter: (after: string | null) => void
  onDates: (dates: readonly DateKey[]) => void
  onClose: () => void
}): React.JSX.Element {
  const { when } = matter
  const doing = shapeOf(matter.mode).kind === 'task'
  const repeats = shapeOf(matter.mode).repeating
  const fromCompletion = shapeOf(matter.mode).fromCompletion

  /**
   * Two independent questions, held here rather than derived.
   *
   * **A recurring task asks both**: whether work has begun, and how it comes
   * round. One `shape` field conflated them — choosing *on these dates* would
   * have unset *started*, which is not a thing either answer says about the
   * other.
   *
   * **And both need UI state of their own, because their empty values are
   * indistinguishable from unset.** *Started on* with no date yet is `start ===
   * null`, which is also *not started*; *on these dates* with none yet is no
   * list, which is also *every so often*. Derived, each radio sprang back the
   * moment it was pressed — the control refusing the only thing you could do
   * first. The file needs no representation for either; this does.
   */
  const [started, setStarted] = useState(when.start !== null)
  const [listed, setListed] = useState(when.dates !== null)
  const [adding, setAdding] = useState('')
  /** What is in the interval box, which may be mid-edit and so not a number. */
  const [count, setCount] = useState(String(when.every?.n ?? 1))
  useEffect(() => {
    setCount(String(when.every?.n ?? 1))
    // Only when the stored interval moves; typing is the field's own business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when.every?.n])

  useEffect(() => {
    // Changing what a thing IS is allowed to change what is asked about it.
    setStarted(when.start !== null)
    setListed(when.dates !== null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matter.mode])

  /**
   * What the next few instances actually are.
   *
   * **Computed from whatever is selected**, which is what makes an interval
   * concrete — *every 1 month on the 31st* is a rule until you see it land on
   * the 28th of February — and doubles as the full list a listed schedule wants
   * to show. Six, because the point is to recognise the pattern, not to read a
   * calendar.
   */
  const upcoming = instancesIn(matter, addDays(today ?? ('9999-12-31' as DateKey), 800)).slice(0, 6)

  const radio = (
    group: string,
    on: boolean,
    label: string,
    choose: () => void,
    off = false,
  ): React.JSX.Element => (
    <label className="sched-option">
      <input type="radio" name={group} checked={on} disabled={off} onChange={choose} />
      {label}
    </label>
  )

  return (
    <div className="sched" role="group" aria-label="When this happens">
      <label className="sched-row">
        <span className="sched-label">This is</span>
        <select
          className="docket-mode"
          value={matter.mode}
          onChange={event => onMode(event.target.value as Mode)}
        >
          {MODES.map(one => <option key={one.key} value={one.key}>{one.title}</option>)}
        </select>
      </label>

      {/* **A task has begun or it has not.** The date is *when work began* (D80),
          which is a different fact from an event's *when this happens*. */}
      {doing && (
        <div className="sched-shapes">
          {radio('began', !started, 'Not started', () => { setStarted(false); onStart(null) })}
          {radio('began', started, 'Started on', () => setStarted(true))}
        </div>
      )}

      {/* **A one-off event always has the field**, whether or not it has a date:
          it asks nothing above, so without this there would be no way to give it
          one — the panel would open on a matter it could not schedule. */}
      {((doing && started) || (!doing && (!repeats || !listed))) && (() => {
        /**
         * **Ask the question somebody can answer.**
         *
         * A matter recurring from its own completion stores *when it is next
         * due*, and what a person has is *when I last did it* — reported from
         * use, typing the last water-filter change into a field that meant the
         * next one and getting a task that was instantly overdue. So for that one
         * shape the field says **Last done** and the interval does the
         * arithmetic; everywhere else it still means exactly what it says.
         */
        const counted = repeats && !listed && when.after !== null && when.every !== null
        const shown = counted && when.start !== null
          ? backInterval(when.start, when.every as Interval)
          : when.start
        return (
          <label className="sched-row">
            <span className="sched-label">
              {counted ? 'Last done' : doing ? 'Started' : repeats ? 'Starting' : 'On'}
            </span>
            <input
              type="date"
              className="sched-date"
              value={shown ?? ''}
              title={counted ? 'When it was last done; the next one follows from the interval' : undefined}
              onChange={event => {
                const said = event.target.value
                if (said === '') { onStart(null); return }
                onStart(counted && when.every !== null
                  ? addInterval(said as DateKey, when.every as Interval).date
                  : said)
              }}
            />
          </label>
        )
      })()}

      {/* **How it comes round**, which is the other question entirely — and a
          list is as good an answer as a rule for either kind (H7). */}
      {repeats && (
        <div className="sched-shapes">
          {/* **One write per click, at most.** These fired two apiece — clear the
              list, then set an interval — and each write reconciles and is read
              back, so the panel re-rendered twice from two different states and
              the radios appeared to fight each other. Reported from use as
              *it tries to reset everything else and gets very confused*.

              Setting an interval already clears a list and vice versa (D80), so
              one call does both; and *on these dates* with none yet needs no
              write at all, because an empty list is not a thing the file says. */}
          {radio('recur', !listed, 'Every so often', () => {
            setListed(false)
            if (when.every === null) onEvery('1m')
          })}
          {radio('recur', listed, 'On these dates', () => {
            setListed(true)
            if (when.every !== null) onEvery(null)
          })}
        </div>
      )}

      {repeats && !listed && (
        <>
          <label className="sched-row">
            <span className="sched-label">Every</span>
            {/* **Typed as text, committed when it is a number.** Bound straight
                to the value with a `Math.max(1, …)` on the way in, an empty
                field became `1` on the keystroke that emptied it — so you could
                not backspace a `1` to type `30`, which is the commonest edit
                there is. Reported from use. The field holds what was typed; the
                schedule hears only what parses. */}
            <input
              type="text"
              inputMode="numeric"
              className="sched-n"
              value={count}
              onChange={event => {
                const said = event.target.value.replace(/[^0-9]/g, '')
                setCount(said)
                const n = Number(said)
                if (said !== '' && n >= 1) onEvery(`${n}${when.every?.unit ?? 'm'}`)
              }}
              onBlur={() => setCount(String(when.every?.n ?? 1))}
            />
            <select
              className="docket-mode"
              value={when.every?.unit ?? 'm'}
              onChange={event => onEvery(`${when.every?.n ?? 1}${event.target.value}`)}
            >
              {(['d', 'w', 'm', 'y'] as const).map(u => (
                <option key={u} value={u}>{UNIT_WORDS[u]}</option>
              ))}
            </select>
          </label>
          {/* **Only where completion is a thing that happens** — an event is not
              *done*, so this is the recurring TASK's question and D76's whole
              point: one is the calendar's business and the other is yours. */}
          {fromCompletion && (() => {
            // **A clock can only read a TASK step**, since a status step is
            // never done. Offering this on a matter whose steps are all
            // reminders was a control that accepted the click and did nothing —
            // the panel's own version of the affordance faults MH1 kept hitting.
            const clock = matter.steps.find(one => one.kind === 'task' && one.id !== null)
            return (
              <div className="sched-shapes">
                {radio('from', when.after === null, 'counting from that date', () => onAfter(null))}
                {radio(
                  'from',
                  when.after !== null,
                  clock === undefined
                    ? 'counting from when it is done — needs a step to do'
                    : 'counting from when it is done',
                  () => onAfter(clock?.id ?? null),
                  clock === undefined,
                )}
              </div>
            )
          })()}
        </>
      )}

      {repeats && listed && (
        <div className="sched-list">
          {(when.dates ?? []).map(one => (
            <span className="sched-date-chip" key={one}>
              {one}
              <button
                className="docket-quiet"
                title="Take this date off"
                onClick={() => onDates((when.dates ?? []).filter(other => other !== one))}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="date"
            className="sched-date"
            value={adding}
            onChange={event => {
              const said = event.target.value
              setAdding('')
              if (said !== '') onDates([...(when.dates ?? []), said as DateKey])
            }}
          />
        </div>
      )}

      {upcoming.length > 0 && (
        <p className="sched-next">
          <span className="sched-label">Next</span>
          {upcoming.map(one => <span className="sched-peek" key={one}>{one}</span>)}
        </p>
      )}

      <div className="sched-done">
        <button className="docket-quiet" onClick={onClose}>done</button>
      </div>
    </div>
  )
}

const UNIT_WORDS: Record<string, string> = { d: 'days', w: 'weeks', m: 'months', y: 'years' }

function Field1({
  initial,
  placeholder,
  className,
  title,
  onCommit,
  onCancel,
}: {
  initial: string
  placeholder?: string
  /** So the several things this is used for are distinguishable (see below). */
  className?: string
  /** The forms this field accepts, for a surface that has nowhere else to say. */
  title?: string
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
      {...(title === undefined ? {} : { title })}
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
/**
 * Making a matter, which begins by asking **what sort of thing it is**.
 *
 * **Four shapes on two axes** (D76, amended): once against repeatedly, and *you
 * do it* against *it happens to you*. The second axis is the one the first cut
 * could not see, and it is what made a talk and a repair feel unalike while
 * being structurally identical — it decides whether the first step is a task or
 * a reminder.
 *
 * **The shape is spent here and never stored.** It sets the three variables and
 * seeds the first step; afterwards the matter is described entirely by `start`,
 * `every` and `after`, so a job that later gets a date is not mislabelled as an
 * event — there is no label to be wrong.
 */
function NewMatter({
  onCommit,
  onCancel,
}: {
  onCommit: (name: string, shape: NewMatterShape) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<NewMatterShape['mode']>('task')
  const [start, setStart] = useState('')
  const [every, setEvery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const shape = shapeOf(mode)
  const done = (): void => {
    if (name.trim() === '') return
    onCommit(name, {
      mode,
      ...(start.trim() === '' ? {} : { start }),
      ...(shape.repeating && every.trim() !== '' ? { every } : {}),
    })
  }
  const keys = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      done()
    } else if (e.key === 'Escape') onCancel()
  }
  return (
    <div className="docket-new">
      <input
        ref={input}
        className="docket-field wide"
        value={name}
        placeholder="what it is"
        spellCheck={false}
        onChange={e => setName(e.currentTarget.value)}
        onKeyDown={keys}
      />
      <select
        className="docket-shape"
        value={mode}
        onChange={e => setMode(e.currentTarget.value as NewMatterShape['mode'])}
        title="What sort of thing this is"
      >
        {MODES.map(one => (
          <option key={one.key} value={one.key}>{one.title}</option>
        ))}
      </select>
      {/* **Only the questions this shape actually has.** An undated thing is
          not asked for a date, and a thing that happens once is not asked how
          often — which is the whole reason the picker comes first. */}
      <input
        className="docket-field narrow"
        value={start}
        placeholder="when"
        spellCheck={false}
        onChange={e => setStart(e.currentTarget.value)}
        onKeyDown={keys}
      />
      {shape.repeating && (
        <input
          className="docket-field narrow"
          value={every}
          placeholder="how often"
          title="90d · 6 months · 1y · 1m on 31"
          spellCheck={false}
          onChange={e => setEvery(e.currentTarget.value)}
          onKeyDown={keys}
        />
      )}
      <button className="docket-quiet" onClick={done}>add</button>
      <button className="docket-quiet" onClick={onCancel}>cancel</button>
    </div>
  )
}
