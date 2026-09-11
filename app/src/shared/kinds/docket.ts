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

/** A trigger line inside a `triggers:` block. */
const TRIGGER = /^-\s*([+-]?\d+[dwmy])\s+([a-z]+)\s*:\s*(.*)$/

const DAY = /^\d{4}-\d{2}-\d{2}$/
const RANGE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/
const MONTHS = /^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/
const EVERY = /^every\s+(\d+)([dwmy])$/
const AFTER = /^(\d+)([dwmy])\s+after\s+done$/
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
  /** Every N days/weeks/months/years, from a fixed origin. */
  | { readonly kind: 'every'; readonly n: number; readonly unit: Unit }
  /**
   * N after the last time it *actually happened* (H7).
   *
   * Which is why completion has to flow backward: the clock reads from a
   * designated occurrence's completion, not from a calendar.
   */
  | { readonly kind: 'after'; readonly n: number; readonly unit: Unit }
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

const OFFSET = /^([+-]?)(\d+)\s*([dwmy])$/

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
  const n = Number(found[2])
  if (n === 0) return null // an offset of nothing is a date, not a run-up
  return `${found[1] === '+' ? '+' : '-'}${n}${found[3] as string}`
}

/** How long before, said the way a person would read it back. */
export function spellOffset(offset: string): string {
  const found = OFFSET.exec(offset)
  if (found === null) return offset
  const n = Number(found[2])
  const unit = { d: 'day', w: 'week', m: 'month', y: 'year' }[found[3] as string] ?? found[3]
  const plural = n === 1 ? unit : `${unit}s`
  return `${n} ${plural} ${found[1] === '+' ? 'after' : 'before'}`
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
}

export const STANDING: When = { kind: 'standing' }

/** What a person writes for *no date yet*, and what this writes back. */
export const NO_DATE = '—'

export function parseWhen(text: string): When | null {
  const said = text.trim()
  if (said === '' || said === NO_DATE || said === '-' || said.toLowerCase() === 'standing') {
    return STANDING
  }
  const range = RANGE.exec(said)
  if (range !== null) return { kind: 'between', from: range[1] as DateKey, until: range[2] as DateKey }
  const months = MONTHS.exec(said)
  if (months !== null) return { kind: 'season', from: months[1] as string, until: months[2] as string }
  if (DAY.test(said)) return { kind: 'on', date: said as DateKey }
  const every = EVERY.exec(said)
  if (every !== null) return { kind: 'every', n: Number(every[1]), unit: every[2] as Unit }
  const after = AFTER.exec(said)
  if (after !== null) return { kind: 'after', n: Number(after[1]), unit: after[2] as Unit }
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
      return `every ${when.n}${when.unit}`
    case 'after':
      return `${when.n}${when.unit} after done`
    case 'ics':
      return `ics: ${when.file}`
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
      if (line.trim() !== '') extra.push(line)
      continue
    }
    const key = (field[1] as string).toLowerCase()
    const value = (field[2] as string).trim()
    if (key === 'when') {
      // **`ics:` is a `when`, and it collides with the field syntax.** `when:
      // ics: holidays.ics` reads as a field whose value is itself a field, so
      // the value is re-joined before parsing rather than split twice.
      when = parseWhen(value) ?? STANDING
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

  return { id, name, when, tags, owner, link, triggers, arrived, declines, occurrence, extra }
}

/** How wide a matter's heading is. One level, because a docket is a flat list. */
const LEVEL = '## '

/**
 * A matter back into a block.
 *
 * **Only what is there is written.** An empty `owner:` line is noise in a file a
 * person reads, and a field that appears only when it has a value is what keeps
 * a hand-written docket looking hand-written.
 */
export function matterBlock(matter: Matter): string {
  const lines = [`${LEVEL}${matter.name}`]
  lines.push(`when: ${spellWhen(matter.when)}`)
  if (matter.tags.length > 0) lines.push(`tags: ${matter.tags.map(spellTag).join(' ')}`)
  if (matter.owner !== null) lines.push(`owner: ${matter.owner}`)
  if (matter.link !== null) lines.push(`link: ${matter.link}`)
  if (matter.triggers.length > 0) {
    lines.push('triggers:')
    for (const t of matter.triggers) lines.push(`- ${t.offset} ${t.effect}: ${t.text}`)
  }
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
export function scanMatters(body: string): readonly ScannedMatter[] {
  const out: ScannedMatter[] = []
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
    const block = lines.slice(start, last + 1).join('\n')
    const matter = parseMatter(block)
    if (matter === null) return
    const from = offsets[start] as number
    const to = from + block.length
    out.push({ matter, from, to, end: Math.min(to + 1, body.length) })
  })
  return out
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
