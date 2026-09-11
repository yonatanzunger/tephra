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
// when: 90d after done
// triggers:
// - -3d task: Change the air filters #house
// <!--tephra:matter aa11bb22 1757462400 0 2026-09-14-->
// ```
//
// **Why headings rather than one line per matter**, which is what the task list
// does. A matter carries triggers, and a trigger is *offset → effect*: a small
// list. D56's indented continuation lines carry a task's notes, which are prose
// and need no structure — triggers are not prose, and pretending they are is how
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

import { asDateKey, compareDateKeys } from '../dates.ts'
import { subjectKey, tagMark } from '../tags.ts'
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
 * A trigger line inside a `triggers:` block.
 *
 * **Strict, unlike the fields a person types into.** This line is written by
 * `matterBlock` and never by hand; a hand-edited one that misses the shape is
 * preserved verbatim by the leniency rule rather than lost, which is the right
 * outcome for a format that has a UI (D72).
 */
const TRIGGER = /^-\s*([+-]?\d+[dwmy])\s+([a-z]+)\s*:\s*(.*)$/

const DAY = /^\d{4}-\d{2}-\d{2}$/
const RANGE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/
const MONTHS = /^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/

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
const AFTER = new RegExp(`^${COUNT}${UNIT}\\s+after\\s+done${FROM}$`)
const ICS = /^ics:\s*(\S+)$/

/**
 * When a matter happens — or that it does not yet, which is a first-class answer.
 *
 * **`standing` is not an absence of data** (H7b). The broken oven and repainting
 * the house are true about the domain indefinitely; giving one a date is the
 * *point* of the review, so *no date* has to be a state the format can hold
 * rather than a field left blank.
 */
export type When =
  | { readonly kind: 'standing' }
  | { readonly kind: 'on'; readonly date: DateKey }
  | { readonly kind: 'between'; readonly from: DateKey; readonly until: DateKey }
  /**
   * A season: months rather than days (H7b).
   *
   * **Coarser than a day, and the only thing in this design that is.** A major
   * project is committed to a period long before it has a date — *"during which
   * months will we be driving these"* — and that commitment already has
   * consequences for money and travel.
   */
  | { readonly kind: 'season'; readonly from: string; readonly until: string }
  /**
   * Every N days/weeks/months/years — **from a date that has to be recorded.**
   *
   * *Every ninety days* is not a schedule until you know ninety days from
   * **what**. The type said "from a fixed origin" and carried no field for one,
   * which would have left MH3 guessing — and guessing from `arrived` is wrong
   * twice: it is metadata rather than intent, and `adopt` re-dates it, so moving
   * a matter between dockets would silently move its schedule.
   *
   * **`from` is optional in the format and not in the meaning.** A person says
   * *every 90 days* first and *starting the first of October* second, so the
   * notation must accept the incomplete version — but a recurrence with no
   * anchor cannot generate, and MH3 has to say so rather than pick a date.
   * Un-backfillable either way, which is why it is here and not there.
   */
  | { readonly kind: 'every'; readonly n: number; readonly unit: Unit; readonly from?: DateKey }
  /**
   * N after the last time it *actually happened* (H7).
   *
   * Which is why completion has to flow backward: the clock reads from a
   * designated occurrence's completion, not from a calendar.
   */
  | { readonly kind: 'after'; readonly n: number; readonly unit: Unit; readonly from?: DateKey }
  /** Dates read from an ICS file kept in the notebook (H12, D69). */
  | { readonly kind: 'ics'; readonly file: string }

export type Unit = 'd' | 'w' | 'm' | 'y'

/** *At this offset, do this.* The run-up, authored per matter (H4). */
export interface Trigger {
  /** Signed, in days/weeks/months/years. `-14d` is a fortnight before. */
  readonly offset: string
  /** `task`, `note`, `doc` — left open, because MH3 is what spends them. */
  readonly effect: string
  readonly text: string
}

/**
 * `2w`, `2 weeks`, `2 weeks before`, `+3 days after` — and `-14d` from the file.
 *
 * **Worded, for the same reason `EVERY` is** (see `UNIT`): the run-up row reads
 * back *2 weeks before*, so that is what a person will type into the field
 * beside it. The trailing word is accepted because it is half of what was just
 * read aloud, and a field that rejects the second half of its own sentence is a
 * puzzle. An explicit sign still wins over it — `-3d after` is a contradiction,
 * and the punctuation is the more deliberate of the two.
 */
const OFFSET = new RegExp(`^([+-]?)${COUNT}${UNIT}(?:\\s+(before|after))?$`)

/**
 * An offset as somebody says it out loud, normalised to what the file holds.
 *
 * **A bare number is BEFORE**, and that is the whole reason this exists. The
 * concept is a *run-up window* (H4) and every example in the requirements is
 * ahead of the date — two weeks before a talk, months before a birthday, days
 * before a filter. Making somebody type a minus sign to get the ordinary case is
 * a tax on the common gesture, and `-` is punctuation nobody says in a
 * conversation.
 *
 * **`+` is how you get the other one**, because it exists: *file the expenses
 * three days after the trip.* Explicit, because it is the rare case and a silent
 * one would be a surprise.
 */
export function parseOffset(text: string): string | null {
  const found = OFFSET.exec(text.trim().toLowerCase())
  if (found === null) return null
  const n = found[2] === undefined ? 1 : Number(found[2])
  if (n === 0) return null // an offset of nothing is a date, not a run-up
  const sign = found[1] === '' ? (found[4] === 'after' ? '+' : '-') : found[1]
  return `${sign === '+' ? '+' : '-'}${n}${unitOf(found[3] as string)}`
}

/** How long before, said the way a person would read it back. */
export function spellOffset(offset: string): string {
  const found = OFFSET.exec(offset)
  if (found === null) return offset
  const n = Number(found[2])
  return `${spellSpan(n, found[3] as string)} ${found[1] === '+' ? 'after' : 'before'}`
}

/** What a trigger does. `doc` is authored here and spent in MH3. */
export const EFFECTS: readonly string[] = ['task', 'note', 'doc']

export interface Matter {
  readonly id: string | null
  readonly name: string
  readonly when: When
  readonly tags: readonly string[]
  readonly owner: string | null
  /** A relative markdown link to one document (H14). */
  readonly link: string | null
  readonly triggers: readonly Trigger[]
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
   * The four that cannot be added later (`solution/horizon.md`).
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

export const STANDING: When = { kind: 'standing' }

/** What a person writes for *no date yet*, and what this writes back. */
export const NO_DATE = '—'

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

/** A month, checked the same way: the first of it has to exist. */
const realMonth = (text: string): string | null =>
  asDateKey(`${text}-01`) === null ? null : text

export function parseWhen(text: string): When | null {
  const said = text.trim()
  if (said === '' || said === NO_DATE || said === '-' || said.toLowerCase() === 'standing') {
    return STANDING
  }
  const range = RANGE.exec(said)
  if (range !== null) {
    const from = real(range[1] as string)
    const until = real(range[2] as string)
    // **Backwards is not a range**, the same call the query notation makes: a
    // silent swap is worse than a complaint, because it files a date nobody
    // chose.
    if (from === null || until === null || compareDateKeys(from, until) > 0) return null
    return { kind: 'between', from, until }
  }
  const months = MONTHS.exec(said)
  if (months !== null) {
    const from = realMonth(months[1] as string)
    const until = realMonth(months[2] as string)
    if (from === null || until === null || from > until) return null
    return { kind: 'season', from, until }
  }
  if (DAY.test(said)) {
    const day = real(said)
    return day === null ? null : { kind: 'on', date: day }
  }
  const every = EVERY.exec(said.toLowerCase())
  if (every !== null) {
    const from = every[3] === undefined ? undefined : real(every[3] as string)
    if (every[3] !== undefined && from === null) return null
    const n = every[1] === undefined ? 1 : Number(every[1])
    if (n === 0) return null // *every no days* is not a schedule
    return {
      kind: 'every',
      n,
      unit: unitOf(every[2] as string),
      ...(from === undefined || from === null ? {} : { from }),
    }
  }
  const after = AFTER.exec(said.toLowerCase())
  if (after !== null) {
    const from = after[3] === undefined ? undefined : real(after[3] as string)
    if (after[3] !== undefined && from === null) return null
    const n = after[1] === undefined ? 1 : Number(after[1])
    if (n === 0) return null
    return {
      kind: 'after',
      n,
      unit: unitOf(after[2] as string),
      ...(from === undefined || from === null ? {} : { from }),
    }
  }
  const ics = ICS.exec(said)
  if (ics !== null) return { kind: 'ics', file: ics[1] as string }
  // **Unparseable is not standing.** A `when` somebody typed and this cannot
  // read is a thing to say out loud rather than silently treat as undated —
  // which would quietly stop a matter ever reaching the horizon.
  return null
}

export function spellWhen(when: When): string {
  switch (when.kind) {
    case 'standing':
      return NO_DATE
    case 'on':
      return when.date
    case 'between':
      return `${when.from}..${when.until}`
    case 'season':
      return `${when.from}..${when.until}`
    case 'every':
      return `every ${when.n}${when.unit}${when.from === undefined ? '' : ` from ${when.from}`}`
    case 'after':
      return `${when.n}${when.unit} after done${when.from === undefined ? '' : ` from ${when.from}`}`
    case 'ics':
      return `ics: ${when.file}`
  }
}

const UNITS: Record<string, string> = { d: 'day', w: 'week', m: 'month', y: 'year' }

/** `90` and `d` as *90 days*, the shared half of reading an interval back. */
const spellSpan = (n: number, unit: string): string => {
  const word = UNITS[unit] ?? unit
  return `${n} ${n === 1 ? word : `${word}s`}`
}

/**
 * A `when` the way it is said across a table, as against written in the file.
 *
 * **Two forms, because they have two jobs.** `spellWhen` round-trips: what it
 * returns is what `parseWhen` reads, so it is what the file holds and what an
 * in-place edit starts from. This one is only ever *read*, so it can use words —
 * and it has to, because `every 90d from 2026-10-01` is notation, and it was
 * sitting inches from a run-up that already said *two weeks before* in plain
 * words. H3's floor is a surface legible to whoever is not driving the keyboard;
 * a row that switches languages halfway across fails it.
 *
 * **Plain dates stay as they are.** A column of ISO dates is scanned, not read
 * aloud, and it lines up; recurrence is the part that was unreadable.
 */
export function readWhen(when: When): string {
  switch (when.kind) {
    case 'every':
      // *Every week*, not *every 1 week* — and `EVERY`'s count is optional
      // precisely so that this sentence goes back in.
      return `every ${when.n === 1 ? UNITS[when.unit] ?? when.unit : spellSpan(when.n, when.unit)}${
        when.from === undefined ? '' : ` from ${when.from}`
      }`
    case 'after':
      return `${spellSpan(when.n, when.unit)} after done${
        when.from === undefined ? '' : ` from ${when.from}`
      }`
    default:
      return spellWhen(when)
  }
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

  let when: When = STANDING
  let owner: string | null = null
  let link: string | null = null
  let id: string | null = null
  let arrived = 0
  let declines = 0
  let occurrence: DateKey | null = null
  const tags: string[] = []
  const triggers: Trigger[] = []
  const notes: string[] = []
  const extra: string[] = []
  let inTriggers = false

  for (const line of lines.slice(1)) {
    const mark = MARK.exec(line)
    if (mark !== null) {
      id = mark[1] as string
      arrived = Number(mark[2])
      declines = Number(mark[3])
      occurrence = mark[4] === undefined ? null : (mark[4] as DateKey)
      continue
    }
    if (inTriggers) {
      const trigger = TRIGGER.exec(line.trim())
      if (trigger !== null) {
        triggers.push({
          offset: trigger[1] as string,
          effect: trigger[2] as string,
          text: (trigger[3] as string).trim(),
        })
        continue
      }
      // A `- ` line this cannot read is kept rather than dropped: it is
      // somebody's, and losing it is the one thing lenient parsing must not do.
      if (line.trim().startsWith('-')) {
        extra.push(line)
        continue
      }
      inTriggers = false
    }
    const field = FIELD.exec(line)
    if (field === null) {
      // Not a field and not a trigger: it is prose, which is a note.
      if (line.trim() !== '') notes.push(line.trim())
      continue
    }
    const key = (field[1] as string).toLowerCase()
    const value = (field[2] as string).trim()
    if (key === 'when') {
      // **`ics:` is a `when`, and it collides with the field syntax.** `when:
      // ics: holidays.ics` reads as a field whose value is itself a field, so
      // the value is re-joined before parsing rather than split twice.
      const said = parseWhen(value)
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
    } else if (key === 'triggers') {
      inTriggers = true
      if (value !== '') extra.push(line)
    } else if (key === 'owner') {
      owner = value === '' ? null : value
    } else if (key === 'link') {
      link = value === '' ? null : value
    } else if (key === 'tags') {
      const found = tagMark()
      found.lastIndex = 0
      for (let t = found.exec(value); t !== null; t = found.exec(value)) {
        const subject = subjectKey(((t[1] ?? t[2]) as string).trim())
        if (subject !== '' && !tags.includes(subject)) tags.push(subject)
      }
    } else {
      extra.push(line)
    }
  }

  return { id, name, when, tags, owner, link, triggers, notes, arrived, declines, occurrence, extra }
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
  lines.push(`when: ${spellWhen(matter.when)}`)
  if (matter.tags.length > 0) lines.push(`tags: ${matter.tags.map(spellTag).join(' ')}`)
  if (matter.owner !== null) lines.push(`owner: ${matter.owner}`)
  if (matter.link !== null) lines.push(`link: ${matter.link}`)
  if (matter.triggers.length > 0) {
    lines.push('triggers:')
    for (const t of matter.triggers) lines.push(`- ${t.offset} ${t.effect}: ${t.text}`)
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
