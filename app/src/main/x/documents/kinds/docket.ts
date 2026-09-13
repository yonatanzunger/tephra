// A docket: one file, complete about one domain (MH1, D68, D72).
//
// **The todo document with the segmentation removed**, and therefore
// structurally simpler than the kind it is modelled on. `keys()` answers
// `ONLY_SEGMENT`, the arrangement `markdown` and `fileset` already use, and
// everything below `load` and `keys` is inherited: edits, undo, spans, the
// journal, the WAL, windows, divergence, versioning, restore.
//
// **What makes it a different kind is completeness** (H2). A task list holds
// what is in front of you and turns over daily; a docket holds *everything true
// about a house* — including matters that are dormant, standing, or not yet
// live — and turns over never. That is what earns the right to stop carrying
// the domain in your head, and it is why a docket is not a tag pivot: most of
// its contents are not live and many will never become tasks at all.
//
// **Every verb is one `replace()` over one BLOCK**, which is the one place this
// differs from the task list. There a verb rewrites a line; here a matter is a
// heading plus its fields plus its triggers, so the unit is a block — but it is
// still an ordinary edit: undoable, journalled, and visible to a window with the
// document open.

import type { Notebook } from '../../../w/notebook.ts'
import type { RelPath } from '../../../w/layout.ts'
import { SegmentedDocument } from '../segmented.ts'
import { Segment } from '../../segment.ts'
import { frontmatterFor, renderFrontmatter } from '../../frontmatter.ts'
import {
  addInterval, MATTER_LEVEL, matterBlock, outline, parseMatter, parseStepWhen, scanBlocks,
  scanMatters,
  sectionHeading, shapeOf, STEP_KINDS, UNSCHEDULED, unusedMatterId,
  type Matter, type ScannedBlock, type ScannedMatter, type Section, type Step,
  type Interval, type Mode, type Schedule, type StepKind, type StepWhen,
} from '../../../../shared/kinds/docket.ts'
import { addDays, compareDateKeys, nowSeconds } from '../../../../shared/dates.ts'
import { ONLY_SEGMENT } from '../../../../shared/document-api.ts'
import type {
  DateKey, DocumentId, DocumentMeta, DocumentText, SegmentKey, Span,
} from '../../../../shared/document-api.ts'

/**
 * Ids taken somewhere this document cannot see (D56's rule, carried).
 *
 * A matter's id has to be unique across the corpus so that a reference to it
 * resolves without naming a docket, and a document knows only itself — so
 * whoever holds the index hands this in, and it is called only at the moment an
 * id is actually minted.
 */
export type TakenIds = () => Promise<ReadonlySet<string>>

export class DocketDocument extends SegmentedDocument {
  readonly id: DocumentId
  readonly meta: DocumentMeta & { readonly kind: 'docket' } = { kind: 'docket' }

  readonly #rel: RelPath

  constructor(notebook: Notebook, id: DocumentId) {
    super(notebook)
    this.id = id
    this.#rel = id as string as RelPath
  }

  /** One segment, as every single-file kind does. A wrong key is a caller error. */
  protected async load(key: SegmentKey): Promise<Segment> {
    if (key !== ONLY_SEGMENT) {
      throw new Error(`${this.id} has one segment, and it is not ${key as string}`)
    }
    const text = await this.notebook.read(this.#rel)
    return text === null
      ? Segment.forFile(key, this.#rel, renderFrontmatter(frontmatterFor(null, 'docket')))
      : Segment.forFile(key, this.#rel, text)
  }

  async keys(): Promise<readonly SegmentKey[]> {
    return [ONLY_SEGMENT]
  }

  // ── reading ────────────────────────────────────────────────

  /**
   * Every matter, in file order, flat — sections and all.
   *
   * **File order, and nothing computed** — the task list's rule, held in the
   * part that matters: nothing here sorts itself, ever. What changed is the
   * claim that came with it, which was *creation order and nothing else*,
   * borrowed from `goal/todo.md`'s ban on rearranging. That ban was about a list
   * that turns over daily, where nesting would have had to mean urgency *or*
   * subject and could not mean both. A docket turns over never, and arranging it
   * — *periodic maintenance*, *need to do*, *major projects* — is how two people
   * find their way around it. So a person may move things; the machine may not.
   *
   * `sections()` is the divided view and the one the surface draws. This stays
   * flat because the horizon and the index want every matter, not the grouping.
   */
  async matters(): Promise<readonly Matter[]> {
    return (await this.#scan()).map(found => found.matter)
  }

  /**
   * The docket divided into its sections, which is what the surface draws.
   *
   * **Sections are for reading, and they are the only ordering this kind has.**
   * `matters()` above says creation order and nothing else, inheriting the task
   * list's rule against rearranging — and that rule was about a list that turns
   * over daily, where nesting would have had to mean urgency *or* subject. A
   * docket turns over never and is reasoned about as a whole, so grouping *is*
   * how you know your way around it: *periodic maintenance*, *need to do*,
   * *major projects*. The flat order is still the fallback, because a docket
   * with no sections has to work exactly as it did.
   */
  async sections(): Promise<readonly Section[]> {
    const segment = await this.segment(ONLY_SEGMENT)
    return outline(segment.body)
  }

  async #scan(): Promise<readonly ScannedMatter[]> {
    const segment = await this.segment(ONLY_SEGMENT)
    return scanMatters(segment.body)
  }

  async #blocks(): Promise<readonly ScannedBlock[]> {
    const segment = await this.segment(ONLY_SEGMENT)
    return scanBlocks(segment.body)
  }

  async #find(id: string): Promise<ScannedMatter> {
    const found = (await this.#scan()).find(m => m.matter.id === id)
    if (found === undefined) throw new Error(`${this.id} has no matter ${id}`)
    return found
  }

  // ── the verbs ──────────────────────────────────────────────

  /**
   * Put a matter on the docket.
   *
   * **Appended, and dated on arrival.** `arrived` is one of the four fields
   * that cannot be added later: a move between dockets is a delete plus an
   * append and records no date of its own, so without this the resurrection
   * rate — the one measurement that says whether the graveyard tier does
   * anything — is unreconstructible.
   */
  async add(
    name: string,
    when: Schedule = UNSCHEDULED,
    taken?: TakenIds,
    section = '',
    mode: Mode = 'task',
  ): Promise<string> {
    const said = name.trim()
    if (said === '') throw new Error('a matter needs a name')
    const id = unusedMatterId(new Set([
      ...(await this.matters()).flatMap(m => (m.id === null ? [] : [m.id])),
      ...(taken === undefined ? [] : [...(await taken())]),
    ]))
    const matter: Matter = {
      id, name: said, when, mode, tags: [], owner: null, link: null, steps: [], notes: [],
      arrived: nowSeconds(), declines: 0, occurrence: null, extra: [], from: null,
    }
    // **Where it goes is said, never guessed.** Appending to the end of the file
    // was right while a docket was one flat list and became wrong the moment it
    // could be divided: the end of the file is inside the *last* section, so
    // adding *fix the fence* to a docket whose last heading is *major projects*
    // would have filed it as one, silently, in the middle of a conversation. A
    // section is a claim; adding a matter makes no claim, so the default is the
    // undivided run and anything else is asked for.
    const { at, level } = await this.#endOf(section)
    const body = (await this.segment(ONLY_SEGMENT)).body
    // **A blank line between blocks, always.** The file is read by people and by
    // other markdown renderers, and two headings with nothing between them read
    // as one run-on section in both.
    const lead = at === 0 || body.slice(0, at).endsWith('\n\n')
      ? ''
      : body.slice(0, at).endsWith('\n') ? '\n' : '\n\n'
    const tail = at >= body.length ? '\n' : '\n\n'
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, at), end: this.at(ONLY_SEGMENT, at) },
      payload: `${lead}${matterBlock(matter, level)}${tail}` as DocumentText,
    }], 'operation')
    return id
  }

  /**
   * Rewrite one matter's block. Every field verb goes through here.
   *
   * **At the depth it was found at**, never at the default: a matter inside a
   * section is a heading level deeper, and a verb that reset that would flatten
   * the file's outline as a side effect of editing an owner.
   */
  /**
   * Rewrite one matter's block, leaving everything around it untouched.
   *
   */
  async #write(id: string, change: (was: Matter) => Matter): Promise<void> {
    const found = await this.#find(id)
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, found.from), end: this.at(ONLY_SEGMENT, found.to) },
      payload: matterBlock(change(found.matter), found.level) as DocumentText,
    }], 'operation')
  }

  /**
   * Say which task this matter was moved from (MH5).
   *
   * **Set last, after the matter is fully made**, because making one is several
   * writes and each of them forgets the provenance — which is the rule that
   * keeps an undo from deleting somebody's plan.
   */
  async cameFrom(id: string, item: string): Promise<void> {
    await this.#write(id, was => ({ ...was, from: item }))
  }

  async rename(id: string, name: string): Promise<void> {
    const said = name.trim()
    if (said === '') throw new Error('a matter needs a name')
    await this.#write(id, was => ({ ...was, name: said }))
  }

  /** When it happens — or that it does not yet, which is a state (H7b). */
  async setWhen(id: string, when: Schedule): Promise<void> {
    await this.#write(id, was => ({ ...was, when }))
  }

  /** The date of the next instance, or none — which is the whole of *inactive*. */
  /**
   * Change what kind of thing a matter is.
   *
   * **The mode governs, so changing it changes what it governs**: a one-off
   * keeps no interval, and only a recurring *task* measures from a step being
   * done. Without that the stored mode could come to disagree with the
   * variables — the objection that kept it derived for a while, and the answer
   * is that it sits upstream of them rather than being a label on them.
   */
  async setMode(id: string, mode: Mode): Promise<void> {
    const shape = shapeOf(mode)
    await this.#write(id, was => ({
      ...was,
      mode,
      when: {
        start: was.when.start,
        every: shape.repeating ? was.when.every : null,
        after: shape.repeating && shape.fromCompletion ? was.when.after : null,
        // A list is a recurrence, so it survives exactly as an interval does.
        dates: shape.repeating ? was.when.dates : null,
      },
    }))
  }

  async setStart(id: string, start: DateKey | null): Promise<void> {
    await this.#write(id, was => ({ ...was, when: { ...was.when, start } }))
  }

  /** How often it comes round, or never. */
  async setEvery(id: string, every: Interval | null): Promise<void> {
    await this.#write(id, was => ({
      ...was,
      // **Losing the interval loses what measured from it.** A matter that does
      // not recur has no step advancing its clock, and leaving one behind would
      // be a pointer that means nothing.
      when: {
        ...was.when,
        every,
        // **An interval and a list are one answer, so setting one clears the
        // other.** A matter holding both would have two answers about when it
        // comes round and no rule for which wins.
        ...(every === null ? { after: null } : { dates: null }),
      },
    }))
  }

  /**
   * Which step's completion starts the next instance — or none, for a matter
   * the calendar drives regardless of what anybody did.
   */
  async setAfter(id: string, after: string | null): Promise<void> {
    const found = await this.#find(id)
    if (after !== null && !found.matter.steps.some(one => one.id === after)) {
      throw new Error(`${after} is not a step on this matter`)
    }
    if (after !== null && found.matter.when.every === null) {
      throw new Error('a matter with no interval has nothing to reschedule')
    }
    await this.#write(id, was => ({ ...was, when: { ...was.when, after } }))
  }

  async setOwner(id: string, owner: string | null): Promise<void> {
    const said = owner === null ? null : owner.trim()
    await this.#write(id, was => ({ ...was, owner: said === '' ? null : said }))
  }

  async setLink(id: string, link: string | null): Promise<void> {
    const said = link === null ? null : link.trim()
    await this.#write(id, was => ({ ...was, link: said === '' ? null : said }))
  }

  /**
   * **`tagMatter`, not `tag`** — the task list learned this too. `tag(span,
   * subject)` is every document's range-tagging verb and means something else
   * entirely, so a kind's own tagging has to be named for what it tags.
   */
  async tagMatter(id: string, subject: string): Promise<void> {
    const said = subject.trim().toLowerCase()
    if (said === '') return
    await this.#write(id, was =>
      was.tags.includes(said) ? was : { ...was, tags: [...was.tags, said] })
  }

  async untagMatter(id: string, subject: string): Promise<void> {
    const said = subject.trim().toLowerCase()
    await this.#write(id, was => ({ ...was, tags: was.tags.filter(t => t !== said) }))
  }

  /**
   * Add a run-up to a matter (H4, MH1).
   *
   * **The parameter that reconciles a complete record with a short horizon.** A
   * docket holds everything, most of it dormant; the horizon has to stay short
   * or it stops being read. The trigger is what decides when a matter crosses
   * from one to the other, and it is per matter because prep time ranges from
   * days for a filter to months for a birthday whose output is *sitting down and
   * writing a plan*.
   *
   * **Offsets are normalised on the way in** (`parseOffset`): a bare `14d` is
   * fourteen days *before*, because run-up is the case and a minus sign is
   * punctuation nobody says out loud.
   */
  async addStep(
    id: string,
    when: string,
    text: string,
    kind: StepKind = 'task',
  ): Promise<string> {
    // **`then` means *after the one before it*, and only this level knows which
    // that is.** The grammar is given the answer rather than the question: the
    // last step currently on the matter, since a chain is typed top to bottom.
    const existing = (await this.#find(id)).matter.steps
    const last = existing[existing.length - 1]?.id
    const asked = parseStepWhen(when, {
      ...(last === null || last === undefined ? {} : { previous: last }),
      resolve: pointer(existing),
    })
    if (asked === null) throw new Error(unreadable(when, last === null || last === undefined))
    const schedule = asked
    const said = text.trim()
    if (said === '') throw new Error('a step needs to say what happens')
    const taken = new Set((await this.#find(id)).matter.steps.flatMap(
      one => (one.id === null ? [] : [one.id]),
    ))
    const made = unusedMatterId(taken)
    await this.#write(id, was => ({
      ...was,
      // **Sorted by when they fire**, earliest first, because that is the order
      // they are read in and the order they will run in. Two steps on one
      // matter in the order they happened to be typed is a list nobody can scan.
      //
      // **A dependent step sorts after the one it waits on**, not by an offset
      // it does not have: its position is only knowable relative to its
      // antecedent, so it inherits that place and sits just behind it.
      steps: order([
        ...was.steps,
        { id: made, kind, when: schedule, text: said, done: null, made: null },
      ]),
    }))
    return made
  }

  /**
   * Fix what a step says.
   *
   * **Editing rather than drop-and-retype, because a step has identity.** Its id
   * is what a dependency points at and its completion stamp is what that
   * dependency reads, so retyping a typo would orphan the step waiting on it and
   * forget that it was already done. The same argument as a matter's name, one
   * level down.
   */
  async editStep(id: string, step: string, text: string): Promise<void> {
    const said = text.trim()
    if (said === '') throw new Error('a step needs to say what happens')
    await this.#write(id, was => ({
      ...was,
      steps: was.steps.map(one => (one.id === step ? { ...one, text: said } : one)),
    }))
  }

  /** Reschedule one step, keeping its id and whether it is done. */
  async setStepWhen(id: string, step: string, when: string): Promise<void> {
    const steps = (await this.#find(id)).matter.steps
    const at = steps.findIndex(one => one.id === step)
    // For an existing step, *then* means the one immediately above it — not the
    // end of the list, which is where a new step would be going.
    const before = at > 0 ? steps[at - 1]?.id : undefined
    const schedule = parseStepWhen(when, {
      ...(before === null || before === undefined ? {} : { previous: before }),
      resolve: pointer(steps),
    })
    if (schedule === null) {
      throw new Error(unreadable(when, before === null || before === undefined))
    }
    if (schedule.kind === 'after' && schedule.step === step) {
      throw new Error('a step cannot wait for itself')
    }
    await this.#write(id, was => ({
      ...was,
      steps: order(was.steps.map(one => (one.id === step ? { ...one, when: schedule } : one))),
    }))
  }

  /**
   * Change what kind of step it is, keeping everything else.
   *
   * **Because otherwise `reschedule` is unreachable.** Asked from use — *how do
   * I create an interval-scheduled task right now?* — and the honest answer was
   * that you could not: every step was authored as a `task`, so the one kind
   * that makes a matter recur from its own completion had no way in.
   */
  async setStepKind(id: string, step: string, kind: StepKind): Promise<void> {
    if (!STEP_KINDS.includes(kind)) throw new Error(`${kind} is not task, status or reschedule`)
    await this.#write(id, was => ({
      ...was,
      steps: was.steps.map(one => (one.id === step ? { ...one, kind } : one)),
    }))
  }

  /** Record what a step put on the list, or that it no longer has one. */
  async setMade(id: string, step: string, made: string | null): Promise<void> {
    await this.#write(id, was => ({
      ...was,
      steps: was.steps.map(one => (one.id === step ? { ...one, made } : one)),
    }))
  }

  /** Take a step off, by id. */
  async removeStep(id: string, step: string): Promise<void> {
    const found = await this.#find(id)
    // **Refused rather than repaired afterwards.** Taking away the step the
    // clock reads from would leave a matter that quietly stopped recurring,
    // which is the shape of failure this project is named against. The
    // alternative considered was editing a matter as a batch and validating on
    // save — which would be the first place in this app that asks anybody to
    // save, and buys one message the price of a whole mode.
    if (found.matter.when.after === step) {
      throw new Error('this step is what makes the matter recur; choose another first')
    }
    await this.#write(id, was => ({
      ...was,
      steps: was.steps.filter(one => one.id !== step),
    }))
  }

  /**
   * Mark a step done, or not done, at a given moment.
   *
   * **The stamp is what a dependency reads**, so it lives here rather than being
   * inferred from whatever the step generated: the generated item can be edited
   * away, and *suspend* withdraws those items while having to preserve this.
   */
  async completeStep(id: string, step: string, at: number | null = nowSeconds()): Promise<void> {
    await this.#write(id, was => ({
      ...was,
      steps: was.steps.map(one => (one.id === step ? { ...one, done: at } : one)),
    }))
  }

  // ── activation (D76) ───────────────────────────────────────

  /**
   * Start work on a matter: give it the start date that makes its first step due
   * today.
   *
   * **Not *today*, but *the first step is due now*** — the same thing only for a
   * matter whose steps all run forward. A matter with a fortnight's run-up gets
   * a start date a fortnight out, because starting the run-up *now* is what
   * activating it means. Forward-only: a matter whose earliest step is `T+3d`
   * gets today rather than three days ago, since writing a past date into a file
   * on the strength of one button is a strange thing to do.
   *
   * **There is no `activated` field and no suspended flag.** The start date *is*
   * the state: no date means inactive, because `T±N` is not computable and so
   * nothing can generate. A periodic matter's anchor is the same thing, which is
   * why suspending one clears the anchor and leaves the interval.
   */
  async activate(id: string, today: DateKey): Promise<DateKey> {
    const found = await this.#find(id)
    const lead = Math.max(0, ...found.matter.steps.map(step =>
      (step.when.kind === 'at' ? -days(step.when.offset) : 0)))
    const start = addDays(today, lead)
    await this.#write(id, was => ({ ...was, when: { ...was.when, start } }))
    return start
  }

  /**
   * Stop work on a matter, keeping what it has already done.
   *
   * **Clearing the date IS the suspension**, which is what a deferred talk
   * actually is: *still happening, date to be decided*. Completed steps keep
   * their stamps, so an accidental activation is undoable and a genuine pause
   * resumes rather than restarts.
   *
   * A periodic matter keeps its interval and loses its anchor, so restarting it
   * later is one field again.
   */
  async suspend(id: string): Promise<void> {
    // **The shape stays and the date goes**, so a paused recurrence is one field
    // away from running again — and a matter with an interval and no start is
    // exactly that rather than a contradiction.
    await this.#write(id, was => ({ ...was, when: { ...was.when, start: null } }))
  }

  /**
   * Set the instances outright (H7, restored).
   *
   * **An alternative to the interval, so setting one clears the other.** Both
   * answer *when does it come round*; a matter holding both would have two
   * answers and no rule for which wins.
   *
   * **Sorted and de-duplicated on the way in**, because the list arrives pasted
   * out of a chat thread and nobody agrees sessions in order. `start` moves to
   * the first one that has not passed, which is what *the instance this is on*
   * means — and to the last one if they all have, so a finished campaign reads
   * as finished rather than as never having happened.
   */
  async setDates(id: string, dates: readonly DateKey[], today: DateKey): Promise<void> {
    const kept = [...new Set(dates)].sort()
    await this.#write(id, was => ({
      ...was,
      when: kept.length === 0
        ? { ...was.when, dates: null }
        : {
          ...was.when,
          dates: kept,
          every: null,
          start: kept.find(one => compareDateKeys(one, today) >= 0) ?? kept[kept.length - 1] ?? null,
        },
    }))
  }

  /**
   * Move a recurring matter on to its next instance.
   *
   * **The stored date is the NEXT one, not a first one years back**, which is
   * far easier to reason about and is what the surface shows — but it means
   * rolling forward one step at a time, and that is where a month drifts: the
   * 31st clamps to the 28th, and rolling again from *that* gives the 28th for
   * ever. So the roll is computed from the day the person meant, which the
   * interval carries whenever a clamp has hidden it.
   */
  async advanceInstance(id: string, from?: DateKey): Promise<DateKey | null> {
    const found = await this.#find(id)
    const { start, every, dates } = found.matter.when
    if (start === null) return null
    // **A listed recurrence steps to the next one written down**, and stops when
    // the list does. Running out is not an error — it is a campaign whose next
    // few sessions have not been agreed yet, which is exactly the state *no date
    // yet* already means, and which puts the matter back in front of somebody at
    // the moment they would know the answer.
    if (dates !== null) {
      const next = dates.find(one => one > start) ?? null
      await this.#write(id, was => ({
        ...was,
        when: { ...was.when, start: next },
        steps: was.steps.map(one => ({ ...one, done: null, made: null })),
      }))
      return next
    }
    if (every === null) return null
    // **`from` is what *every three months* is three months from**, and the two
    // repeating shapes answer that differently. A recurring EVENT is on the
    // calendar, so it counts from the instance that has just passed — which is
    // also the only way the anchor survives, since the intended day is what the
    // stored date carries. A recurring TASK counts from the day it was *done*:
    // an air filter sharpened six years late is next due six months from today,
    // not six months from a date in 2020 that would have it overdue again the
    // moment it was finished.
    const next = addInterval(from ?? start, every)
    await this.#write(id, was => ({
      ...was,
      when: { ...was.when, start: next.date, every: next.every },
      // **A new instance is a fresh one**: what was done, and what it put on
      // the list, both belonged to the last one.
      steps: was.steps.map(one => ({ ...one, done: null, made: null })),
    }))
    return next.date
  }

  /**
   * Rewrite the prose under a matter.
   *
   * **Replaced wholesale, not appended to**, which is the task list's shape for
   * the same reason: the surface edits a block of text and hands back what it
   * now says, so there is one path and no merge to get wrong. Empty lines are
   * dropped — a note of nothing is no note.
   */
  async setNotes(id: string, notes: readonly string[]): Promise<void> {
    const kept = notes.map(line => line.trim()).filter(line => line !== '')
    await this.#write(id, was => ({ ...was, notes: kept }))
  }

  /**
   * Take a matter off this docket, block and all.
   *
   * **The delete half of a move** (D71). The append half belongs to whoever is
   * moving it, because only they know where it is going — and the matter keeps
   * its id across the two, so its history stays continuous.
   */
  async remove(id: string): Promise<Matter> {
    const found = await this.#find(id)
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, found.from), end: this.at(ONLY_SEGMENT, found.end) },
      payload: '' as DocumentText,
    }], 'operation')
    return found.matter
  }

  /**
   * Put a matter that came from somewhere else onto this docket.
   *
   * **It keeps its id and loses nothing but its address.** `arrived` is stamped
   * afresh, because that is what it means: when this matter appeared *here*.
   */
  async adopt(matter: Matter): Promise<void> {
    const segment = await this.segment(ONLY_SEGMENT)
    const body = segment.body
    const gap = body === '' || body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n'
    const at = body.length
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, at), end: this.at(ONLY_SEGMENT, at) },
      payload: `${gap}${matterBlock({ ...matter, arrived: nowSeconds() })}\n` as DocumentText,
    }], 'operation')
  }

  /**
   * Somebody looked at this matter in a review and left it where it was.
   *
   * **The count accrues from the first review or the graveyard has no
   * criterion** (MH5 before MH6, deliberately): a threshold chosen against zero
   * data is the position the task list's soft cap has been stuck in since MT5c.
   */
  async decline(id: string): Promise<void> {
    await this.#write(id, was => ({ ...was, declines: was.declines + 1 }))
  }

  // ── sections (MH1) ─────────────────────────────────────────

  /**
   * Put a matter at a given place in the block order.
   *
   * **Stated as an order, not as two offsets, because the offsets were wrong.**
   * The first cut deleted the block and inserted it at the destination in one
   * `replace()` — two edits, and when the destination was the block's own
   * boundary they overlapped: *edit at 313 overlaps one ending at 416*, from
   * use, on the very first drag. The guard against it was an interval test that
   * had to be exactly right, and was not.
   *
   * So the order is rebuilt instead. Every block that is not moving is put back
   * **by its original bytes**, sliced out of the body it came from, which is
   * what keeps the byte-identical property that the format rests on; the one
   * that moves is written afresh, because it is being touched and its heading
   * depth may be changing. One edit, and no interval arithmetic to get wrong.
   */
  async #rearrange(id: string, target: number, level: number): Promise<void> {
    const body = (await this.segment(ONLY_SEGMENT)).body
    const blocks = await this.#blocks()
    const at = blocks.findIndex(b => b.kind === 'matter' && b.matter.id === id)
    const found = blocks[at]
    if (found === undefined || found.kind !== 'matter') {
      throw new Error(`${this.id} has no matter ${id}`)
    }
    const first = blocks[0]
    if (first === undefined) return
    const texts = blocks.map(b => body.slice(b.from, b.to))
    const rest = texts.filter((_, n) => n !== at)
    // The target is given in the ORIGINAL order, so taking the block out of the
    // list shifts everything after it down by one.
    const to = target > at ? target - 1 : target
    if (to === at && level === found.level) return // already where it is going
    const ordered = [...rest.slice(0, to), matterBlock(found.matter, level), ...rest.slice(to)]
    const payload = `${ordered.join('\n\n')}\n`
    if (payload === body.slice(first.from)) return
    await this.replace([{
      span: {
        begin: this.at(ONLY_SEGMENT, first.from),
        end: this.at(ONLY_SEGMENT, body.length),
      },
      payload: payload as DocumentText,
    }], 'operation')
  }

  /** Which block index is *the end of this section*. */
  #endIndex(section: string, blocks: readonly ScannedBlock[]): number {
    if (section === '') {
      const first = blocks.findIndex(b => b.kind === 'section')
      return first < 0 ? blocks.length : first
    }
    const start = blocks.findIndex(b => b.kind === 'section' && b.name === section)
    if (start < 0) throw new Error(`${this.id} has no section called ${section}`)
    const next = blocks.slice(start + 1).findIndex(b => b.kind === 'section')
    return next < 0 ? blocks.length : start + 1 + next
  }

  /** Where a section's matters end — the next section heading, or the end. */
  async #endOf(section: string): Promise<{ at: number; level: number }> {
    const blocks = await this.#blocks()
    const body = (await this.segment(ONLY_SEGMENT)).body
    if (section === '') {
      // The unnamed run is everything above the first heading.
      const first = blocks.find(b => b.kind === 'section')
      return { at: first?.from ?? body.length, level: MATTER_LEVEL }
    }
    const start = blocks.findIndex(b => b.kind === 'section' && b.name === section)
    if (start < 0) throw new Error(`${this.id} has no section called ${section}`)
    const next = blocks.slice(start + 1).find(b => b.kind === 'section')
    return { at: next?.from ?? body.length, level: MATTER_LEVEL + 1 }
  }

  /**
   * Add a section, at the end.
   *
   * **At the end and empty, because that is the gesture**: somebody says *we
   * should have one for major projects* and then puts things in it. Inserting it
   * anywhere else would be guessing at an order nobody has given yet, and
   * sections can be reordered by moving their matters.
   */
  async addSection(name: string): Promise<string> {
    const said = name.trim()
    if (said === '') throw new Error('a section needs a name')
    if ((await this.sections()).some(s => s.name === said)) {
      throw new Error(`this docket already has a section called ${said}`)
    }
    const body = (await this.segment(ONLY_SEGMENT)).body
    const gap = body === '' || body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n'
    const at = body.length
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, at), end: this.at(ONLY_SEGMENT, at) },
      payload: `${gap}${sectionHeading(said)}\n` as DocumentText,
    }], 'operation')
    return said
  }

  async renameSection(name: string, to: string): Promise<void> {
    const said = to.trim()
    if (said === '') throw new Error('a section needs a name')
    const found = (await this.#blocks()).find(b => b.kind === 'section' && b.name === name)
    if (found === undefined) throw new Error(`${this.id} has no section called ${name}`)
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, found.from), end: this.at(ONLY_SEGMENT, found.to) },
      payload: sectionHeading(said) as DocumentText,
    }], 'operation')
  }

  /**
   * Take a section heading away and keep everything that was under it.
   *
   * **Deleting a heading must never delete a house.** The matters stay exactly
   * where they are in the file and join whatever now contains them — the section
   * above, or the undivided run at the top — and they are re-written only to fix
   * their heading depth, so the outline stays true. A section is a way of
   * reading, so removing one is a reading change and nothing else.
   */
  async removeSection(name: string): Promise<void> {
    const blocks = await this.#blocks()
    const which = blocks.findIndex(b => b.kind === 'section' && b.name === name)
    const found = blocks[which]
    if (found === undefined || found.kind !== 'section') {
      throw new Error(`${this.id} has no section called ${name}`)
    }
    const body = (await this.segment(ONLY_SEGMENT)).body
    const gapEnd = blocks[which + 1]?.from ?? body.length
    // Whatever contains them now decides how deep they are written.
    const above = blocks.slice(0, which).filter(b => b.kind === 'section')
    const level = above.length > 0 ? MATTER_LEVEL + 1 : MATTER_LEVEL
    const orphans: ScannedMatter[] = []
    for (const block of blocks.slice(which + 1)) {
      if (block.kind === 'section') break
      orphans.push(block)
    }
    await this.replace([
      {
        span: { begin: this.at(ONLY_SEGMENT, found.from), end: this.at(ONLY_SEGMENT, gapEnd) },
        payload: '' as DocumentText,
      },
      ...orphans
        .filter(m => m.level !== level)
        .map(m => ({
          span: { begin: this.at(ONLY_SEGMENT, m.from), end: this.at(ONLY_SEGMENT, m.to) },
          payload: matterBlock(m.matter, level) as DocumentText,
        })),
    ], 'operation')
  }

  /**
   * Put a matter in a section — `''` for the undivided run at the top.
   *
   * At the end of that section, or immediately before `before` if one is named,
   * which is how *put this above that one* is expressed.
   */
  async moveMatter(id: string, section: string, before?: string): Promise<void> {
    const blocks = await this.#blocks()
    const level = section === '' ? MATTER_LEVEL : MATTER_LEVEL + 1
    // Throws on a section that is not there, which is the check `#endIndex` does
    // anyway — kept ahead of the work so nothing is half done.
    const end = this.#endIndex(section, blocks)
    if (before === undefined) {
      await this.#rearrange(id, end, level)
      return
    }
    const target = blocks.findIndex(b => b.kind === 'matter' && b.matter.id === before)
    if (target < 0) throw new Error(`${this.id} has no matter ${before}`)
    await this.#rearrange(id, target, level)
  }

  /**
   * Move a matter one place up or down **inside its own section**.
   *
   * **The gesture is relative because the intention is** — *this one first* —
   * and stopping at the section edge is the point rather than a limitation:
   * nudging a matter out of *periodic maintenance* and into *major projects* by
   * pressing the same key one more time would be a reclassification nobody
   * asked for. Crossing a boundary is `moveMatter`, which says where.
   *
   * Answers whether it moved, so a surface can leave the control alone at the
   * ends instead of offering a gesture that does nothing.
   */
  async nudgeMatter(id: string, delta: number): Promise<boolean> {
    if (delta === 0) return false
    const blocks = await this.#blocks()
    const which = blocks.findIndex(b => b.kind === 'matter' && b.matter.id === id)
    if (which < 0) throw new Error(`${this.id} has no matter ${id}`)
    const found = blocks[which] as ScannedBlock & { kind: 'matter' }
    // Its own section: the run of matters bounded by section headings either way.
    let first = which
    while (first > 0 && (blocks[first - 1] as ScannedBlock).kind === 'matter') first -= 1
    let last = which
    while (last + 1 < blocks.length && (blocks[last + 1] as ScannedBlock).kind === 'matter') last += 1
    const wanted = which + (delta < 0 ? -1 : 1)
    if (wanted < first || wanted > last) return false
    // Up: take the neighbour's place. Down: the place after it — and note that
    // `wanted` is ALREADY one past `which`, so this is +1 and not +2. It was
    // +2 for one run, which moved a matter two places on every downward nudge.
    await this.#rearrange(id, delta < 0 ? wanted : wanted + 1, found.level)
    return true
  }

  // ── the two that make new documents, which this kind does not ──

  async branch(_span: Span, _name: string): Promise<DocumentId> {
    throw new Error('branching out of a docket is not built yet')
  }

  async importText(): Promise<string> {
    throw new Error('importing into a docket is not built yet')
  }
}

export { parseMatter }

/**
 * An offset in days, for ordering only.
 *
 * **Approximate on purpose.** A month is thirty days here, which is wrong as a
 * date and right as a sort key: the question is only *which of these fires
 * first*, and nothing is computed from this. When MH3 turns an offset into a
 * date it will do it against a real calendar.
 */
/**
 * What to say about a schedule this cannot read.
 *
 * **It lists the forms, because there is nowhere else to learn them** — asked
 * from use, in as many words: *how do I even figure out what the allowable
 * grammar is?* And it says the specific thing when the word was `then` with
 * nothing above it, since *the forms are these* would be a misleading answer to
 * a schedule that is right everywhere but here.
 */
/**
 * An index or an id as typed, to a step's real id.
 *
 * **Indices are what the surface shows and ids are what the file holds**, and
 * this is the one place the two meet. *After 1* was parsing before this existed
 * — `1` matched the id pattern — and storing a pointer to nothing, so the step
 * waiting on it would simply never have come due.
 *
 * One-based, because that is what is on the screen. A pure-digit token shorter
 * than an id is an index; anything else has to already be an id **on this
 * matter**, which is what stops a reference to a step on some other one.
 */
const pointer = (steps: readonly Step[]) => (token: string): string | null => {
  if (/^\d{1,3}$/.test(token)) return steps[Number(token) - 1]?.id ?? null
  return steps.some(one => one.id === token) ? token : null
}

function unreadable(said: string, first: boolean): string {
  if (first && /^then\b/i.test(said.trim())) {
    return 'there is no step above this one for `then` to follow'
  }
  return `${said} is not a schedule like 2w, +3d, right away, then, or after step 1`
}

const PER = { d: 1, w: 7, m: 30, y: 365 } as const

/**
 * Steps in the order they will happen, as far as that is knowable.
 *
 * **A dependent step has no offset to sort by** — its moment is only knowable
 * relative to its antecedent — so it takes its antecedent's place and sits just
 * behind it. Chains therefore read top to bottom, which is how somebody wrote
 * them, and a stray dependency on a step that is not there keeps its position
 * rather than being dropped.
 */
function order(steps: readonly Step[]): readonly Step[] {
  const at = (step: Step): number => (step.when.kind === 'at' ? days(step.when.offset) : NaN)
  const scored = new Map<string, number>()
  for (const step of steps) if (step.id !== null) scored.set(step.id, at(step))
  const key = (step: Step, n: number): [number, number] => {
    const own = at(step)
    if (!Number.isNaN(own)) return [own, n]
    const anchor = step.when.kind === 'after' ? scored.get(step.when.step) : undefined
    return [anchor === undefined || Number.isNaN(anchor) ? Infinity : anchor, n + 0.5]
  }
  return [...steps]
    .map((step, n) => ({ step, k: key(step, n) }))
    .sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] - b.k[1]))
    .map(one => one.step)
}

function days(offset: string): number {
  const found = /^([+-])(\d+)([dwmy])$/.exec(offset)
  if (found === null) return 0
  const size = PER[found[3] as keyof typeof PER]
  return Number(found[2]) * size * (found[1] === '-' ? -1 : 1)
}
