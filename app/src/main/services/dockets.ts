// **The standing store of the agenda** (D84). Depends on `CorpusService`,
// `DurabilityService`, `DayService` and `FixedPoints`.
//
// A docket: the standing list of what is true about a domain, and every verb
// that changes one (MH1, D68, D75, D76, D80).
//
// **Formats and files, and nothing above them.** This is one of the agenda's two
// stores — the *standing* form, where a step says what happens and when. What
// follows from a step is `AgendaService`'s: this one writes dockets and reports
// that it did, and has never heard of a task.
//
// **A matter is a heading with things under it.** Its schedule says when it comes
// round, its steps say what happens and in what order, and nothing here sorts
// itself: the order is the one somebody arranged (D75).
//
// **Nothing here crosses to the asked form.** Generating a task from a step,
// taking a completion back to the step that asked for it, and moving a task down
// onto a docket are all operations on the *pair*, so they belong to the construct
// and not to either store (D84).

import type { CorpusService } from './corpus-service.ts'
import type { DurabilityService } from './durability-service.ts'
import type { DayService } from './day-service.ts'
import type { FixedPoints } from './fixed-point.ts'
import type { DocketDocument } from '../x/documents/kinds/docket.ts'
import {
  MODES, parseInterval, spellInterval, spellStepWhen, UNSCHEDULED,
  type Matter, type Mode, type NewMatter, type Schedule, type Section, type StepKind,
} from '../../shared/kinds/docket.ts'
import { asDateKey } from '../../shared/dates.ts'
import { nameOf } from '../../shared/slug.ts'
import type { DateKey, DocumentId } from '../../shared/document-api.ts'
import { ONLY_SEGMENT } from '../../shared/document-api.ts'
import type { DocketRow } from '../../shared/ipc.ts'

export class Dockets {
  readonly #store: CorpusService
  readonly #durable: DurabilityService
  readonly #day: DayService
  readonly #fixed: FixedPoints

  constructor(
    store: CorpusService,
    durable: DurabilityService,
    day: DayService,
    fixed: FixedPoints,
  ) {
    this.#store = store
    this.#durable = durable
    this.#day = day
    this.#fixed = fixed
  }


  /** A turn in the one mutation queue. */
  #mutate<T>(work: () => Promise<T>): Promise<T> {
    return this.#store.mutate(work)
  }

  #touched(): void {
    this.#durable.touched()
  }



  // ── dockets (MH1, D68) ─────────────────────────────────────

  /**
   * Every docket, by title.
   *
   * **Derived from the directory, not from a list somebody maintains** — the
   * same rule the sidebar's directory sections follow: a docket is there because
   * its file is there, which cannot be wrong.
   */
  async all(): Promise<readonly DocketRow[]> {
    const ids = await this.#store.corpus.list('docket')
    const rows = await Promise.all(ids.map(async id => ({
      id,
      // **What it is CALLED, falling back to what it is named.** The frontmatter
      // title is the person's words; the filename is a slug of them and the only
      // other name a document has (D59's rule, as `info()` applies it).
      title: (await this.#store.corpus.use(id, doc => doc.titleOf(ONLY_SEGMENT))) ?? nameOf(id as string),
    })))
    return rows.sort((a, b) => a.title.localeCompare(b.title))
  }
  async matters(id: DocumentId): Promise<readonly Matter[]> {
    return this.#store.corpus.use(id, doc => (doc as DocketDocument).matters())
  }

  /**
   * Put a matter on a docket.
   *
   * **`when` arrives as text, and is parsed here.** The notation is the one a
   * person types into the field — `2026-11-12`, `every 90d`, nothing at all —
   * and the renderer has no business owning a second copy of it (T16's rule,
   * applied to a second grammar).
   */
  async add(
    id: DocumentId,
    name: string,
    shape?: NewMatter,
    section?: string,
  ): Promise<string> {
    const when = scheduleFor(shape)
    const made = await this.#mutate(async () =>
      this.#store.corpus.use(id, doc =>
        (doc as DocketDocument).add(name, when, this.#takenMatterIds, section, shape?.mode)),
    )
    // **The template's first step, made here rather than by the caller.** The
    // shape and the step it implies are one decision — *something happening*
    // means a reminder on the day, *something to get done* means a task when
    // work starts — so they are one call, and a matter cannot come into being
    // half-shaped.
    const mode = MODES.find(one => one.key === shape?.mode)
    if (mode !== undefined) {
      const first = await this.#mutate(async () =>
        this.#store.corpus.use(id, doc =>
          (doc as DocketDocument).addStep(made, '+0d', name, mode.kind)))
      // A recurring task measures from a step being done, and on a matter one
      // step old there is only one it could be.
      if (mode.fromCompletion && shape?.every !== undefined) {
        await this.#mutate(async () =>
          this.#store.corpus.use(id, doc => (doc as DocketDocument).setAfter(made, first)))
      }
    }
    await this.#durable.wrote(id)
    return made
  }

  /** Change what kind of thing a matter is — the four a person chooses between. */
  async setMode(id: DocumentId, matter: string, mode: Mode): Promise<void> {
    if (!MODES.some(one => one.key === mode)) {
      throw new Error(`${mode} is not one of the four kinds of matter`)
    }
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).setMode(matter, mode)))
    await this.#durable.wrote(id)
  }

  /** The date of the next instance, or none — which is the whole of *inactive*. */
  async setStart(id: DocumentId, matter: string, start: string | null): Promise<void> {
    const said = start === null || start.trim() === '' ? null : asDateKey(start.trim())
    if (start !== null && start.trim() !== '' && said === null) {
      throw new Error(`${start} is not a date`)
    }
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).setStart(matter, said)))
    await this.#durable.wrote(id)
  }

  /** How often it comes round. `every` as typed: `90d`, `1m on 31`, or nothing. */
  async setEvery(id: DocumentId, matter: string, every: string | null): Promise<void> {
    const said = every === null || every.trim() === '' ? null : parseInterval(every)
    if (every !== null && every.trim() !== '' && said === null) {
      throw new Error(`${every} is not an interval like 90d, 6 months, or 1m on 31`)
    }
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).setEvery(matter, said)))
    await this.#durable.wrote(id)
  }

  /** Which step's completion starts the next instance, or none (D76, Qa). */
  async setAfter(id: DocumentId, matter: string, after: string | null): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).setAfter(matter, after)))
    await this.#durable.wrote(id)
  }

  /** Move a recurring matter on to its next instance. */
  async advance(id: DocumentId, matter: string): Promise<DateKey | null> {
    const next = await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).advanceInstance(matter)))
    if (next !== null) this.#touched()
    return next
  }
  async rename(id: DocumentId, matter: string, name: string): Promise<void> {
    await this.#mutate(async () => this.#store.corpus.use(id, doc => (doc as DocketDocument).rename(matter, name)))
    await this.#durable.wrote(id)
  }
  async setOwner(id: DocumentId, matter: string, owner: string | null): Promise<void> {
    await this.#mutate(async () => this.#store.corpus.use(id, doc => (doc as DocketDocument).setOwner(matter, owner)))
    await this.#durable.wrote(id)
  }
  async setLink(id: DocumentId, matter: string, link: string | null): Promise<void> {
    await this.#mutate(async () => this.#store.corpus.use(id, doc => (doc as DocketDocument).setLink(matter, link)))
    await this.#durable.wrote(id)
  }
  async tag(id: DocumentId, matter: string, subject: string): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).tagMatter(matter, subject)))
    await this.#durable.wrote(id)
  }
  async untag(id: DocumentId, matter: string, subject: string): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).untagMatter(matter, subject)))
    await this.#durable.wrote(id)
  }

  /** The prose under a matter. Nothing in it is parsed (D56's rule, carried). */
  async setNotes(id: DocumentId, matter: string, notes: readonly string[]): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).setNotes(matter, notes)))
    await this.#durable.wrote(id)
  }

  // ── sections on a docket (MH1) ──────────────────────────────

  /** The docket divided into its sections, which is how it is read. */
  async sections(id: DocumentId): Promise<readonly Section[]> {
    return this.#store.corpus.use(id, doc => (doc as DocketDocument).sections())
  }
  async addSection(id: DocumentId, name: string): Promise<string> {
    const made = await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).addSection(name)))
    await this.#durable.wrote(id)
    return made
  }
  async renameSection(id: DocumentId, name: string, to: string): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).renameSection(name, to)))
    await this.#durable.wrote(id)
  }

  /** Take the heading away and keep everything that was under it. */
  async removeSection(id: DocumentId, name: string): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).removeSection(name)))
    await this.#durable.wrote(id)
  }

  /**
   * A whole section one place up or down among the others. False at the ends.
   *
   * **Nothing derived depends on the order of sections**, which is why this
   * touches without reconciling: the reading changes and the generated tasks do
   * not. Same as `nudgeMatter`, for the same reason.
   */
  async nudgeSection(id: DocumentId, name: string, delta: number): Promise<boolean> {
    const moved = await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).nudgeSection(name, delta)))
    if (moved) this.#touched()
    return moved
  }

  /**
   * Move a matter to another docket (MH5).
   *
   * **Written whole and then removed**, which is the same shape the move from
   * the task list has: the thing exists in the new place before it stops
   * existing in the old one, so a failure between the two leaves a duplicate
   * rather than a hole. A duplicate is visible and correctable; a hole is not.
   *
   * **A new id in the new docket**, because a matter's id is unique across the
   * corpus and the old block is going away — what travels is the matter, not its
   * name in a file. What it was moved from travels too, so the trail survives.
   */
  async moveTo(from: DocumentId, matter: string, to: DocumentId): Promise<string | null> {
    if (from === to) return matter
    const found = (await this.matters(from)).find(one => one.id === matter)
    if (found === undefined) return null

    const made = await this.add(to, found.name, { mode: found.mode })
    for (const tag of found.tags) await this.tag(to, made, tag)
    if (found.owner !== null) await this.setOwner(to, made, found.owner)
    if (found.link !== null) await this.setLink(to, made, found.link)
    if (found.notes.length > 0) await this.setNotes(to, made, found.notes)
    // **By index, not by id**, since every step is being made afresh: an `after`
    // pointing at the old docket's id would point at nothing. `spellStepWhen`
    // already renders the index when given one, and `addStep` reads it back.
    const place = (id: string): number | null => {
      const at = found.steps.findIndex(one => one.id === id)
      return at < 0 ? null : at + 1
    }
    for (const step of found.steps.slice(1)) {
      await this.addStep(to, made, spellStepWhen(step.when, place), step.text, step.kind)
    }
    if (found.when.start !== null) await this.setStart(to, made, found.when.start)
    if (found.when.every !== null) await this.setEvery(to, made, spellInterval(found.when.every))
    if (found.when.dates !== null) await this.setDates(to, made, found.when.dates)
    if (found.from !== null) {
      await this.#mutate(async () =>
        this.#store.corpus.use(to, doc => (doc as DocketDocument).cameFrom(made, found.from as string)))
    }

    await this.remove(from, matter)
    await this.#durable.wrote(to)
    return made
  }

  /** Into a section — `''` is the undivided run — optionally above one matter. */
  async moveMatter(
    id: DocumentId,
    matter: string,
    section: string,
    before?: string,
  ): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).moveMatter(matter, section, before)))
    await this.#durable.wrote(id)
  }

  /** One place up or down inside its own section. False at the ends. */
  async nudgeMatter(id: DocumentId, matter: string, delta: number): Promise<boolean> {
    const moved = await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).nudgeMatter(matter, delta)))
    if (moved) this.#touched()
    return moved
  }

  /**
   * A step on a matter: *at this moment, this happens* (H4, D76).
   *
   * **The schedule arrives as text and is parsed here**, the same rule the
   * `when` field follows: the notation is what a person types — `2w`, `+3d`,
   * `right away`, `after <step>` — and the renderer has no business owning a
   * second copy of it (T16's rule, applied to a third grammar).
   */
  async addStep(
    id: DocumentId,
    matter: string,
    when: string,
    text: string,
    kind?: StepKind,
  ): Promise<string> {
    const made = await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).addStep(matter, when, text, kind)))
    await this.#durable.wrote(id)
    return made
  }

  /** Fix what a step says, keeping its id and its completion stamp. */
  async editStep(
    id: DocumentId,
    matter: string,
    step: string,
    text: string,
  ): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).editStep(matter, step, text)))
    await this.#durable.wrote(id)
  }

  /** Reschedule one step. `when` as typed, parsed here. */
  async setStepWhen(
    id: DocumentId,
    matter: string,
    step: string,
    when: string,
  ): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).setStepWhen(matter, step, when)))
    await this.#durable.wrote(id)
  }

  /** Change a step's kind — the only way to author a `reschedule` (D76). */
  async setStepKind(
    id: DocumentId,
    matter: string,
    step: string,
    kind: StepKind,
  ): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).setStepKind(matter, step, kind)))
    await this.#durable.wrote(id)
  }
  async removeStep(id: DocumentId, matter: string, step: string): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).removeStep(matter, step)))
    await this.#durable.wrote(id)
  }

  /** Stamp a step done, or undo that. What a dependency reads (D76). */
  async completeStep(
    id: DocumentId,
    matter: string,
    step: string,
    done: boolean,
  ): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc =>
        (doc as DocketDocument).completeStep(matter, step, done ? this.#day.moment : null)))
    await this.#durable.wrote(id)
  }

  /**
   * Start work on a matter — the start date that makes its first step due today.
   *
   * **Today comes from the service, not the document**, because the clock is the
   * service's (D62/D63) and a document that read one would be a second source of
   * truth about what day it is.
   */
  async activate(id: DocumentId, matter: string): Promise<DateKey> {
    const when = await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).activate(matter, this.#day.today)))
    await this.#durable.wrote(id)
    return when
  }

  /** The instances, listed outright — an alternative to the interval (H7). */
  async setDates(id: DocumentId, matter: string, dates: readonly DateKey[]): Promise<void> {
    const today = this.#day.today
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).setDates(matter, dates, today)))
    await this.#durable.wrote(id)
  }

  /** Stop work on it, keeping what it has already done (D76). */
  async suspend(id: DocumentId, matter: string): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as DocketDocument).suspend(matter)))
    // **And then reconciled, rather than withdrawing by hand.** Suspending is
    // only *clear the start date*; what follows from that — the task it put on
    // the list no longer being wanted — is something the pass already knows how
    // to work out. One rule about what should be true, instead of a bespoke undo
    // beside every verb that could make it false.
    //
    // **`#wrote` is what does it**, and this line used to call `reconcile()`
    // again afterwards. That was right when only listed verbs reconciled; since
    // every docket write reports its key and waits for the pass (D83), the
    // second call was doing the work twice — and it was the last thing keeping
    // this verb from being an ordinary one.
    await this.#durable.wrote(id)
  }
  async remove(id: DocumentId, matter: string): Promise<void> {
    await this.#mutate(async () => this.#store.corpus.use(id, doc => (doc as DocketDocument).remove(matter)))
    await this.#durable.wrote(id)
  }

  /**
   * The move: off one docket and onto another, keeping the id (D71).
   *
   * **Both halves in one serialised turn**, because a matter that is out of the
   * first and not yet in the second exists nowhere, and a crash in the gap loses
   * it. The id surviving is the whole promise — history stays continuous and a
   * reference still resolves.
   */
  async move(id: DocumentId, matter: string, to: DocumentId): Promise<void> {
    await this.#mutate(async () => {
      const taken = await this.#store.corpus.use(id, doc => (doc as DocketDocument).remove(matter))
      await this.#store.corpus.use(to, doc => (doc as DocketDocument).adopt(taken))
    })
    await this.#durable.wrote(id)
  }

  /**
   * Matter ids taken anywhere in the corpus.
   *
   * **Every docket, because an id names a matter and not a docket** — the same
   * reason the task list reads every list. Scanned rather than indexed: a few
   * hundred matters over a lifetime is not a thing to build an index for
   * (`solution/parts/horizon.md`), and the index would be the second copy of a truth
   * the files already hold.
   */
  readonly #takenMatterIds = async (): Promise<ReadonlySet<string>> => {
    const out = new Set<string>()
    for (const id of await this.#store.corpus.list('docket')) {
      for (const matter of await this.matters(id)) {
        if (matter.id !== null) out.add(matter.id)
      }
    }
    return out
  }
}

/**
 * What *Add a matter* asked for, as the three variables.
 *
 * **The mode is spent here and never stored** (D76, amended). It decides the
 * shape of the schedule and the kind of the first step, and after that a matter
 * is described entirely by `start`, `every` and `after` — so a job that later
 * gets a date does not have to be relabelled as an event, because there is no
 * label. A dated shape with no date given is simply not started yet, which is a
 * state the model already had.
 */
function scheduleFor(shape: NewMatter | undefined): Schedule {
  if (shape === undefined) return UNSCHEDULED
  const mode = MODES.find(one => one.key === shape.mode)
  if (mode === undefined) throw new Error(`${shape.mode} is not one of the four kinds of matter`)
  const given = (said: string | undefined): string | null =>
    said === undefined || said.trim() === '' ? null : said.trim()
  const start = given(shape.start) === null ? null : asDateKey(given(shape.start) as string)
  if (given(shape.start) !== null && start === null) {
    throw new Error(`${shape.start} is not a date`)
  }
  const every = given(shape.every) === null ? null : parseInterval(given(shape.every) as string)
  if (mode.repeating && given(shape.every) !== null && every === null) {
    throw new Error(`${shape.every} is not an interval like 90d, 6 months, or 1m on 31`)
  }
  return {
    start,
    every: mode.repeating ? every : null,
    // Set once the first step exists, since it names one (see `add`).
    after: null,
    dates: null,
  }
}
