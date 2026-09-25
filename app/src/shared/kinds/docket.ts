// The matter grammar (MH1, D68, D72).
//
// **A docket is a flat sequence of blocks, and that is the whole format
// decision.** `goal/horizon.md` left it open with one discriminator named:
// **whitespace-significance.** Merges here are line-based and hand-editing has
// to degrade gracefully, so a format in which one bad indent restructures the
// document is worse than one whose records are independent blocks. That rules
// out nested YAML and argues for a block per matter — which is what this is.
//
// ```markdown
// ## The oven is broken
// when: —
// tags: #house #repair
// owner: me
// <!--tephra:matter 7f3a1b2c 1757462400 0-->
//
// ## Change the air filters
// when: every 90d from 2026-10-01
// steps:
// - +0d task: Change the air filters #house <!--tephra:step 4c8e11a2-->
// - after 4c8e11a2 +90d reschedule: the next one <!--tephra:step 91bb3d70-->
// <!--tephra:matter aa11bb22 1757462400 0 2026-09-14-->
// ```
//
// **Why headings rather than one line per matter**, which is what the task list
// does. A matter carries **steps**, and a step is *when → what*: a small
// structured list, which is the one thing about a matter that does not fit on a
// line. Everything else here is a field, because fields are what people write
// and need no structure — steps are not prose, and pretending they are is how
// one trip becomes five sibling matters that must be edited together (D72). A
// heading opens a block; a blank line or the next heading closes it; nothing in
// between depends on its indentation.
//
// **And the file is not the shared artifact** (D72). Two people read the docket
// *view*, so legibility here means legible to a person opening the file in
// another editor a decade from now — not legible aloud across a table.
//
// **Lenient in, precise out** (R26, format-spec). A key this does not know is
// kept verbatim and written back untouched, in place. A block with no marker is
// a matter somebody typed by hand, and gets an id the first time Tephra writes.

import { addDays, asDateKey, dateKeyAt, DEFAULT_ZONE } from '../dates.ts'
import { inHorizon, type HorizonKind, type HorizonWindow } from '../horizon-api.ts'
import { readTag, subjectKey, tagMark } from '../tags.ts'
import type { DateKey } from '../document-api.ts'

/** `<!--tephra:matter <id> <arrived> <declines> [<occurrence>]-->`, ending the block. */
const MARK =
  /^\s*<!--tephra:matter\s+([0-9a-z]+)\s+(\d+)\s+(\d+)(?:\s+(\d{4}-\d{2}-\d{2}))?\s*-->\s*$/

/**
 * A matter opens with a heading — **level two or deeper, never level one.**
 *
 * **`#` is the document's own title, and that is a markdown convention rather
 * than a Tephra one**: one `#` per document, `##` for its sections. A docket
 * hand-written in another editor will open with `# The house`, and reading that
 * as a matter called *The house* was the first thing an integration test caught.
 *
 * Levels two through six are all accepted, because a person may type any of
 * those and mean the same thing. Only the title level is reserved.
 */
const HEADING = /^(#{2,6})\s+(.*)$/

/** `key: value`, where the key is a bare word. Anything else is prose. */
const FIELD = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/

/**
 * One `- ` line under `steps:` into a step, or null if it is not one.
 *
 * **The old trigger line is a readable subset**, which is why there is no
 * migration script: `- -2w task: book it` parses as a task step at `T−2w` with
 * no id and nothing done, and gains an id the next time the block is written.
 * `note` reads as `status`, which is what it always meant.
 */
export function parseStep(line: string): Step | null {
  let rest = line.trim()
  let id: string | null = null
  let done: number | null = null
  let made: string | null = null
  const mark = STEP_MARK.exec(rest)
  if (mark !== null) {
    id = mark[1] as string
    // `-` is *not done, but it made something* — the stamp has to hold a place
    // so that what follows it is unambiguous.
    done = mark[2] === undefined || mark[2] === '-' ? null : Number(mark[2])
    made = mark[3] ?? null
    rest = rest.slice(0, mark.index)
  }
  const found = STEP.exec(rest)
  if (found === null) return null
  const kind = KIND_ALIASES[(found[2] as string).toLowerCase()]
  if (kind === undefined) return null
  const text = (found[3] as string).trim()
  if (text === '') return null
  const when = parseStepWhen(found[1] as string)
  if (when === null) return null
  return { id, kind: kind as StepKind, when, text, done, made }
}

/** `-2w`, `2 weeks before`, `right away`, `then`, `then +3d`, `after 3f2a +90d`. */
/**
 * What a reference in a step's schedule is allowed to point at.
 *
 * **A reference has to be resolved against the real list or it is a dangling
 * pointer**, and this is where that was going wrong: `after 1` matched the
 * id pattern, so it parsed happily and stored `1`, which names nothing. Ids
 * cannot be typed by hand anyway — they are eight random characters and the
 * surface never showed them — so what a person types is an **index** or the word
 * **then**, and both are turned into an id here, on the way in.
 *
 * Absent entirely when reading a FILE back, where the reference is already an
 * id and there is no list to hand: that path takes the token verbatim, which is
 * what makes a step block parseable on its own.
 */
export interface StepContext {
  /** What `then` follows. Absent if there is nothing above it. */
  readonly previous?: string
  /** An index or an id as typed, to the step's real id — or null for neither. */
  readonly resolve?: (token: string) => string | null
}

export function parseStepWhen(text: string, context?: StepContext): StepWhen | null {
  const said = text.trim()
  const previous = context?.previous
  // **Nothing said means `T+0`.** It is the commonest step on a docket — the
  // first thing to do when work starts — so it is the default rather than a
  // thing to type, and leaving the field empty is how a person says it.
  if (said === '') return { kind: 'at', offset: '+0d' }
  const then = THEN.exec(said.toLowerCase())
  if (then !== null) {
    // **Nothing before it means nothing to follow.** Refused rather than quietly
    // turned into `T+0`, because *then* is a claim about an order and the first
    // step of a list is not in one.
    if (previous === undefined) return null
    const gap = then[1] === undefined ? null : parseOffset(then[1] as string)
    if (then[1] !== undefined && gap === null) return null
    return {
      kind: 'after',
      step: previous,
      ...(gap === null ? {} : { offset: gap.replace(/^-/, '+') }),
    }
  }
  const depends = DEPENDS.exec(said.toLowerCase())
  if (depends !== null) {
    const token = depends[1] as string
    // **Resolved when there is a list to resolve against**, and taken verbatim
    // when there is not (reading a file back). A token that resolves to nothing
    // is refused rather than stored: a step waiting on a step that does not
    // exist would simply never come due, silently.
    const target = context?.resolve === undefined ? token : context.resolve(token)
    if (target === null) return null
    const said2 = depends[2]
    if (said2 === undefined) return { kind: 'after', step: target }
    const gap = parseOffset(said2)
    if (gap === null) return null
    // **An offset after a dependency is always forward**, because *before the
    // moment another step finished* is a date in the past by construction. A
    // bare `90d` means before everywhere else in this grammar, so it is flipped
    // here rather than refused: the only thing it could have meant is after.
    return { kind: 'after', step: target, offset: gap.replace(/^-/, '+') }
  }
  const at = parseOffset(said)
  return at === null ? null : { kind: 'at', offset: at }
}

/** A step back into its line. The id and the completion stamp ride at the end. */
export function stepLine(step: Step): string {
  const when = step.when.kind === 'at'
    ? step.when.offset
    : `after ${step.when.step}${step.when.offset === undefined ? '' : ` ${step.when.offset}`}`
  const head = `- ${when} ${step.kind}: ${step.text}`
  if (step.id === null) return head
  const marks = [step.id]
  if (step.done !== null || step.made !== null) marks.push(step.done === null ? '-' : String(step.done))
  if (step.made !== null) marks.push(step.made)
  return `${head} <!--tephra:step ${marks.join(' ')}-->`
}

/**
 * A step's schedule in the notation, which is what an edit starts from.
 *
 * **The round-trip form, as against the reading form below** — the same pair a
 * matter's `when` has, and for the same reason: what the surface *shows* is
 * words, and what it hands back to a field has to be something `parseStepWhen`
 * will take.
 */
export function spellStepWhen(
  when: StepWhen,
  indexOf?: (id: string) => number | null,
): string {
  if (when.kind === 'at') return when.offset
  // **The index when there is one to give**, because the id is the thing a
  // person cannot type: prefilling an edit field with `after okc8kiff` hands
  // back the one form the field was built to avoid needing. Without the
  // mapping — reading a file, where the block stands alone — it is the id,
  // which is what the file holds and what the parser takes verbatim.
  const at = indexOf?.(when.step)
  const target = at === null || at === undefined ? when.step : `#${at}`
  return `after ${target}${when.offset === undefined ? '' : ` ${when.offset}`}`
}

/** `+90d` back into the interval it stands for. */
const intervalOf = (offset: string | undefined): Interval | null => {
  if (offset === undefined) return null
  const found = OFFSET.exec(offset)
  if (found === null) return null
  const n = found[2] === undefined ? 1 : Number(found[2])
  return n === 0 ? null : { n, unit: unitOf(found[3] as string) }
}

/** How a step's schedule is said out loud, for the surface. */
export function readStepWhen(step: StepWhen, indexOf?: (id: string) => number | null): string {
  if (step.kind === 'at') return spellOffset(step.offset)
  // **By number, not by name.** Naming the step it waits on read well in
  // isolation and badly in a list: two steps side by side said *after Find
  // electrician* and *after 1*, which look like different kinds of thing, and
  // the long one pushed the column of step text out of line with its
  // neighbours. The number is what the row already shows, and it is one
  // character wide.
  //
  // **`?` when it resolves to nothing**, which is what a dependency on a step
  // that is not there looks like — visible rather than silently never firing.
  const at = indexOf?.(step.step)
  const after = at === null || at === undefined ? '?' : `#${at}`
  return step.offset === undefined
    ? `after ${after}`
    : `${spellOffset(step.offset).replace(/ after$/, '')} after ${after}`
}

/**
 * `- <schedule> <kind>: <text>`, the shape of a step line.
 *
 * **The schedule is captured loosely and parsed after**, because it is the part
 * with two forms — an offset or a dependency — and a regex that tried to hold
 * both would be the least readable thing in this file. The kind is what anchors
 * the line: everything before the kind word is *when*, everything after the
 * colon is *what*.
 *
 * A `- ` line that does not fit is preserved verbatim by the leniency rule
 * rather than lost, which is the right outcome for a format that has a UI (D72).
 */
const STEP = /^-\s*(.+?)\s+([a-z]+)\s*:\s*(.*)$/

/** `<!--tephra:step <id> [<done>]-->`, at the end of a step line (D56's rule). */
const STEP_MARK = /\s*<!--tephra:step\s+([0-9a-z]+)(?:\s+(\d+|-))?(?:\s+([0-9a-z]+))?\s*-->\s*$/

/**
 * `after #1`, `after 1`, `after step 1`, `after 3f2a`, any of them `+ 90d`.
 *
 * **Accept flexibly, produce strictly.** The word `step` and the `+` are both
 * optional on the way in, because they are noise a person may or may not type;
 * what comes back out always has the word and always has the sign, so there is
 * one form to read and several to write.
 */
const DEPENDS = /^after\s+(?:step\s+)?#?([0-9a-z]+)(?:\s*\+?\s*(.+))?$/

/**
 * `then`, optionally `+ 3d` — *after whatever comes before this in the list*.
 *
 * **The word people actually use when writing a chain**, typed top to bottom:
 * find a shop, *then* have the car fixed. It is a shorthand for a dependency and
 * is **normalised on the way in** to `after <id>`, so nothing downstream has to
 * know about it and the file holds one form. An id cannot be typed by hand
 * anyway, which is what made this the missing word rather than a nicety.
 */
const THEN = /^then(?:\s*\+?\s*(.+))?$/

/**
 * The old effect names, kept readable.
 *
 * **`note` was the horizon-awareness effect** and is what `status` now means, so
 * a file written before D76 reads correctly rather than losing its lines. `doc`
 * has no kind yet — the document-template step is out of MH3a — so a `doc` line
 * fails to parse and is preserved verbatim by the leniency rule, which is the
 * honest outcome for something not built.
 */
const KIND_ALIASES: Record<string, StepKind | 'reschedule'> = {
  task: 'task',
  status: 'status',
  note: 'status',
  // **Read so that it can be converted, never kept.** A reschedule used to be a
  // step somebody wrote; it is the matter's own `every` and `after` now, and a
  // file holding the old form is folded into those on the way in (see
  // `parseMatter`). Machinery does not belong in a list of a person's own words.
  reschedule: 'reschedule',
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A unit of time, as a letter or as a word.
 *
 * **WHAT THE APP RENDERS, THE APP PARSES.** `readWhen` spelled a recurrence as
 * *every 90 days* while `parseWhen` accepted only `every 90d` — so the surface
 * taught a notation the parser refused, and the obvious thing to do with a
 * displayed value (retype it, correct it in place) failed. A reading form that
 * cannot be read back is worse than none: it looks like input.
 *
 * The first letter is the canonical unit and the four words have four distinct
 * initials, so recognising one is taking its head.
 */
const UNITS: Record<string, string> = { d: 'day', w: 'week', m: 'month', y: 'year' }

/** `90` and `d` as *90 days*, the shared half of reading an interval back. */
const spellSpan = (n: number, unit: string): string => {
  const word = UNITS[unit] ?? unit
  return `${n} ${n === 1 ? word : `${word}s`}`
}

const UNIT = '(d|w|m|y|days?|weeks?|months?|years?)'
const unitOf = (said: string): Unit => said[0] as Unit

/**
 * A count that may be left out, meaning one.
 *
 * *Every week* is how it is said and *every 1 week* is not English — which is
 * why `readWhen` does not write the second one, and therefore why this has to
 * accept the first.
 */
const COUNT = '(?:(\\d+)\\s*)?'
const FROM = '(?:\\s+from\\s+(\\d{4}-\\d{2}-\\d{2}))?'

/** `every 90d`, `every 90 days`, `every week` — any of them `from 2026-10-01`. */
const EVERY = new RegExp(`^every\\s+${COUNT}${UNIT}${FROM}$`)

const ICS = /^ics:\s*(\S+)$/

/**
 * When a matter happens — or that it does not yet, which is a first-class answer.
 *
 * **`standing` is not an absence of data** (H7b). The broken oven and repainting
 * the house are true about the domain indefinitely; giving one a date is the
 * *point* of the review, so *no date* has to be a state the format can hold
 * rather than a field left blank.
 */
/**
 * How often something comes round.
 *
 * **`day` exists only to stop a monthly thing drifting.** A schedule keeps its
 * *next* instance rather than a fixed anchor (see `Schedule.start`), which is
 * far easier to reason about — nobody should have to compute forward from a date
 * years ago — but rolling one date to the next loses the day somebody chose the
 * moment it has to be clamped: 31 January rolls to 28 February, and rolling
 * again from *that* gives 28 March, for ever. So the intended day is carried
 * when it differs from the stored one, which happens only for months and years
 * anchored on the 29th, 30th or 31st.
 */
export interface Interval {
  readonly n: number
  readonly unit: Unit
  /** The day of the month meant, when a clamp has hidden it. */
  readonly day?: number
}

/**
 * When a matter happens, in three variables and nothing else.
 *
 * **The four modes fall out of these rather than being stored** (D76, amended):
 *
 * | start | every | after | what it is |
 * |---|---|---|---|
 * | — | — | — | something to get done |
 * | ✓ | — | — | something happening |
 * | ✓ | ✓ | — | something that comes round |
 * | ✓ | ✓ | step | something to keep up with |
 *
 * **`start` is a known instance, kept as the NEXT one** — advanced by us as
 * instances pass, rather than left as a first instance somebody then has to
 * count forward from. It is also the whole of *active*: no start means `T±N` is
 * not computable, so nothing generates, whatever the rest says. Suspending
 * clears it and leaves the shape, which is why a matter with an interval and no
 * start is a perfectly good paused thing rather than a contradiction.
 *
 * **`after` says *recur from completion*, and says which step's** — one field
 * doing both, which is what Qa demanded: the clock-advancing step is authored
 * rather than inferred from the order things happen to be in. With it set the
 * matter reschedules when that step is done; without it, the calendar decides
 * and the interval runs from `start` regardless of what anybody did.
 *
 * **The reschedule is implicit.** It used to be a step somebody wrote, which put
 * machinery in a list otherwise made of a person's own words; it is derived from
 * these fields now, and steps are only tasks and reminders again.
 */
export interface Schedule {
  readonly start: DateKey | null
  readonly every: Interval | null
  /** The step whose completion starts the next instance, if any. */
  readonly after: string | null
  /**
   * The instances, listed outright — the alternative to an interval.
   *
   * **H7 asked for this from the start and D76 withdrew it** for want of
   * evidence. The evidence arrived: a game whose next few sessions are agreed in
   * a chat thread is neither one date nor a rule, and an interval would be a lie
   * about it while a matter per session loses the identity recurrence exists to
   * keep (H7a).
   *
   * **An alternative to `every`, not a companion.** Both answer *when does it
   * come round*, and a matter holding both would have two answers; the editor
   * offers them as a choice and this is never set beside one.
   *
   * `start` still means *the instance this is on now*, so everything downstream
   * is unchanged — `dueOn` measures from it, the horizon sweeps from it. What
   * changes is only where the next one comes from: read, rather than computed.
   *
   * **Kept in order and including the past.** A session that has happened is
   * still a fact about the campaign, and dropping it as it passes would make the
   * list mean something different every week.
   */
  readonly dates: readonly DateKey[] | null
  /**
   * The last day of an instance that LASTS — a trip, a conference, a festival.
   *
   * **Not the range D76 withdrew, and the difference is the whole argument.**
   * That one was a fuzzy *schedule* — `2026-11-12..2026-11-20` meaning *somewhere
   * in here* — offered for "a major project spread over months", and the answer
   * to that case is still steps. This is an event's **extent**: a thing with one
   * date that occupies several days, where *how long does it last* is a fact
   * about the event and not a guess about when work will happen.
   *
   * **The evidence is a notebook writing it into titles.** Seven of ten matters
   * on a real events docket said it in their names — *Santa Monica 9-17 → 9-22*,
   * *Parents in TLV 10-13 → 11-17* — which is the same shape as every other
   * field this format has gained: a person encoding structure in prose because
   * there was nowhere to put it (D85, D80).
   *
   * **Inclusive, and the last day counts.** *9-18 → 9-20* is a three-day
   * conference and is still on, on the 20th. What ends it is the day after.
   *
   * **An absolute date rather than a duration**, because a person types the end
   * and the file should say what they typed. The cost is that a recurring event
   * has two dates to move at once, which `advance` does — it already moves
   * `start` and `occurrence` together, and this rides with them.
   *
   * Null for everything without an extent, which is most matters.
   */
  readonly until: DateKey | null
  /**
   * Where the series began, for a recurrence that has a first instance (D96).
   *
   * **`start` is the NEXT instance and is advanced as instances pass** (D76),
   * which is right for *change the air filters* and destroys the one fact a
   * birthday is for. Reported from use: a wife's date of birth typed into a
   * recurring event *kept bouncing back to being this year* — correctly, by the
   * rule, and uselessly, because *whose ages I don't remember* is the whole
   * reason to write it down.
   *
   * So the origin is kept beside the next instance rather than instead of it.
   * Nothing advances this, ever; it is the only date on a recurrence that does
   * not move. What it buys is the count: this year's instance is the forty-first
   * since 1985, which is what somebody wants from a birthday and cannot be got
   * from *next March*.
   *
   * Null for every recurrence nobody has said that about, which is most.
   */
  readonly since: DateKey | null
}

/** A matter nobody has dated: on the list, generating nothing. */
export const UNSCHEDULED: Schedule = {
  start: null, every: null, after: null, dates: null, until: null, since: null,
}

/**
 * The last day an instance occupies — its end, or its date when it has no
 * extent.
 *
 * **One function, because *when is this over* is asked from four places** — the
 * horizon's sweep, the status step's completion, finishing, and the reading
 * form — and each of them answering it locally is how a rule about dates comes
 * to be true in three places and false in the fourth.
 *
 * **A start that outlives its end is a typo, and is read as no extent.** An
 * event cannot finish before it begins; taking the field at its word would put
 * a matter permanently in the past, and dropping the line would lose what
 * somebody typed. It is kept in the file and ignored here.
 */
export function endOf(when: Schedule, instance?: DateKey): DateKey | null {
  const start = instance ?? when.start
  if (start === null) return null
  if (when.until === null || when.until <= start) return start
  return when.until
}

/**
 * What kind of thing a matter is, as a person thinks of it.
 *
 * **Persisted, and primary** — which reverses an earlier draft of this decision.
 * That one derived the mode from the three variables so that nothing could be
 * mislabelled, and the price was exposing the machinery: the surface showed an
 * interval and a radio group and left somebody to work out that those two
 * together meant *this comes round after I do it*. Reported from use in those
 * terms, and the objection is right.
 *
 * **Two things make storing it sound now.** The mode **governs** the variables
 * rather than describing them — they are only reachable through the affordances
 * it puts up, so it cannot come to contradict them. And there is a distinction
 * it alone can hold: `(start, —, —)` is both a one-off task and a one-off event,
 * and which one decides whether work is a **task** or a **reminder** — the *you
 * do it* against *it happens to you* axis, with nowhere else to live once the
 * first step exists.
 */
export type Mode = 'task' | 'recurring-task' | 'event' | 'recurring-event'

export interface ModeShape {
  readonly key: Mode
  readonly title: string
  /** What its first step is, and what a step of its defaults to. */
  readonly kind: StepKind
  /** Whether it asks how often. */
  readonly repeating: boolean
  /** Whether its recurrence is measured from a step being done. */
  readonly fromCompletion: boolean
}

export const MODES: readonly ModeShape[] = [
  { key: 'task', title: 'One-off task', kind: 'task', repeating: false, fromCompletion: false },
  {
    key: 'recurring-task',
    title: 'Recurring task',
    kind: 'task',
    repeating: true,
    fromCompletion: true,
  },
  { key: 'event', title: 'One-off event', kind: 'status', repeating: false, fromCompletion: false },
  {
    key: 'recurring-event',
    title: 'Recurring event',
    kind: 'status',
    repeating: true,
    fromCompletion: false,
  },
]

/**
 * Is this one-off matter finished? (D91)
 *
 * **Read from the steps, because the steps are the work.** A `task` is finished
 * when every task step is done; an `event` has to have *happened* as well, or
 * booking the boiler service three weeks early would finish the matter before
 * the boiler was serviced.
 *
 * **`status` steps do not count either way.** They generate nothing and cannot
 * be done, so they neither block a matter nor constitute one — which is why a
 * matter made only of them is never finished rather than always finished, and
 * that asymmetry is deliberate: *nothing to do* is not *done*.
 *
 * **A recurring matter is never finished.** It advances; that is what
 * recurrence means, and a finished recurring matter would be a contradiction
 * the advance clause has to undo on its next pass.
 */
export function isFinished(matter: Matter): boolean {
  if (shapeOf(matter.mode).repeating) return false
  if (matter.steps.length === 0) return false
  return matter.steps.every(step => step.done !== null)
}

/**
 * Can somebody stamp this step done by hand? (D97)
 *
 * **Only a task, because only a task is something anybody does.** A `status`
 * step completes by the calendar and nobody can tick it (D92) — that is what it
 * means for it to be awareness rather than work — so offering the gesture on
 * one would be an affordance that either lies or fights the pass.
 *
 * **And a repeating matter has to be running.** Stamping the clock step of a
 * suspended recurrence writes a `done` that nothing will ever clear: the advance
 * clause needs a `start` to count from, so it declines, and the stamp sits there
 * making the matter look finished while the docket says it is not happening. A
 * one-off with no date is the opposite case and is allowed — *I did the thing I
 * never got round to scheduling* is a true and useful sentence, and finishing it
 * is what files it.
 */
export function canComplete(step: Step, matter: Matter): boolean {
  if (matter.done !== null) return false
  if (step.kind !== 'task' || step.done !== null) return false
  return !(shapeOf(matter.mode).repeating && matter.when.start === null)
}

/**
 * The one task a matter has left to do, when it has exactly one (D97).
 *
 * **What the matter ROW can offer without opening it**, which is the whole point
 * of the question: a chore docket is sixteen matters of one step each, and
 * *I did that today* has to be one gesture from the list. Where more than one
 * task is outstanding the row cannot know which one you mean, so it offers
 * nothing and the steps carry the gesture individually.
 *
 * **Counted over what is LEFT, not over the steps.** A matter of four steps with
 * three of them done has one task outstanding and is as unambiguous as a matter
 * of one — which is also how a run-up ends: the last thing left is the thing you
 * just did.
 */
export function onlyTaskLeft(matter: Matter): Step | null {
  const left = matter.steps.filter(step => canComplete(step, matter))
  return left.length === 1 ? (left[0] as Step) : null
}

/**
 * Is this status step's day behind us? (D92, item 3)
 *
 * **A status step completes by the calendar, because nobody can tick it.** It
 * is awareness with no task (H6) — the conference happening, the holiday
 * arriving — so *done* for one of them can only mean *that day has gone*. Until
 * this existed, a matter made of status steps could never finish, which meant
 * an events docket accumulated for ever: every one of ten real events was a
 * single status step, and not one of them could ever be filed.
 *
 * **Strictly past, and the last day counts.** An event is not over while it is
 * on, and a three-day conference is on, on its third day — so what completes it
 * is the day AFTER its end. This is what makes the extent load-bearing rather
 * than decorative: without `until`, *Santa Monica 9-17 → 9-22* would have read
 * *finished* on the 18th, while somebody was in Santa Monica.
 */
export function statusPassed(step: Step, matter: Matter, on: DateKey, today: DateKey): boolean {
  if (step.kind !== 'status') return false
  return (endOf(matter.when, on) ?? on) < today
}

export const shapeOf = (mode: Mode): ModeShape =>
  MODES.find(one => one.key === mode) ?? (MODES[0] as ModeShape)

/**
 * The mode of a matter written before modes were stored.
 *
 * **Derivation is the fallback, not the rule.** An old block says what its
 * variables are and nothing about how somebody thought of it, so the best that
 * can be done is read the shape — and the one thing that cannot be recovered is
 * task against event, which is why it is guessed from the kind of the first step
 * rather than from the schedule.
 */
export function modeFrom(when: Schedule, steps: readonly Step[]): Mode {
  const doing = steps[0]?.kind !== 'status'
  if (when.every === null) return doing ? 'task' : 'event'
  return when.after !== null || doing ? 'recurring-task' : 'recurring-event'
}

/** What *Add a matter* was asked for: a shape, and the details it needs. */
export interface NewMatter {
  readonly mode: Mode
  /** The next instance, for the three dated shapes. */
  readonly start?: string
  /** How often, for the two repeating ones — as typed. */
  readonly every?: string
  /** The last day, for an event that lasts more than one (D92). */
  readonly until?: string
}

export type Unit = 'd' | 'w' | 'm' | 'y'

/**
 * What a matter *does*, one entry at a time (D76).
 *
 * **This replaced *triggers*, and the rename is the design.** A trigger was an
 * offset before a known date — a run-up — and the first thing real use produced
 * was the opposite: a repair with no date at all, whose steps run *forward* from
 * the moment somebody decides to start. H4 said plainly that the need for a
 * per-matter window was evidenced and the shape was not, and the shape was
 * wrong. One list serves both directions.
 */
/**
 * `2w`, `2 weeks`, `2 weeks before`, `+3 days after` — and `-14d` from the file.
 *
 * **Worded, because the surface reads it back in words** (see `UNIT`): a step
 * row says *2 weeks before*, so that is what a person will type into the field
 * beside it. The trailing word is accepted because it is half of what was just
 * read aloud, and a field that rejects the second half of its own sentence is a
 * puzzle. An explicit sign still wins over it.
 */
const OFFSET = new RegExp(`^([+-]?)${COUNT}${UNIT}(?:\\s+(before|after))?$`)

/**
 * An offset as somebody says it out loud, normalised to what the file holds.
 *
 * **A bare number is BEFORE**, and that is the whole reason this exists. The
 * concept was a *run-up window* (H4) and every example in the requirements was
 * ahead of the date — two weeks before a talk, months before a birthday, days
 * before a filter. Making somebody type a minus sign to get the ordinary case is
 * a tax on the common gesture, and `-` is punctuation nobody says out loud.
 *
 * **`+` is how you get the other one**, because it exists — *file the expenses
 * three days after the trip* — and because D76 made the forward direction the
 * common case for a backlog matter, whose steps all run out from the moment it
 * was started.
 */
export function parseOffset(text: string): string | null {
  const said = text.trim().toLowerCase()
  // **`T+0` is a real schedule and the commonest one**: the first step of a
  // backlog matter is due the moment it is activated. It is read back as *right
  // away*, so — the closed-loop rule — *right away* has to go back in.
  if (said === 'right away' || said === 'now' || said === 't+0' || said === '0') return '+0d'
  const found = OFFSET.exec(said)
  if (found === null) return null
  const n = found[2] === undefined ? 1 : Number(found[2])
  if (n === 0) return `+0${unitOf(found[3] as string)}` // T+0 is a real schedule: *now*
  const sign = found[1] === '' ? (found[4] === 'after' ? '+' : '-') : found[1]
  return `${sign === '+' ? '+' : '-'}${n}${unitOf(found[3] as string)}`
}

/** How long before or after, said the way a person would read it back. */
export function spellOffset(offset: string): string {
  const found = OFFSET.exec(offset)
  if (found === null) return offset
  const n = found[2] === undefined ? 1 : Number(found[2])
  // **`T+0` is *now*, not *0 days after*.** It is the default schedule for a
  // backlog step, so it is the one a person sees most and the one worth saying
  // in words rather than in arithmetic.
  if (n === 0) return 'right away'
  return `${spellSpan(n, found[3] as string)} ${found[1] === '+' ? 'after' : 'before'}`
}

export type StepKind =
  /** Becomes a TODO item. */
  | 'task'
  /** Becomes a horizon row — awareness with nothing to tick off (H6). */
  | 'status'

export const STEP_KINDS: readonly StepKind[] = ['task', 'status']

/** When a step happens. */
export type StepWhen =
  /** `T±N` from the matter's critical date. */
  | { readonly kind: 'at'; readonly offset: string }
  /**
   * After another step is completed, optionally plus an interval.
   *
   * **By id, not by position.** A positional reference would silently repoint
   * itself the moment a step was inserted above it — D56's rule, a level down.
   */
  | { readonly kind: 'after'; readonly step: string; readonly offset?: string }

export interface Step {
  /** Minted on write, like a matter's, so that `after` has something to hold. */
  readonly id: string | null
  readonly kind: StepKind
  readonly when: StepWhen
  readonly text: string
  /**
   * When it was completed, in Unix seconds, or null.
   *
   * **Stamped on the step rather than read off what it generated**, for two
   * reasons that are really one: the generated item can be edited away, and
   * *suspend* withdraws the generated items by definition while having to
   * preserve this answer. **Cleared when a reschedule starts a new instance**,
   * or the second filter change would be born already done.
   */
  readonly done: number | null
  /**
   * The task this step put on the list, for this instance of the matter.
   *
   * **Provenance lives here rather than in the generated item**, which keeps the
   * task list's format — the oldest and most used in this app — untouched. It
   * buys three things at once: **idempotence**, since a step that has made
   * something does not make it again; **withdrawal**, since suspending has to
   * find what it made; and **completion flowing back**, since finishing that
   * item has to find the step it came from.
   *
   * **Cleared when a new instance starts**, with `done` — the next filter
   * change is a fresh piece of work, not the last one again.
   */
  readonly made: string | null
}

export interface Matter {
  readonly id: string | null
  readonly name: string
  readonly when: Schedule
  /**
   * Which of the four kinds of thing this is, as a person thinks of it.
   *
   * **Stored, because it governs rather than describes** — see `Mode`. Absent
   * in a block written before modes existed, and read back from the shape then.
   */
  readonly mode: Mode
  /**
   * The day this finished, for a one-off that has (D91).
   *
   * **Written by the pass and cleared by it**, from the steps: a `task` whose
   * task steps are all done is done, and an `event` also has to have happened.
   * Null for anything recurring, which never finishes — it advances, and that
   * is what recurrence means.
   *
   * **A field rather than a fifth slot in the marker.** The archive is read by
   * a person and *when was this finished* is the first thing they want from it;
   * a date behind a machine marker is a date nobody reads.
   */
  readonly done: DateKey | null
  readonly tags: readonly string[]
  readonly owner: string | null
  /** A relative markdown link to one document (H14). */
  readonly link: string | null
  readonly steps: readonly Step[]
  /**
   * Prose written under a matter — what the plumber said, the quote, the plan.
   *
   * **Nothing in them is parsed**, which is the task list's rule for the same
   * thing (D56 as amended): no tags, no dates, no nested matters. A note is
   * somewhere to put the sentence you would otherwise keep in your head, and a
   * line that starts being interpreted is a line you have to be careful in.
   *
   * **Bare prose lines, and that is the whole encoding.** A block's lines are
   * either a known field, a trigger, or this — so a note needs no key and looks
   * like what it is to somebody reading the file. A note that happens to read
   * as `key: value` is classified as an unknown field instead and round-trips
   * there; no text is lost either way.
   */
  readonly notes: readonly string[]
  /**
   * The four that cannot be added later (`solution/parts/horizon.md`).
   *
   * `arrived` dates the matter's appearance on *this* docket — a move is a
   * delete plus an append and records no date of its own, so without this the
   * resurrection rate is unreconstructible. `declines` is what the graveyard
   * will threshold on, and it must accrue from the first review. `occurrence`
   * is the outstanding one, and it is both the idempotence key and the channel
   * completion travels back along.
   */
  readonly arrived: number
  readonly declines: number
  /**
   * The task this matter was moved from, if it was moved from one (MH5).
   *
   * **A record, and nothing depends on it.** It was briefly load-bearing: while
   * a move could be half-undone, the reconciler used this to notice and repair
   * the damage, with a rule about provenance surviving only until the matter was
   * touched. Writing the move as a `transfer` — a change of ownership, which
   * undo has no business reaching — removed the damage and with it all of that.
   *
   * What it is good for now is saying where something came from, which is worth
   * keeping and worth nothing more.
   */
  readonly from: string | null
  readonly occurrence: DateKey | null
  /** Keys this grammar does not know, kept in order and written back verbatim. */
  readonly extra: readonly string[]
}

export interface ScannedMatter {
  readonly matter: Matter
  /** The heading line's start, into the body. */
  readonly from: number
  /** The end of the block, excluding its final newline. What a verb rewrites. */
  readonly to: number
  /** The whole block including the newline that ends it. */
  readonly end: number
  /**
   * How many hashes its heading has.
   *
   * **Preserved rather than imposed, because a verb must not reshape the file.**
   * A matter under a section is written a level deeper so the outline is true
   * markdown, and one on a docket with no sections stays at the top level — so
   * rewriting a block has to put back the depth it found.
   */
  readonly level: number
}

/** A section heading: a name, and the matters that follow it. */
export interface ScannedSection {
  readonly name: string
  readonly from: number
  readonly to: number
  readonly end: number
  readonly level: number
}

/**
 * One heading's block, read as whichever of the two things it is.
 *
 * **What separates them is CONTENT, not depth.** A heading with nothing under it
 * is a section; a heading with anything under it — a field, a run-up list, a
 * note, a marker — is a matter. Depth would have been the obvious rule and it is
 * the wrong one: dockets written before sections existed have their matters at
 * `##`, and a rule that read those as empty sections would silently swallow a
 * house. Content cannot be wrong that way, because `matterBlock` always writes
 * `when:` — every matter this app has ever written has a line under its heading.
 *
 * The cost is stated plainly: **a section cannot carry a description**, since
 * prose under a heading is what a note looks like. Sections are for grouping,
 * which is what they were asked for.
 */
export type ScannedBlock =
  | ({ readonly kind: 'matter' } & ScannedMatter)
  | ({ readonly kind: 'section' } & ScannedSection)

/** A section with its matters gathered, which is what the surface draws. */
export interface Section {
  /**
   * Its heading, or `''` for the run of matters above the first heading.
   *
   * **The unnamed run is not a section and is not created**: it is where matters
   * live on a docket that has never been divided, and where they land if a
   * section heading is deleted from under them. Nothing is lost by not having
   * sections, which is the property that lets them be optional.
   */
  readonly name: string
  readonly matters: readonly Matter[]
}

/** The old name for an unscheduled matter, kept so callers read either way. */
export const STANDING: Schedule = UNSCHEDULED

/** What a person writes for *no date yet*, and what this writes back. */
export const NO_DATE = '—'

/**
 * What an undated TASK says, as against an undated event.
 *
 * *No date yet* is true of both and useful about neither: for a task the fact is
 * that nobody has begun, which is what the **activate** button beside it offers
 * to change. The two words have to agree or the row is describing one thing and
 * the control beside it another.
 */
export const NOT_STARTED = 'not started'

/**
 * A date that is a real one, or null.
 *
 * **Shape is not validity, and every form here got that wrong at first.** The
 * patterns matched `\d{4}-\d{2}-\d{2}`, so a matter could be scheduled for the
 * thirtieth of February or the thirteenth month — stored, displayed, and
 * impossible. `asDateKey` is what the query notation already validates with, and
 * the reason is the same: a date somebody mistyped should be said out loud, not
 * filed.
 */
const real = (text: string): DateKey | null => asDateKey(text)

/**
 * A matter's schedule, from what somebody typed.
 *
 * **Three forms and nothing else** (D76): nothing at all, a fixed date, or an
 * interval from an anchor. Ranges and seasons were here and were withdrawn — a
 * project that spreads over months is a matter with spread-out **steps**, not a
 * matter with a fuzzy date — and *N after done* became a reschedule step, since
 * it was the only form whose meaning depended on an event rather than a
 * calendar.
 */
/** `90d`, `90 days`, `1m on 31` — an interval, with the day it means. */
/**
 * The interval field's grammar.
 *
 * **`every` is optional and allowed**, because the field renders what it parses:
 * the column says *every 5 years*, so *every 5 years* is what somebody types
 * back into it — and being told that is not an interval *like 90d, 6 months, or
 * 1m on 31* is being corrected for agreeing with the app. Reported from use, and
 * the second time this exact asymmetry has appeared: the first was `every 90d`
 * accepted while `every 90 days` was not.
 *
 * **Accept flexibly, produce strictly** — the stored form is still the short one.
 */
const EVERY_FIELD = new RegExp(`^(?:every\\s+)?${COUNT}${UNIT}(?:\\s+on\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?$`)

/** The `every:` field: how often, and which day of the month it means. */
export function parseInterval(text: string): Interval | null {
  const found = EVERY_FIELD.exec(text.trim().toLowerCase())
  if (found === null) return null
  const n = found[1] === undefined ? 1 : Number(found[1])
  if (n === 0) return null // *every no days* is not a schedule
  const unit = unitOf(found[2] as string)
  const day = found[3] === undefined ? undefined : Number(found[3])
  if (day !== undefined && (day < 1 || day > 31)) return null
  // The carried day only means anything where a month can be short of it.
  if (day !== undefined && unit !== 'm' && unit !== 'y') return null
  return { n, unit, ...(day === undefined ? {} : { day }) }
}

export function spellInterval(every: Interval): string {
  return `${every.n}${every.unit}${every.day === undefined ? '' : ` on ${every.day}`}`
}

/** How often, said the way it is read back: *every 90 days*. */
export function readInterval(every: Interval): string {
  const span = every.n === 1 ? UNITS[every.unit] ?? every.unit : spellSpan(every.n, every.unit)
  return `every ${span}${every.day === undefined ? '' : ` on the ${every.day}${ordinal(every.day)}`}`
}

const ordinal = (n: number): string => {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th'
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
}

/**
 * The whole schedule, said out loud for the date column.
 *
 * **Four shapes, four sentences**, because the column is what tells two people
 * which of the four kinds of thing they are looking at — and it is the only
 * place that says so, now that nothing stores a mode.
 */
export function readSchedule(when: Schedule, mode?: Mode, today?: DateKey): string {
  /**
   * **`start` means two different things, and the column only ever said one.**
   * For an event it is *the day this happens*; for a task it is *the day work
   * began*, which is what activating writes. Reading both as a bare date made
   * every task sound like an appointment — reported from use, and it is the
   * deeper half of a distinction that looked cosmetic when the modes were named.
   *
   * The tense follows the date, because a task dated ahead has not started yet
   * and saying it has would be a small lie the row repeats every day until then.
   */
  const doing = mode !== undefined && shapeOf(mode).kind === 'task'
  /**
   * **An extent reads as the range somebody typed** (D92): *2026-09-18 → 2026-
   * 09-20*, which is what seven matters on a real docket had written into their
   * own names with that very arrow. The field took the arrow out of the title
   * and the reading form puts it back in the column, where it belongs.
   */
  const spanned = (day: DateKey): string => {
    const ends = endOf({ ...when, start: day })
    return ends === null || ends <= day ? day : `${day} → ${ends}`
  }
  const began = (day: DateKey): string =>
    !doing ? spanned(day)
      : today !== undefined && day > today ? `starting ${day}`
        : `started ${day}`

  // **A list reads as its next date and a count**, because the column is one
  // line and eight of them would bury the matter they belong to. The whole list
  // is a click away, in the editor that owns it.
  if (when.dates !== null) {
    const now = when.start
    if (now === null) return `${when.dates.length} dates, all past`
    const left = when.dates.filter(one => one > now).length
    return left === 0 ? `${now}, the last` : `${now}, ${left} more`
  }
  if (when.every === null) return when.start === null ? (doing ? NOT_STARTED : NO_DATE) : began(when.start)
  const how = readInterval(when.every)
  if (when.start === null) return `${how}, not started`
  // **Said as *after it is done* rather than as a date**, because that is what
  // the difference between the two recurring shapes actually is: one is the
  // calendar's business and the other is yours.
  if (when.after !== null) return `${how} after it is done`
  // **The origin, and how many this one is** (D96). A recurrence with a first
  // instance can say which instance is coming, and for the case that asked for
  // it — a birthday — that number is the answer somebody wanted: *the 41st*,
  // rather than the date of birth they would have to subtract from.
  //
  // **Counted in whole intervals**, so it is right for the yearly case and
  // honest for the rest: five instances of *every 90 days* is five.
  if (when.since !== null && when.every !== null) {
    const which = instancesSince(when.since, when.start, when.every)
    // **No count on the first one**, which is the origin itself: *the 0th since*
    // is not a sentence, and *since* alone says everything there is to say.
    return which === null || which === 0
      ? `${how} since ${when.since}`
      : `${how}, the ${which}${ordinal(which)} since ${when.since}`
  }
  return doing ? `${how}, ${began(when.start)}` : `${how} from ${when.start}`
}

/**
 * How many intervals have ELAPSED between the origin and this instance.
 *
 * **Elapsed, not the ordinal of the occurrence** — which is an off-by-one
 * somebody caught within the hour: born in 1982, the 2026 birthday is the
 * *forty-fourth*, and counting the birth as the first occurrence made it the
 * forty-fifth. The word in the sentence decides it: *the Nth **since** 1982*
 * means N of them have gone by, and the day itself is not one of them. A
 * wedding in 1982 has its forty-fourth anniversary in 2026 by the same
 * arithmetic.
 *
 * (A series of meetings would be counted the other way — the forty-fifth
 * meeting — and would want the other word. This says *since*.)
 *
 * **Whole intervals only, and null when they do not divide.** A date somebody
 * typed as an origin need not sit on the series — *every 90 days* from a
 * Tuesday in March lands between two instances — and a count that rounded
 * would be a number the file does not support. Null then, and the reading form
 * says only *since*.
 */
function instancesSince(since: DateKey, start: DateKey, every: Interval): number | null {
  let at = since
  for (let n = 0; n <= 500; n += 1) {
    if (at === start) return n
    if (compareKeys(at, start) > 0) return null
    at = addInterval(at, every).date
  }
  return null
}


/**
 * An old `when:` line into the three variables.
 *
 * **Read, never written** — this is how a docket from before the split opens
 * without anybody migrating it, the same bargain the trigger line got. A form
 * that was withdrawn (a range, a season, `N after done`) is not understood here
 * either, and is kept verbatim by the leniency rule so it can be corrected.
 */
export function parseLegacyWhen(text: string): Schedule | null {
  const said = text.trim()
  if (said === '' || said === NO_DATE || said === '-' || said.toLowerCase() === 'standing') {
    return UNSCHEDULED
  }
  if (DAY.test(said)) {
    const day = real(said)
    return day === null ? null : { start: day, every: null, after: null, dates: null, until: null, since: null }
  }
  const every = EVERY.exec(said.toLowerCase())
  if (every !== null) {
    const from = every[3] === undefined ? null : real(every[3] as string)
    if (every[3] !== undefined && from === null) return null
    const n = every[1] === undefined ? 1 : Number(every[1])
    if (n === 0) return null
    return { start: from, every: { n, unit: unitOf(every[2] as string) }, after: null, dates: null, until: null, since: null }
  }
  return null
}

/**
 * One block into a matter.
 *
 * **Field order is not preserved and does not need to be**, because the block is
 * rewritten whole by a known template — unlike a task's line, which is spliced.
 * What *is* preserved is every key this grammar does not know (`extra`), in the
 * order it was written, so a person's own annotations survive a round trip.
 */
export function parseMatter(block: string): Matter | null {
  const lines = block.split('\n')
  const head = HEADING.exec(lines[0] ?? '')
  if (head === null) return null
  const name = (head[2] as string).trim()
  if (name === '') return null

  let when: Schedule = UNSCHEDULED
  let owner: string | null = null
  let link: string | null = null
  let from: string | null = null
  let id: string | null = null
  let arrived = 0
  let declines = 0
  let occurrence: DateKey | null = null
  let done: DateKey | null = null
  let said: Mode | null = null
  const tags: string[] = []
  const steps: Step[] = []
  const notes: string[] = []
  const extra: string[] = []
  let inSteps = false

  for (const line of lines.slice(1)) {
    const mark = MARK.exec(line)
    if (mark !== null) {
      id = mark[1] as string
      arrived = Number(mark[2])
      declines = Number(mark[3])
      occurrence = mark[4] === undefined ? null : (mark[4] as DateKey)
      continue
    }
    if (inSteps) {
      const step = parseStep(line)
      if (step !== null) {
        steps.push(step)
        continue
      }
      // A `- ` line this cannot read is kept rather than dropped: it is
      // somebody's, and losing it is the one thing lenient parsing must not do.
      // A `doc:` step lands here until the document-template kind is built.
      if (line.trim().startsWith('-')) {
        extra.push(line)
        continue
      }
      inSteps = false
    }
    const field = FIELD.exec(line)
    if (field === null) {
      // Not a field and not a trigger: it is prose, which is a note.
      if (line.trim() !== '') notes.push(line.trim())
      continue
    }
    const key = (field[1] as string).toLowerCase()
    const value = (field[2] as string).trim()
    if (key === 'start') {
      // **`—` is how *no date* is written**, and it is what this writes itself,
      // so reading it back as unreadable put the field into `extra` on every
      // round trip of an undated matter.
      const said = value.trim()
      if (said === '' || said === NO_DATE || said === '-') when = { ...when, start: null }
      else {
        const day = real(said)
        if (day === null) extra.push(line)
        else when = { ...when, start: day }
      }
    } else if (key === 'every') {
      const every = parseInterval(value)
      if (every === null) extra.push(line)
      else when = { ...when, every }
    } else if (key === 'dates') {
      // **Kept verbatim if any of them is unreadable**, by the leniency rule: a
      // list with one bad date in it is somebody's typo, and rewriting the line
      // without it would silently drop a session.
      const said = value.split(/[,\s]+/).map(one => one.trim()).filter(one => one !== '')
      const days = said.map(one => asDateKey(one))
      if (said.length === 0 || days.some(one => one === null)) extra.push(line)
      else when = { ...when, dates: days as DateKey[] }
    } else if (key === 'after') {
      const said = value.trim()
      if (said === '') extra.push(line)
      else when = { ...when, after: said }
    } else if (key === 'when') {
      // **The old one-line form, read and never written** — which is how a
      // docket written before the split opens without anybody migrating it. A
      // form that was withdrawn is not understood here either, and is kept
      // verbatim below so it can be corrected rather than lost.
      const said = parseLegacyWhen(value)
      if (said === null) {
        // **A `when` this cannot read is KEPT, not quietly dropped.** It used to
        // fall back to *no date yet* and lose the text on the next write of the
        // block, which is the one thing the leniency rule exists to prevent —
        // and it is a live path rather than a hypothetical: a form removed from
        // the grammar (D76 withdrew ranges and seasons) turns every file that
        // used it into exactly this case. The matter still reads as undated,
        // because it is; the words survive to be corrected.
        extra.push(line)
      } else {
        when = said
      }
    } else if (key === 'mode') {
      const want = value.trim().toLowerCase()
      if (MODES.some(one => one.key === want)) said = want as Mode
      else extra.push(line)
    } else if (key === 'steps' || key === 'triggers') {
      // **Both keys read, one written.** `triggers:` is what MH1 wrote, and a
      // file is not worth migrating when the new reader can simply understand
      // the old word.
      inSteps = true
      if (value !== '') extra.push(line)
    } else if (key === 'since') {
      const said = value.trim()
      if (said === '') when = { ...when, since: null }
      else if (DAY.test(said)) when = { ...when, since: said as DateKey }
      else extra.push(line)
    } else if (key === 'until') {
      // **A date or nothing**, and the leniency rule for the rest: an
      // unreadable end is somebody's note and is kept as an unknown key.
      const said = value.trim()
      if (said === '') when = { ...when, until: null }
      else if (DAY.test(said)) when = { ...when, until: said as DateKey }
      else extra.push(line)
    } else if (key === 'done') {
      // **A date or nothing**, and an unreadable one is kept as an unknown key
      // rather than dropped: `done: soon` is somebody's note to themselves, and
      // this grammar's leniency rule is that what it cannot read, it keeps.
      const said = value.trim()
      if (said === '') done = null
      else if (DAY.test(said)) done = said as DateKey
      else extra.push(line)
    } else if (key === 'owner') {
      owner = value === '' ? null : value
    } else if (key === 'link') {
      link = value === '' ? null : value
    } else if (key === 'from') {
      from = value.trim() === '' ? null : value.trim()
    } else if (key === 'tags') {
      const found = tagMark()
      found.lastIndex = 0
      for (let t = found.exec(value); t !== null; t = found.exec(value)) {
        const subject = subjectKey(readTag(t).trim())
        if (subject !== '' && !tags.includes(subject)) tags.push(subject)
      }
    } else {
      extra.push(line)
    }
  }

  // **A reschedule step becomes the matter's own recurrence**, which is where
  // it now lives: the interval is its offset and the clock-advancing step is
  // what it was waiting on. Done here rather than in a migration script for the
  // same reason the trigger line was — a reader that understands the old form
  // costs less than a pass over everybody's files, and cannot half-finish.
  const folded = steps.filter(one => (one as { kind: string }).kind !== 'reschedule')
  const machinery = steps.find(one => (one as { kind: string }).kind === 'reschedule')
  const recurrence: Schedule = machinery === undefined || machinery.when.kind !== 'after'
    ? when
    : {
        ...when,
        after: machinery.when.step,
        every: when.every ?? intervalOf(machinery.when.offset),
      }

  return {
    id,
    name,
    when: recurrence,
    // **Read back from the shape when the block does not say.** Which is every
    // block written before modes were stored, and is the one place derivation
    // still happens — a best guess about how somebody thought of it, rather
    // than the rule (see `Mode`).
    mode: said ?? modeFrom(recurrence, folded),
    done,
    tags,
    owner,
    link,
    steps: folded,
    notes,
    arrived,
    declines,
    from,
    occurrence,
    extra,
  }
}

/**
 * How deep a matter's heading is by default.
 *
 * **Top level when nothing divides the docket, one deeper inside a section** —
 * so the file's outline says what the surface shows, and reads correctly in any
 * other markdown tool. Callers pass the depth; this is the undivided case.
 */
export const MATTER_LEVEL = 2
export const SECTION_LEVEL = 2

/**
 * A matter back into a block.
 *
 * **Only what is there is written.** An empty `owner:` line is noise in a file a
 * person reads, and a field that appears only when it has a value is what keeps
 * a hand-written docket looking hand-written.
 */
export function matterBlock(matter: Matter, level = MATTER_LEVEL): string {
  const lines = [`${'#'.repeat(Math.max(2, Math.min(6, level)))} ${matter.name}`]
  // **Three fields rather than one compound string.** `every 90d after 4c8e11a2
  // from 2026-10-01` was becoming a sentence nobody could scan, and these are
  // three independent variables — so the file says so, and the notation becomes
  // purely a thing the surface prints and reads.
  // **The mode leads, because it is what the rest is in service of** — a person
  // reading the file sees what kind of thing this is before its parameters.
  lines.push(`mode: ${matter.mode}`)
  lines.push(`start: ${matter.when.start ?? NO_DATE}`)
  // **Immediately after the start it belongs to**, because the pair is one fact
  // and a reader's eye should not have to hunt for the second half of a date.
  if (matter.when.until !== null) lines.push(`until: ${matter.when.until}`)
  if (matter.when.every !== null) lines.push(`every: ${spellInterval(matter.when.every)}`)
  // **One line, comma-separated**, because a docket is read by people and eight
  // sessions down eight lines would bury the matter they belong to.
  if (matter.when.dates !== null) lines.push(`dates: ${matter.when.dates.join(', ')}`)
  if (matter.when.after !== null) lines.push(`after: ${matter.when.after}`)
  // **With the recurrence it is the origin of**, which is what it is about —
  // not with `start`, which it is deliberately not (D96).
  if (matter.when.since !== null) lines.push(`since: ${matter.when.since}`)
  // **After the schedule and before everything else**, because on an archived
  // matter this is the fact somebody is looking for (D91).
  if (matter.done !== null) lines.push(`done: ${matter.done}`)
  if (matter.tags.length > 0) lines.push(`tags: ${matter.tags.map(spellTag).join(' ')}`)
  if (matter.owner !== null) lines.push(`owner: ${matter.owner}`)
  if (matter.link !== null) lines.push(`link: ${matter.link}`)
  // **Where it came from**, so an undo of the move can be noticed (MH5).
  if (matter.from !== null) lines.push(`from: ${matter.from}`)
  if (matter.steps.length > 0) {
    lines.push('steps:')
    for (const step of matter.steps) lines.push(stepLine(step))
  }
  // **After the fields and before the marker**, which is where a reader expects
  // prose: the machinery brackets it rather than interrupting it.
  lines.push(...matter.notes)
  lines.push(...matter.extra)
  if (matter.id !== null) {
    const parts = [matter.id, String(matter.arrived), String(matter.declines)]
    if (matter.occurrence !== null) parts.push(matter.occurrence)
    lines.push(`<!--tephra:matter ${parts.join(' ')}-->`)
  }
  return lines.join('\n')
}

/** A tag back into whichever of the two spellings fits it (T16, shared). */
const spellTag = (tag: string): string => (/^[A-Za-z0-9][\w-]*$/.test(tag) ? `#${tag}` : `#'${tag}'`)

/**
 * Every matter in a docket's body, with where each block sits.
 *
 * **A block runs from its heading to the line before the next one**, and trailing
 * blank lines belong to neither — which is what lets a verb rewrite one matter
 * without disturbing the spacing a person chose around it.
 */
export function scanBlocks(body: string): readonly ScannedBlock[] {
  const out: ScannedBlock[] = []
  const lines = body.split('\n')
  const starts: number[] = []
  let at = 0
  const offsets: number[] = []
  for (const line of lines) {
    offsets.push(at)
    at += line.length + 1
  }
  lines.forEach((line, n) => {
    if (HEADING.test(line)) starts.push(n)
  })
  starts.forEach((start, which) => {
    const nextStart = starts[which + 1] ?? lines.length
    // Back off the blank lines between this block and the next heading.
    let last = nextStart - 1
    while (last > start && (lines[last] ?? '').trim() === '') last -= 1
    const head = HEADING.exec(lines[start] ?? '')
    if (head === null) return
    const level = (head[1] as string).length
    const block = lines.slice(start, last + 1).join('\n')
    const from = offsets[start] as number
    const to = from + block.length
    const end = Math.min(to + 1, body.length)
    // Nothing under the heading: a section. See `ScannedBlock`.
    if (last === start) {
      const name = (head[2] as string).trim()
      if (name === '') return
      out.push({ kind: 'section', name, from, to, end, level })
      return
    }
    const matter = parseMatter(block)
    if (matter === null) return
    out.push({ kind: 'matter', matter, from, to, end, level })
  })
  return out
}

export function scanMatters(body: string): readonly ScannedMatter[] {
  return scanBlocks(body).flatMap(b => (b.kind === 'matter' ? [b] : []))
}

export function scanSections(body: string): readonly ScannedSection[] {
  return scanBlocks(body).flatMap(b => (b.kind === 'section' ? [b] : []))
}

/**
 * The docket as it is read: sections in file order, each with its matters.
 *
 * The unnamed run comes first and is present **only if it has matters in it** —
 * an empty one is not a thing anybody put there, and drawing a blank group above
 * the first heading would be drawing the absence of a decision.
 */
export function outline(body: string): readonly Section[] {
  const out: { name: string; matters: Matter[] }[] = [{ name: '', matters: [] }]
  for (const block of scanBlocks(body)) {
    if (block.kind === 'section') out.push({ name: block.name, matters: [] })
    else (out[out.length - 1] as { matters: Matter[] }).matters.push(block.matter)
  }
  return out.filter((s, at) => at > 0 || s.matters.length > 0)
}

/**
 * When a step comes due, or null if it cannot be said yet.
 *
 * **Three ways a step has no date**, and they are not the same thing: the matter
 * has not been started, so `T±N` has nothing to measure from; the step waits on
 * another that is not done, so its moment has not been earned; or it waits on a
 * step that is not there, which is a dangling reference and never comes due at
 * all. All three mean *not now*, and the difference matters to whoever is
 * explaining why nothing happened.
 */
export function dueOn(
  step: Step,
  matter: Matter,
  add: (from: DateKey, days: number) => DateKey,
  zone: string = DEFAULT_ZONE,
): DateKey | null {
  const start = matter.when.start
  if (start === null) return null
  const when = step.when
  if (when.kind === 'at') return add(start, offsetDays(when.offset))
  const waits = matter.steps.find(one => one.id === when.step)
  if (waits === undefined || waits.done === null) return null
  // **Measured from the day it was finished**, not from the matter's date: that
  // is the whole meaning of one step following another.
  //
  // **In the notebook's zone, and this was UTC.** A stamp is an instant; the day
  // it fell on is a question about *where*, and `toISOString` answers it for
  // Greenwich. Finish a task at 17:42 Pacific and UTC has already turned over,
  // so the step waiting on it came due *tomorrow* and generated nothing today —
  // reported from use as a second missing activation, and the same one-clock-too-
  // many that put wall-clock stamps on completions in MH3b.
  const was = dateKeyAt(new Date(waits.done * 1000), zone)
  return when.offset === undefined ? was : add(was, offsetDays(when.offset))
}

/**
 * The instance *before* this one — the inverse of `addInterval`.
 *
 * **Because the question somebody can answer is not always the one stored.** A
 * matter that recurs from its own completion stores *when it is next due*, and
 * what a person knows is *when I last did it*: opening a filter change and being
 * asked for the next due date means doing the arithmetic in your head, with the
 * interval sitting right there on the screen. So the panel asks for the last one
 * and converts, which is this.
 *
 * Days and weeks are exact. Months and years go back the same way they go
 * forward — same day number, clamped to the month's end — so the pair round-trips
 * except where a clamp has genuinely lost information, which is the same
 * asymmetry `addInterval` documents going the other way.
 */
export function backInterval(start: DateKey, every: Interval): DateKey {
  if (every.unit === 'd') return addDays(start, -every.n)
  if (every.unit === 'w') return addDays(start, -every.n * 7)
  const [y, m, d] = (start as string).split('-').map(Number) as [number, number, number]
  const meant = every.day ?? d
  const months = every.unit === 'y' ? every.n * 12 : every.n
  const at = (y * 12 + (m - 1)) - months
  const year = Math.floor(at / 12)
  const month = (at % 12) + 1
  const room = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(meant, room)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as DateKey
}

/**
 * One instance on to the next, keeping the day somebody meant.
 *
 * **Days and weeks are arithmetic; months and years are a calendar.** Adding a
 * month is not adding thirty days — it is the same day number in the next
 * month, and where that day does not exist it clamps to the month's end. The
 * clamp is what would otherwise lose the intent: the 31st becomes the 28th in
 * February, and a roll computed *from* that 28th gives the 28th of March and
 * every month after, permanently.
 *
 * So the roll is computed from the **intended** day, which the interval carries
 * whenever it differs from the stored date — and which is set here, the first
 * time a clamp hides it, rather than being asked for.
 */
export function addInterval(
  start: DateKey,
  every: Interval,
): { date: DateKey; every: Interval } {
  if (every.unit === 'd') return { date: addDays(start, every.n), every }
  if (every.unit === 'w') return { date: addDays(start, every.n * 7), every }
  const [y, m, d] = (start as string).split('-').map(Number) as [number, number, number]
  // The day this is really anchored on: what was carried, or what is there now.
  const meant = every.day ?? d
  const months = every.unit === 'y' ? every.n * 12 : every.n
  const at = (y * 12 + (m - 1)) + months
  const year = Math.floor(at / 12)
  const month = (at % 12) + 1
  const room = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(meant, room)
  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as DateKey
  return {
    date,
    // Carried from the moment a clamp first hides it, and dropped again once
    // the stored day says the same thing — a field that is only ever true.
    every: day === meant ? { n: every.n, unit: every.unit } : { ...every, day: meant },
  }
}

/** An offset in whole days. Months are thirty here; see `PER` in the document. */
function offsetDays(offset: string): number {
  const found = OFFSET.exec(offset)
  if (found === null) return 0
  const n = found[2] === undefined ? 1 : Number(found[2])
  const per: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 }
  return n * (per[unitOf(found[3] as string)] ?? 1) * (found[1] === '+' ? 1 : -1)
}

/** A section's heading line. Always the top level, with matters below it. */
export function sectionHeading(name: string): string {
  return `## ${name.trim()}`
}

/** An id nothing else in the corpus is using. The task list's rule (D56). */
export function unusedMatterId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let id = ''
    while (id.length < 8) id += Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')
    const made = id.slice(0, 8)
    if (!taken.has(made)) return made
  }
  throw new Error('could not find an unused matter id')
}

// ── the docket as a horizon source (MH2, H8, D74) ────────────
//
// **The docket implements the horizon; it does not define it.** What a row is,
// what window it spans and what order rows come in belong to `horizon-api.ts`.
// What belongs *here* is the only part no other source could supply: how a
// matter's steps and instances turn into dates, which is `dueOn`, interval
// arithmetic and the anchor rule.

/**
 * One dated thing this docket is contributing.
 *
 * **A contribution is a step occurrence, not a matter**, which is what D76 made
 * of the problem: the step is the thing that carries a date, and a matter is a
 * name for a sequence of them. It says *which instance*, because two occurrences
 * of one recurrence can land in the same window and an unlabelled pair of them is
 * worse than either alone.
 *
 * It stops short of a `HorizonRow`: the document it belongs to is not something a
 * matter knows, so whoever holds the docket completes it.
 */
export interface MatterHorizon {
  readonly on: DateKey
  readonly text: string
  readonly kind: HorizonKind
  /** The critical date of the occurrence this belongs to — the row's label. */
  readonly instance: DateKey
  readonly step: string | null
  /**
   * The last day this occupies, when it occupies more than one (D92).
   *
   * **Only on the step that IS the occasion**, which is the one landing on the
   * instance date. A run-up two weeks before a conference is a point in time
   * and so is a note on its second morning; the extent belongs to the event.
   */
  readonly until?: DateKey
}

/**
 * The instances of a matter whose dates could put something in a window.
 *
 * **A sweep for calendar recurrence, and the next one only for the other kind**,
 * which is not a simplification but the honest answer. A matter that recurs on
 * the calendar has a *sequence* of instances, computable as far ahead as anyone
 * cares to look. A matter that recurs from its own completion has exactly one
 * knowable instance — the next one depends on a day that has not happened, and a
 * horizon that guessed at it would be inventing a commitment.
 *
 * Swept from `start` rather than from `from`, because the anchored day travels
 * with the interval (`every.day`) and picking it up mid-sequence would lose the
 * clamp: the 31st would become the 28th and stay there.
 */
export function instancesIn(
  matter: Matter,
  to: DateKey,
  cap = 500,
): readonly DateKey[] {
  const { start, every, after, dates } = matter.when
  if (start === null) return []
  // **Listed instances are read, not computed** — the whole of what a list buys.
  // From the current one onward, because what is behind it has happened and the
  // horizon is not a history.
  if (dates !== null) {
    const from = dates.findIndex(one => compareKeys(one, start) >= 0)
    return (from < 0 ? [] : dates.slice(from)).filter(one => compareKeys(one, to) <= 0)
  }
  if (every === null || after !== null) return [start]
  const out: DateKey[] = []
  let at = start
  let step = every
  for (let n = 0; n < cap && compareKeys(at, to) <= 0; n += 1) {
    out.push(at)
    const next = addInterval(at, step)
    at = next.date
    step = next.every
    // An interval this cannot make progress on would otherwise spin.
    if (compareKeys(at, out[out.length - 1] as DateKey) <= 0) break
  }
  return out
}

/**
 * What a matter contributes to the horizon.
 *
 * **A step already on the task list is not here.** That is the rule that keeps
 * the horizon's two sources disjoint: once a task step has generated, the item
 * *is* the thing in front of you, and a horizon row beside it would be the same
 * commitment counted twice. The horizon is what is coming; the list is what is
 * here.
 *
 * **And a step whose antecedent is unfinished has no date at all**, so it is not
 * on the horizon — not shown as undated, not guessed at. `dueOn` already says
 * *not yet* for three different reasons and they all mean the same thing here.
 *
 * Completion and provenance are read **only for the current instance**, since
 * that is the only one they are about: a future occurrence of a recurrence is
 * fresh by construction, whatever the stored step says about the last one.
 */
export function matterHorizon(
  matter: Matter,
  window: HorizonWindow,
  add: (day: DateKey, days: number) => DateKey = addDays,
  zone: string = DEFAULT_ZONE,
): readonly MatterHorizon[] {
  const out: MatterHorizon[] = []
  const current = matter.when.start
  for (const instance of instancesIn(matter, window.to)) {
    const here = instance === current
    const at: Matter = { ...matter, when: { ...matter.when, start: instance } }
    for (const step of matter.steps) {
      if (here && (step.done !== null || step.made !== null)) continue
      const on = dueOn(step, at, add, zone)
      if (on === null) continue
      // **An event that lasts is in the window while any of it is** (D92).
      // *Santa Monica 9-17 → 9-22* is the answer to *what is going on* on the
      // 20th, and a sweep that only asked about its first day dropped it the
      // morning after it began — which is exactly what made people write the
      // range into the title, where nothing could drop it at all.
      //
      // **The extent is the occasion's, not every step's.** Only the step
      // landing on the instance date carries it; the rest are points.
      const ends = on === instance ? endOf(matter.when, instance) : null
      const spans = ends !== null && ends > on
      if (spans ? ends < window.from || on > window.to : !inHorizon(on, window)) continue
      out.push({
        on, text: step.text, kind: step.kind, instance, step: step.id,
        ...(spans ? { until: ends } : {}),
      })
    }
  }
  return out
}

/** Local, so this module needs nothing from `dates.ts` but arithmetic. */
const compareKeys = (a: DateKey, b: DateKey): number => (a < b ? -1 : a > b ? 1 : 0)
