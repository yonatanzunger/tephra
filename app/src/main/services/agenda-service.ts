// **The agenda: one construct with two forms** (D84).
//
// The dockets and the task list are not two domains. They are two forms of one
// thing — **standing** (a step on a matter: what is true about a domain) and
// **asked** (an item on a list: what is being requested of somebody now) — and
// `Dockets` and `Tasks` are the stores for each. This is the construct itself.
//
// The evidence that settled it was three stored cross-references running **both**
// ways: `Step.made` names the item a step generated, `TodoItem.moved` names the
// docket an item went to, and `Matter.from` names the task a matter came from.
// Two stores each holding references into the other is one entity split across
// two tables.
//
// ## Three faces
//
// - **make it true** — `reconcile`, and the pass registered with `FixedPoints`.
//   This is the *projection function* from standing to asked, which is why
//   reconciliation exists at all and why it is not an integration between two
//   systems (D77).
// - **change it** — `todoSetStatus` and `todoBulk` (resolving an item stamps the
//   step that asked for it), `todoPutDown` (an item becomes a matter). Each is an
//   operation on the **pair**, which is why D79's three acts were so hard to site
//   while we were trying to put them on one side or the other.
// - **ask it** — `horizon`, `matterFor`. The questions neither store can answer
//   alone.
//
// **It declares the user-facing verbs**, both unions, because it is the only
// thing that can answer all of either: two arms of the task list's union and the
// whole of reconciliation span both forms. Most of the docket's arms are one-line
// delegations to a store, paid on purpose — they are the agenda's verbs which
// happen to be implemented by a store today, and one that later has to touch the
// task list changes here without the channel moving.
//
// **The stores never learn this exists.** A store writes; the corpus reports the
// key; `FixedPoints` wakes the pass. So `Dockets` holds no reference to `Tasks`,
// and neither to this — the projection is driven entirely by *lower things emit,
// higher things subscribe* (D83).
//
// **Later:** MH5's review flow and MH6's graveyard belong here, being features of
// the construct rather than of the docket. *Backlogged* means standing but not
// asked, which is a form and not a place; the graveyard is another form.

import { inHorizon, orderHorizon, type HorizonRow, type HorizonWindow } from '../../shared/horizon-api.ts'
import { isOutside, isStream, BACKLOG_DOCKET, ONLY_SEGMENT, TASKS_ID, type Unsubscribe } from '../../shared/document-api.ts'
import type { DateKey, DocumentId, DocumentPosition, DocumentText, SegmentKey, Span, TypedSpan, VersionId } from '../../shared/document-api.ts'
import { nameOf } from '../../shared/slug.ts'
import { spellTag } from '../../shared/tags.ts'
import { flattenLinks } from '../../shared/links.ts'
import { plainLine } from '../../shared/plain.ts'
import { DocketDocument } from '../x/documents/kinds/docket.ts'
import { TodoDocument } from '../x/documents/kinds/todo.ts'
import { isLive, readDue, RESOLVED_DAYS, shortLine, spellOwner } from '../../shared/kinds/todo.ts'
import type { ResolvedItem, TodoItem, TodoStatus, WalkState } from '../../shared/kinds/todo.ts'
import { basename, isAbsolute, join } from 'node:path'
import { addDays, asDateKey, compareDateKeys, dateKeyAt } from '../../shared/dates.ts'
import type { CorpusIndex } from '../x/documents/corpus-index.ts'
import { documentKey, ASKED_KEY } from './change-keys.ts'
import { isArchive, type RelPath } from '../w/layout.ts'
import { Dockets } from './dockets.ts'
import type { CorpusService } from './corpus-service.ts'
import type { DurabilityService } from './durability-service.ts'
import type { DayService } from './day-service.ts'
import type { FixedPoints, RunReport } from './fixed-point.ts'
import type { Dockets as DocketStore } from './dockets.ts'
import type { Tasks } from './tasks.ts'
import { serve, serveKinds, type Served, type Serves } from './serves.ts'
import { dueOn, endOf, isFinished, statusPassed, matterHorizon, addInterval, backInterval, instancesIn, NOT_STARTED, type Matter, type Section, type Step } from '../../shared/kinds/docket.ts'
import { CHANNEL, type DocketCommand, type TodoCommand } from '../../shared/ipc.ts'

export class AgendaService implements Serves {
  readonly #store: CorpusService
  readonly #durable: DurabilityService
  readonly #day: DayService
  readonly #fixed: FixedPoints
  /** The standing store (D84). */
  readonly #docket: DocketStore
  /** The asked store (D84). */
  readonly #todo: Tasks

  constructor(
    store: CorpusService,
    durable: DurabilityService,
    day: DayService,
    fixed: FixedPoints,
    dockets: DocketStore,
    tasks: Tasks,
  ) {
    this.#store = store
    this.#durable = durable
    this.#day = day
    this.#fixed = fixed
    this.#docket = dockets
    this.#todo = tasks
    this.#registerReconcilers()
  }

  /**
   * Told what each reconciliation run did — for the log, and for a run that
   * would not settle (D83).
   */
  onReconciled(told: (report: RunReport) => void): Unsubscribe {
    return this.#fixed.onRun(told)
  }

  /** The most rounds any one key has needed, so the limit can be argued about. */
  get reconciliationHighWater(): number {
    return this.#fixed.highWater
  }

  /**
   * The task list's channel — declared here, and not by `Tasks`.
   *
   * **A channel belongs to the service that can answer all of it**, and four of
   * these fifteen arms cannot live in the task list's service: `status` and
   * `bulk` have to tell the step that asked for an item that it is done,
   * `putDown` has to make a matter, and `matterFor` means reading every docket.
   * All four span two domains and sit above both (D83) — so the union spans
   * tiers, and it belongs to the tier that can serve the whole of it.
   *
   * `serveKinds`'s exhaustiveness is what makes that a fact rather than a
   * preference: a service declaring this channel is *required* to handle every
   * kind, so one that cannot reach those four could not declare it at all.
   *
   * **The docket's union is declared here too**, for the same reason stated the
   * other way round: a channel is what the renderer has a name for, so it is the
   * construct's and not a store's (D84). Most of its arms are one-line
   * delegations, paid on purpose.
   */
  serves(): readonly Served[] {
    return [
      // Reconciliation's own door, off the docket's union (D77, D83).
      serve(CHANNEL.reconcile, () => this.reconcile()),
      // **The third face, which was answered in `ipc.ts` until now** (D84): make
      // it true, change it, **ask it**. The handler there was a bare forward
      // into this method — the only one of the three the composite did not
      // declare, and for no reason beyond the order the extractions happened in.
      serve(CHANNEL.horizon, (from: DateKey, to: DateKey) => this.horizon(from, to)),
      serveKinds<DocketCommand>(CHANNEL.docket, {
      list: () => this.#docket.all(),
      matters: command => this.#docket.matters(command.docket),
      archive: command => this.#docket.archive(command.docket),
      fileMatter: command => this.#docket.archiveMatter(command.docket, command.matter),
      add: command => this.#docket.add(command.docket, command.name, command.shape, command.section),
      rename: command => this.#docket.rename(command.docket, command.matter, command.name),
      mode: command => this.#docket.setMode(command.docket, command.matter, command.mode),
      start: command => this.#docket.setStart(command.docket, command.matter, command.start),
      until: command => this.#docket.setUntil(command.docket, command.matter, command.until),
      moveTo: command => this.#docket.moveTo(command.docket, command.matter, command.to),
      dates: command => this.#docket.setDates(command.docket, command.matter, command.dates),
      every: command => this.#docket.setEvery(command.docket, command.matter, command.every),
      after: command => this.#docket.setAfter(command.docket, command.matter, command.after),
      advance: command => this.#docket.advance(command.docket, command.matter),
      owner: command => this.#docket.setOwner(command.docket, command.matter, command.owner),
      link: command => this.#docket.setLink(command.docket, command.matter, command.link),
      tag: command => this.#docket.tag(command.docket, command.matter, command.subject),
      untag: command => this.#docket.untag(command.docket, command.matter, command.subject),
      remove: command => this.#docket.remove(command.docket, command.matter),
      notes: command => this.#docket.setNotes(command.docket, command.matter, command.notes),
      addStep: command => this.#docket.addStep( command.docket, command.matter, command.when, command.text, command.stepKind, ),
      editStep: command => this.#docket.editStep( command.docket, command.matter, command.step, command.text, ),
      stepWhen: command => this.#docket.setStepWhen( command.docket, command.matter, command.step, command.when, ),
      stepKind: command => this.#docket.setStepKind( command.docket, command.matter, command.step, command.stepKind, ),
      removeStep: command => this.#docket.removeStep(command.docket, command.matter, command.step),
      completeStep: command => this.#docket.completeStep( command.docket, command.matter, command.step, command.done, ),
      activate: command => this.#docket.activate(command.docket, command.matter),
      suspend: command => this.#docket.suspend(command.docket, command.matter),
      sections: command => this.#docket.sections(command.docket),
      addSection: command => this.#docket.addSection(command.docket, command.name),
      renameSection: command => this.#docket.renameSection(command.docket, command.name, command.to),
      removeSection: command => this.#docket.removeSection(command.docket, command.name),
      nudgeSection: command => this.#docket.nudgeSection(command.docket, command.name, command.delta),
      place: command => this.#docket.moveMatter( command.docket, command.matter, command.section, command.before, ),
      nudge: command => this.#docket.nudgeMatter(command.docket, command.matter, command.delta),
      move: command => this.#docket.move(command.docket, command.matter, command.to),
      }),
      serveKinds<TodoCommand>(CHANNEL.todo, {
      list: () => this.#todo.list(),
      today: command => this.#todo.today(command.list),
      items: command => this.#todo.items(command.list, command.date),
      add: command => this.#todo.add(command.list, command.text),
      status: command => this.todoSetStatus(command.list, command.item, command.status, command.note),
      edit: command => this.#todo.edit(command.list, command.item, command.text),
      notes: command => this.#todo.setNotes(command.list, command.item, command.notes),
      remove: command => this.#todo.remove(command.list, command.item),
      tags: () => this.#todo.tags(),
      days: command => this.#todo.days(command.list),
      resolved: () => this.#todo.resolved(),
      backlog: () => this.#todo.backlog(),
      walk: command => this.#todo.walk(command.list, command.date),
      bulk: command => this.todoBulk(command.list, command.items, command.action),
      // **One verb per field** (D85, MT8). The row's text field holds the
      // sentence now, so a date cleared or a tag taken off cannot arrive as an
      // omission from an edited string — see `TodoCommand`.
      due: command => this.#todo.setDue(command.list, command.item, command.due),
      tag: command => this.#todo.tag(command.list, command.item, command.name),
      untag: command => this.#todo.untag(command.list, command.item, command.name),
      owner: command => this.#todo.setOwner(command.list, command.item, command.owner),
      putDown: command => this.todoPutDown(command.list, command.item, command.docket),
      matterFor: command => this.matterFor(command.item),
      chosen: command => this.#todo.chosen(command.list, command.date),
      choose: command => this.#todo.choose(command.list, command.date, command.item, command.chosen),
      finishWalk: command => this.#todo.finishWalk(command.list, command.date, command.drop),
      }),
    ]
  }




  // ── reconciliation: the clock tick (MH3a, MH3b, D76) ───────

  /**
   * Bring everything derived back into agreement with what it derives from.
   *
   * **A reconciliation, not a sequence of events** — and that distinction is the
   * whole design. An event-shaped pass has to fire at the right moment and
   * exactly once: it asks *what just happened* and patches accordingly, so a
   * missed midnight, a crash between two writes, a laptop shut for a fortnight
   * or two ticks racing each other all leave the derived state wrong in a way
   * nothing afterwards notices. This asks a different question — *what should be
   * true?* — and makes it so.
   *
   * **Named for the whole job, not for the dockets**, which are only the first
   * thing it has to do. Tephra keeps a widening collection of state that is a
   * function of other state — tasks a docket implies, the horizon MH2 will
   * derive from dates ahead, indices, anything cached from a file somebody can
   * edit behind our back — and every one of them has the same failure mode and
   * therefore wants the same answer: not a notification that fires when the
   * source changes, but a pass that can be run at any time and leaves the
   * derived side correct. So this is the place they go. A new derived thing adds
   * a clause here rather than a private sweep of its own, and everything that
   * already calls this — startup, the day boundary, a verb that invalidates
   * something — keeps it up to date without knowing it exists.
   *
   * **Which buys idempotence by construction rather than by bookkeeping.**
   * Running it twice, or thirty times, or after a month away, converges on the
   * same answer, so nothing needs a record of when it last ran — and *that* is
   * the field whose absence made the old design safe against a machine that was
   * asleep at midnight.
   *
   * Three things are reconciled so far, in this order because each changes
   * what the next should conclude:
   *
   * 0. **Adoption.** A matter or a step somebody wrote by hand has no id until
   *    Tephra writes its block, and the two clauses below address everything by
   *    id — so this comes first or they cannot see it at all. Found by a docket
   *    written from outside the app, which generated nothing and said nothing
   *    (note 67).
   * 1. **Instances.** A matter that recurs moves on when its instance is
   *    settled — for a recurring task, when the step its clock reads is done;
   *    for a recurring event, when its date has passed and nothing is left
   *    owing. A matter with something still owed **does not move on** (H7a):
   *    outstanding is shown as overdue, never quietly reissued.
   * 2. **Items.** Every task step that is due and unfinished should have one on
   *    the list; every step that is not should not. Both directions, because a
   *    reconciler that only adds is an event handler wearing a hat.
   *
   * The return value names what actually changed, which is for logging and for
   * tests; a caller that acts on it is treating this as an event again.
   */
  async reconcile(): Promise<void> {
    // **The explicit door — and it goes through the same one as everything
    // else.** Startup and the day boundary are D77's other two triggers and
    // neither is a data change, so each reports a synthetic key instead of
    // reaching past the machinery. One path in, and a divergence report whose
    // first round reads `asked:` says the run began because somebody asked.
    //
    // The ORDINARY trigger is not this method at all: it is a write, reported by
    // the corpus and routed to whichever functions care (D83).
    //
    // **Returns nothing, and used to return what it had made and withdrawn.**
    // That existed for one `console.log` at startup and for tests to use as a
    // handle on the item just generated — and keeping it meant bolting a side
    // channel onto a mechanism built precisely so that a pass reports nothing
    // and its writes are observed instead. What the run did is now said by the
    // runner, which has the rounds and their keys already (`onRun`); what the
    // run *achieved* is read from the world, which is the better assertion
    // anyway, since it fails for a pass that reports honestly and writes
    // nothing.
    await this.#fixed.changed(ASKED_KEY)
  }

  // ── the horizon (MH2, H8, D74) ─────────────────────────────

  /**
   * Everything bearing down between two days, in date order.
   *
   * **One computation, read by both surfaces.** The full view and the compact
   * strip differ only in the window they ask for, and a second copy of *what
   * counts as coming up* living in the renderer is the failure T16 is named
   * against — the more so here, where the docket half needs `dueOn`, interval
   * arithmetic and the anchor rule, none of which belong in a view.
   *
   * **Computed, never stored**, which is why it needs no clause in `reconcile`
   * (D77): there is no derived copy to fall out of step. It is the one kind of
   * derived state that shape does not apply to, and saying so is worth a line —
   * the temptation with a reconciler in hand is to persist everything.
   *
   * **Both sources, from the start.** Six times over, `notes.md` records the
   * failure of building a view against one source and fitting the second in
   * afterwards; the horizon spans dockets and the task list, so it is built
   * against both or it is built wrong.
   */
  async horizon(from: DateKey, to: DateKey): Promise<readonly HorizonRow[]> {
    await this.#day.ready()
    const window: HorizonWindow = { from, to }
    const rows: HorizonRow[] = []

    // **Dockets: what is coming.** A step already on the list is the other
    // source's business, which `horizonOf` is what enforces.
    //
    // **The live ones, so an archive bears down on nobody** (D91): a finished
    // matter's date is a fact about the past, and the horizon is the question
    // *what is coming*.
    for (const docket of await this.#docket.live()) {
      for (const matter of await this.#docket.matters(docket)) {
        for (const step of matterHorizon(matter, window, addDays, this.#day.zone)) {
          rows.push({
            on: step.on,
            // **The same treatment, by the rung that fits**: a step is free
            // prose with no spans to consult, so it composes the two rungs
            // `plain.ts` describes rather than using the item version.
            text: flattenLinks(plainLine(step.text)),
            doc: docket,
            kind: step.kind,
            // And the name gets it too, or a matter called after a link would
            // be compared against a flattened row text and never match.
            matter: flattenLinks(plainLine(matter.name)),
            instance: step.instance,
            item: null,
            id: matter.id,
            ...(step.until === undefined ? {} : { until: step.until }),
          })
        }
      }
    }

    // **The task list: what is already here and dated.** Read from today's
    // items, which is the live set — an undone item carries forward, so a
    // deadline that has gone by is still in front of somebody, and that is
    // precisely the row H8 asks the horizon to keep showing.
    const list = await this.#todo.list()
    for (const item of await this.#todo.items(list, this.#day.today)) {
      if (item.due === null || !isLive(item.status)) continue
      if (!inHorizon(item.due, window)) continue
      rows.push({
        on: item.due,
        // **The short version** (`shortLine`): no tags, no due date, no link
        // markup. The row has already put the date in its own column, so
        // `DUE 2026-09-15` under a heading that says *15 Sep* is the same fact
        // twice in two notations — and a raw markdown link is a URL sprawling
        // across three lines of a strip that is supposed to be glanced at.
        text: shortLine(item),
        doc: list,
        kind: 'due',
        matter: null,
        instance: null,
        item: item.id,
        id: null,
      })
    }

    // The order is the horizon's own rule, not this method's (`horizon-api.ts`).
    return orderHorizon(rows)
  }

  /**
   * Which matter made this item, if any (MH4).
   *
   * **The link is one-directional in the file and traversable both ways here**,
   * which is the split D79 settled: the step records what it made, and the
   * reverse is a question rather than a second stored copy that could drift.
   * By scanning, because a handful of dockets is a handful — `CorpusIndex` is
   * where this goes if that day comes.
   */
  async matterFor(item: string): Promise<{ docket: DocumentId; matter: string } | null> {
    for (const docket of await this.#store.corpus.list('docket')) {
      for (const one of await this.#docket.matters(docket)) {
        if (one.id === null) continue
        if (one.steps.some(step => step.made === item)) return { docket, matter: one.id }
      }
    }
    return null
  }




  /**
   * Answer an item, and let the step that made it hear.
   *
   * **Deferred as one act, because it writes twice** — the item's status here
   * and the `done` stamp below — and the two are only jointly consistent. Since
   * every write is reported and wakes the docket clause (D83), a pass running
   * between them would see an item resolved whose step is not done, read that as
   * *nobody is waiting for this any more*, and advance the matter from the wrong
   * date. Reordering does not help: stamping first lets a pass settle the
   * instance and clear the stamp before the item is marked at all.
   */
  async todoSetStatus(id: DocumentId, item: string, status: TodoStatus, note?: string): Promise<void> {
    await this.#fixed.defer(async () => {
      await this.#store.mutate(async () =>
        this.#store.corpus.use(id, doc => (doc as TodoDocument).setStatus(item, status, note)),
      )
    // **Completion flows back to whatever asked for it** (H7a). Finishing the
    // task is the act a person performs; the step it came from has to hear,
    // because that is what unblocks the next one and what a recurrence measures
    // from. Without this the chain only advances if somebody also went to the
    // docket and said so, which is asking them to do it twice.
      if (status === 'done') await this.#finished(item)
    })
    // **And putting one down flows back too**, which finishing had covered and
    // nothing else did. *Nevermind* on a generated task left the step pointing
    // at an item nobody could see any more and never done — so a recurring
    // matter's clock never turned and it went quiet for ever, while the docket
    // still showed it as live work. The reconciler now reads *outstanding* from
    // the list rather than from the step, so all this has to do is ask it to
    // look: the resolution is derived, and what changed is only that the
    // derivation is out of date.
    // **No explicit reconcile here any more.** This line used to read
    // `if (!isLive(status)) await this.reconcile()` — right about the need and
    // wrong about the mechanism: the docket clause reads the task list, so a
    // write to the list is one of its inputs moving and its trigger now says so
    // (D83). `#wrote` below reports the write and waits for what derives from
    // it, which is the same guarantee without a verb having to remember.
    await this.#durable.wrote(id)
  }

  /**
   * Do one thing to many items (MH4).
   *
   * **One write below, and the same flow-back above.** Whatever a bulk gesture
   * resolves, the dockets have to hear it: a generated task put down in a batch
   * of nine is as resolved as one put down on its own, and a matter that missed
   * it would go quiet exactly as D79 describes. So this finishes the way the
   * single verb does — tell the steps, then reconcile.
   */
  async todoBulk(
    id: DocumentId,
    items: readonly string[],
    action: TodoStatus | 'remove',
  ): Promise<number> {
    const many = await this.#store.mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as TodoDocument).bulk(items, action)))
    this.#durable.touched()
    if (action === 'done') for (const item of items) await this.#finished(item)
    // **Removal resolves too, and is the case a status-shaped test would miss**:
    // a deleted item is not live, so anything waiting on it is waiting for ever.
    if (action === 'remove' || !isLive(action)) await this.reconcile()
    return many
  }












  /**
   * Put a task down: mark it transferred, and give it a home (MH5, T14).
   *
   * **One keystroke and zero decisions**, which is the rule this whole design is
   * named against breaking. *"Which container does this go in?"* is precisely the
   * friction that sank the system before this one, so it goes to the backlog
   * docket unless the caller already knows better. The review is
   * where filing happens, because that is the moment routing is cheap: the
   * backlog is regathered **from**, never routed **into**.
   *
   * **The item stays and says what happened to it.** `[>]` means *transferred to
   * a docket* — resolved rather than waiting — and the line keeps its id, so its
   * history stays continuous and `tephra:todo/<id>` still resolves. Nothing is
   * deleted and no day file is rewritten, which is what makes this a move rather
   * than a migration.
   *
   * **A task a docket already made is not given a second home.** It has a matter
   * — putting it down is that matter's business (D79), and a misc entry beside it
   * would be the same commitment in two places, which is the failure the
   * horizon's two sources are kept disjoint to avoid.
   */
  async todoPutDown(list: DocumentId, item: string, docket?: DocumentId): Promise<string | null> {
    await this.#day.ready()
    const found = (await this.#todo.items(list, this.#day.today)).find(one => one.id === item)
    // **Already put down is already housed.** The provenance check below only
    // catches a task a docket MADE; one that was put down has a matter nothing
    // points at, so asking twice would make a second copy of it — which is the
    // sort of thing a repeated keystroke does by accident.
    if (found === undefined || found.status === 'backlog') return null
    const already = await this.matterFor(item)
    if (already !== null) {
      await this.todoSetStatus(list, item, 'backlog')
      return null
    }
    const where = docket ?? BACKLOG_DOCKET
    // **Named on first use**, so the sidebar has something to call it other than
    // a slug. A docket nobody named is one nobody recognises tomorrow (MH1's
    // first reported fault, in a different place).
    if (where === BACKLOG_DOCKET) {
      await this.#store.mutate(async () => this.#store.corpus.use(where, async doc => {
        if ((await doc.titleOf(ONLY_SEGMENT)) === null) await doc.setTitleOf(ONLY_SEGMENT, 'Backlog')
      }))
    }
    // **Its subjects and its owner come with it**, being facts about the thing
    // rather than about the list it was on; the due date does not, because a
    // deadline you have just declined is not one.
    const made = await this.#docket.add(where, found.text, { mode: 'task' })
    await this.#store.mutate(async () =>
      this.#store.corpus.use(where, doc => (doc as DocketDocument).cameFrom(made, item)))
    for (const tag of found.tags) await this.#docket.tag(where, made, tag)
    if (found.owner !== null) await this.#docket.setOwner(where, made, found.owner)
    // **And the line is handed over**, last, so it names a docket that exists.
    // One direction, one instant: from here the matter is the docket's, the line
    // is a record of what happened, and nothing on the task list can act on it.
    const title = (await this.#store.corpus.use(where, doc => doc.titleOf(ONLY_SEGMENT)))
      ?? nameOf(where as string)
    await this.#store.mutate(async () =>
      this.#store.corpus.use(list, doc => (doc as TodoDocument).handOver(item, title)))
    this.#durable.touched()
    await this.#durable.wrote(where)
    return made
  }

  /**
   * Tell the step that made this item that it is done.
   *
   * **Found by scanning, because a handful of dockets is a handful.** An index
   * would be the right answer at a hundred and is a second thing to keep true
   * at five; `CorpusIndex` is where it goes if that day comes.
   */
  async #finished(item: string): Promise<void> {
    for (const docket of await this.#store.corpus.list('docket')) {
      for (const matter of await this.#docket.matters(docket)) {
        const step = matter.steps.find(one => one.made === item)
        if (step?.id === undefined || step.id === null || matter.id === null) continue
        await this.#store.mutate(async () =>
          this.#store.corpus.use(docket, doc =>
            (doc as DocketDocument).completeStep(matter.id as string, step.id as string, this.#day.moment)))
        await this.#durable.wrote(docket)
        return
      }
    }
  }

  /**
   * What the dockets imply, made true: instances advanced, items in step.
   *
   * **Returns nothing, which is what a fixed-point function is** (D83): its
   * writes are observed by the corpus and reported as keys, so a pass that also
   * described its own changes would be saying the same thing twice — and the
   * second saying is the one somebody eventually forgets to keep true.
   */
  async #reconcileDockets(): Promise<void> {
    await this.#day.ready()
    const today = this.#day.today
    const list = await this.#todo.list()

    /**
     * Which of the items dockets made are still being asked of somebody.
     *
     * **Outstanding is a computed fact, not a stored one**, and that is what
     * keeps *nevermind* from wedging a matter for ever. A step that made an item
     * somebody then dropped is not owed — it is resolved, just not by being
     * done — and the alternative was a fourth field in the step marker recording
     * the same thing the task list already knows. D77's rule applied one level
     * down: do not persist what can be derived from the source of truth.
     *
     * An id absent from the live set is resolved however it was resolved:
     * finished, dropped, backlogged, or deleted outright. All four mean *stop
     * waiting*, and none of them means *ask again*.
     */
    const live = new Set(
      (await this.#todo.items(list, today))
        .filter(one => isLive(one.status))
        .flatMap(one => (one.id === null ? [] : [one.id])),
    )
    /**
     * Does the item this step made still EXIST anywhere? (D94)
     *
     * **A decision is honoured while its record exists**, and this is the
     * distinction the withdrawal rule was missing. An item that is *done*,
     * *dropped* or *backlogged* is a recorded decision and the step must not
     * ask again — that is D79's exemption and it stands. An item that has been
     * **deleted from the file** is not a decision; it is the absence of one,
     * and the step was left pointing at nothing, asking nobody, for ever.
     *
     * Reported from use: a duplicated day was cleaned up by deleting the rows
     * by hand, and the work never came back — *something isn't propagating from
     * the docket to the TODO list*. Nothing was; every step still named the
     * item it had made.
     *
     * **Corpus-wide, because a resolved item lives on the day it was resolved**
     * and is absent from today's list as surely as a deleted one. Today's live
     * set cannot tell them apart; `itemIds` can, and it sweeps before it
     * answers rather than trusting a cache.
     *
     * **At most once per run, and only when something asks.** The sweep is one
     * `stat` per file; a pass that has nothing outstanding never pays for it.
     * If that ever bites, the cheaper shape is an id-keyed payload in the index
     * rather than a set built from every scanned file.
     */
    /**
     * **Today's list first, and every id on it whatever its status** — which is
     * the half that has to come before the index. The index sweeps *files*, and
     * a status written a moment ago is in the document and the journal before it
     * is on disk (D7: the index is a disposable cache of a scan, and it is
     * behind by construction). Asking it about an item dropped seconds earlier
     * answered *gone*, and the pass offered the work again — caught by the test
     * for D79's exemption, which is exactly the rule it would have broken.
     */
    const onToday = new Set(
      (await this.#todo.items(list, today)).flatMap(one => (one.id === null ? [] : [one.id])),
    )
    /**
     * **And the question is what the item IS now, not whether its id appears
     * somewhere.** The first cut asked the latter and did nothing on the
     * notebook that reported the bug: a carry copies an item into every day it
     * survives, so deleting it from today leaves a week of live copies behind
     * and the id is still *findable*. What that history says is where the item
     * stood on those days, which is not a claim about now.
     *
     * `itemsNow` answers properly — the newest instance, which is what the item
     * is — so two states mean *nobody is being asked this any more*:
     *
     * - **no entry at all**: every trace deleted.
     * - **newest instance still LIVE and not on today's list**: it was taken
     *   off today without being resolved. The carry brings every live item
     *   forward, so this cannot happen on its own — somebody removed the row.
     *
     * A newest instance that is *done*, *dropped* or *backlogged* is a recorded
     * decision, wherever it sits, and D79's exemption holds.
     *
     * **This clause depends on today being materialised**, which it is: the
     * pass opened with `list()`, and the carry is part of that. Said out loud
     * because if it were ever not true, every live item would look absent from
     * today at once.
     */
    let now: ReadonlyMap<string, { status: TodoStatus }> | null = null
    const stillThere = async (item: string): Promise<boolean> => {
      if (onToday.has(item)) return true
      // **Biased towards leaving the step alone**, because the two ways to be
      // wrong are not equally bad. Freeing a step whose item is really still
      // there offers the work twice — a duplicate, which is what this whole
      // reconciler exists to prevent. Declining to free one leaves it stuck
      // until the next sweep, which repairs itself. So while the index is still
      // building, nothing is freed at all.
      if (this.#store.index.status().building) return true
      now ??= await this.#store.index.itemsNow()
      const found = now.get(item)
      return found !== undefined && !isLive(found.status)
    }

    for (const docket of await this.#store.corpus.list('docket')) {
      let touched = false
      // **An archive is adopted and then left alone** (D91). It is a docket by
      // kind, so a hand-edit in one should still be regularised — but nothing
      // in it is live work: generating from a filed matter would put finished
      // work back on the list, and advancing one would give a finished matter a
      // next instance. So the clause above runs for it and the clauses below do
      // not.
      const filed = isArchive(docket as string as RelPath)
      // **Adoption first, because everything below it addresses by id.** A
      // matter or step somebody typed by hand has no marker until Tephra writes
      // the block, and the two loops under this one skip what has no id — so an
      // unadopted docket generated nothing at all, silently and for ever (note
      // 67). The clause is idempotent: it writes only what would differ, and
      // the write it makes wakes the round that then generates.
      if (await this.#docket.adoptAll(docket) > 0) touched = true
      if (filed) {
        if (touched) await this.#durable.wrote(docket)
        continue
      }
      // **What the docket is CALLED**, for the tag every task it generates
      // carries. The same rule `dockets()` uses: the person's words, falling
      // back to the slug of them, which is the only other name a document has.
      const domain = (await this.#store.corpus.use(docket, doc => doc.titleOf(ONLY_SEGMENT), { mode: 'read' }))
        ?? nameOf(docket as string)
      // **Which section each matter is under**, for the context a generated item
      // carries. Read once per docket rather than per step: a section name is
      // explanatory text, and one that moves under a running pass is repaired by
      // the next one (D77).
      const sections = await this.#docket.sections(docket)
      // Re-read after each matter: advancing one rewrites the block, and what
      // this loop holds would be the version from before that.
      for (const id of (await this.#docket.matters(docket)).flatMap(m => (m.id === null ? [] : [m.id]))) {
        if (await this.#advanceDocket(docket, id, today, live)) touched = true
        const matter = (await this.#docket.matters(docket)).find(one => one.id === id)
        if (matter === undefined) continue
        for (const step of matter.steps) {
          if (step.id === null || step.kind !== 'task') continue
          // **A step pointing at an item that no longer exists is freed** (D94),
          // before anything below it reads `made`: the next round then treats
          // the step as it would any other and generates if it is due. Clearing
          // rather than generating here keeps this a reconciler — one fact made
          // true per clause, and the rounds do the rest.
          if (step.made !== null && !(await stillThere(step.made))) {
            await this.#setStepMade(docket, id, step.id, null)
            touched = true
            continue
          }
          const due = dueOn(step, matter, addDays, this.#day.zone)
          const wanted = step.done === null && due !== null && compareDateKeys(due, today) <= 0
          if (wanted && step.made === null) {
            // **Composed once, rather than added and then tagged.** Two writes
            // would be two undo steps for one act, which is the rule `bulk` and
            // `finishWalk` already keep.
            // **A due date only where there is a clock** (D93, amending this).
            //
            // This used to be the step's own computed day, on the argument that
            // *the schedule already knows one* — and the argument was wrong in
            // the commonest case. A `+0d` step's computed day is the day it
            // generates, so every task arrived already due, and a list where
            // everything is due today says nothing about anything. Reported
            // from use in exactly those terms: *those should be reserved for
            // when there is a clock on the step.*
            //
            // Two things are a clock, and nothing else is:
            //
            // - **An explicit `DUE` written on the step**, which is somebody
            //   saying so, and is lifted out of the words into the field the
            //   way the entry grammar lifts it out of a typed line (D85).
            // - **A run-up**, a step whose timing is *N days before* the
            //   occasion: then the occasion is the deadline, and it is the
            //   occasion's date rather than the step's — you have until the
            //   conference, not until the day you meant to start booking it.
            //
            // Everything else — a step at `+0d`, one measured forward, one
            // waiting on another step — gets none, and a person who wants one
            // sets it on the item. That was offered as the fallback and is in
            // fact the right answer: a date the app invented is a date nobody
            // can trust, and the daily walk is what surfaces work here.
            // **The DOCKET is a tag; the matter is what the item is FOR** (D85,
            // MT8). The docket is the durable grouping — the house, work, games —
            // and a word you actually think in, so it is a tag and it is the one
            // somebody pivots on. The matter is *structure*, and it was a tag
            // until a real notebook showed what that costs: thirteen items drawn
            // as eighteen rows, because every generated item appeared under its
            // matter as well as its docket, and a matter with more than a handful
            // of live steps is a badly organised matter — so the group it makes
            // can never be worth the doubling.
            //
            // It is still needed, and for a different reason than grouping:
            // *find the right team* means nothing without knowing whether the
            // matter is defeating a supervillain or building an outhouse, and
            // both can be live at once. That is context for the sentence, which
            // is what `for` is.
            //
            // **Whoever has the matter has the work it makes.** The owner is a
            // fact about the task and travels as a field rather than as words in
            // its title (D81): text in the sentence cannot be filtered on or
            // taken off for a summary.
            //
            // **Composed once, as a record.** Every field is known for certain
            // here, so joining them into a string for the entry grammar to take
            // apart again would be two chances to be wrong.
            const said = readDue(step.text)
            const runUp = step.when.kind === 'at' && step.when.offset.startsWith('-')
            const item = await this.#todo.make(list, {
              text: said.text,
              tags: [domain],
              for: forWhat(matter, step.text, sections),
              owner: matter.owner,
              // The occasion's own date for a run-up, since that is the thing
              // being run up to; `matter.when.start` IS the live instance.
              due: said.due ?? (runUp ? matter.when.start : null),
            })
            // **The matter is a TAG, not a prefix.** On the list a step's text
            // stands alone — *find a general mechanic* says nothing about which
            // car — and the first cut solved that by writing the matter's name
            // into the title. That was the wrong shape: *which matter this
            // belongs to* is exactly what a tag says, and as a tag it is drawn
            // as a chip, it groups the by-tag view by matter, and it can be
            // taken off without editing the sentence. A prefix is a tag with no
            // machinery and no way out of it.
            //
            // The seeded first step is tagged too, even though its text IS the
            // matter's name (D76): a chip beside it is redundant to read and
            // still correct to group by, which is the opposite trade from the
            // prefix, where the redundancy was in the sentence itself.

            await this.#setStepMade(docket, id, step.id, item)
            touched = true
          } else if (!wanted && step.made !== null && step.done === null && live.has(step.made)) {
            // **Only what it made, and only while it is still being asked.**
            // Three exemptions, and they are all the same exemption: a task
            // somebody typed is nobody else's business, one already finished is
            // a true statement about the past, and one they *dropped* is as much
            // their decision as one they ticked. Taking any of them back would
            // be overruling somebody — which is what the finished-item rule was
            // always really about, stated too narrowly.
            await this.#todo.remove(list, step.made)
            await this.#setStepMade(docket, id, step.id, null)
            touched = true
          } else if (step.made !== null && live.has(step.made)) {
            // **The context is derived, so a pass makes it true again** (D77,
            // D85). Rename a matter or move it between sections and every item
            // it generated is describing a place that no longer exists — which
            // the matter TAG had as a bug with nothing to fix it, and which this
            // fixes by the same machinery as everything else here.
            //
            // **The sentence is the person's; the fields are the docket's.** A
            // pass may write `for` and take off the tag it replaced, and must
            // never touch the text — they may have edited it, and overruling
            // them is what the exemptions above exist to prevent.
            const item = (await this.#todo.items(list, today)).find(one => one.id === step.made)
            if (item !== undefined) {
              const wantsFor = forWhat(matter, step.text, sections)
              if (item.for !== wantsFor) {
                await this.#todo.setFor(list, step.made, wantsFor)
                touched = true
              }
              // **And the matter's own tag comes off.** This is what converts the
              // items generated before `for` existed — the same clause, run once
              // on an old notebook and for ever after on nothing, which is why
              // the migration needs no separate code to be wrong in its own way.
              if (item.tags.includes(matter.name.trim())) {
                await this.#todo.untag(list, step.made, matter.name.trim())
                touched = true
              }
            }
          }
        }

        // **A status step completes by the calendar** (D92, amending D91). It is
        // awareness with no task, so nobody can tick it and *done* can only
        // mean *that day has gone* — which is what lets a matter made of status
        // steps finish at all. Before this an events docket could never be
        // filed: ten real events, each one status step, none of them completable
        // by any gesture in the app.
        //
        // **Read from the matter as it stands after the clauses above**, since
        // an advance may have just moved the instance this measures from.
        const settledMatter = (await this.#docket.matters(docket)).find(one => one.id === id)
        for (const step of settledMatter?.steps ?? []) {
          if (step.id === null || step.kind !== 'status' || step.done !== null) continue
          const on = dueOn(step, settledMatter as Matter, addDays, this.#day.zone)
          if (on === null) continue
          if (!statusPassed(step, settledMatter as Matter, on, today)) continue
          await this.#docket.completeStep(docket, id, step.id, true)
          touched = true
        }

        // **Finished, and then — a day later — filed** (D91).
        //
        // **Both directions, because it is a reconciler.** A one-off whose steps
        // are all done gets today's date; one that is stamped and no longer
        // finished — a step reopened, a step added — loses it. The second half
        // is what keeps the stamp a *fact about the steps* rather than a state
        // somebody has to maintain.
        const settled = (await this.#docket.matters(docket)).find(one => one.id === id)
        const finished = settled !== undefined && isFinished(settled)
        if (finished && settled?.done === null) {
          await this.#docket.setDone(docket, id, today)
          touched = true
        } else if (!finished && settled?.done != null) {
          await this.#docket.setDone(docket, id, null)
          touched = true
        } else if (finished && settled?.done != null && compareDateKeys(settled.done, today) < 0) {
          // **Not on the day it finished, which is the whole of D42 here.** A
          // matter that vanishes from under the hand that ticked its last step
          // is the app moving something you did not ask it to move; a matter
          // that is gone when you come back tomorrow is tidying. The day
          // trigger wakes this pass, so the delay needs no clock of its own.
          //
          // **The archive is written before the source is cleared**, and the
          // move itself says why (`Dockets.archiveMatter`).
          await this.#docket.archiveMatter(docket, id)
          touched = true
        }
      }
      if (touched) await this.#durable.wrote(docket)
    }
  }

  /**
   * Move a matter on while its instance is settled and behind.
   *
   * **Named for the docket, unlike `reconcile`**, because this one genuinely is
   * docket logic and nothing else will ever want it: what *settled* means, and
   * what the next instance is counted from, are facts about the four modes of
   * D76. The generic thing above is the pass; the specific thing is each clause
   * in it, and the names should say which is which.
   *
   *
   * **A loop, because a year away is a year of instances.** Each turn advances
   * one and the next asks again, so coming back after a long absence converges
   * on the current instance and generates that one — a month away yielding one
   * air-filter task rather than thirty. Bounded, because an interval this
   * cannot make progress on would otherwise spin.
   */
  async #advanceDocket(
    docket: DocumentId,
    id: string,
    today: DateKey,
    live: ReadonlySet<string>,
  ): Promise<boolean> {
    let moved = false
    for (let guard = 0; guard < 500; guard += 1) {
      const matter = (await this.#docket.matters(docket)).find(one => one.id === id)
      // **A recurrence is an interval OR a list**, and this asked only about the
      // interval — so a listed matter never moved on at all, which is the one
      // thing a list is for.
      const recurs = matter !== undefined && (matter.when.every !== null || matter.when.dates !== null)
      if (matter === undefined || !recurs || matter.when.start === null) break
      // **Settled, and what the next one is measured from, are the same
      // question asked of the two repeating shapes** — so they are answered
      // together rather than in two places that could come to differ.
      const clock = matter.steps.find(one => one.id === matter.when.after)
      const [settled, from] = matter.when.after === null
        // A recurring EVENT is on the calendar: it moves on once its date is
        // behind us and nothing it asked for is still owed, counting from the
        // instance that has just passed so the anchored day survives.
        // Owed means *this instance put something on the list and it is still
        // being asked of somebody* — not merely that a step is undone. A step
        // that never came due (the app was shut for the whole of 2020) was never
        // asked for, so it cannot be outstanding; and one whose item was
        // dropped is resolved, just not by being done. Treating either as owed
        // wedges the matter — on an instance nobody was told about in the first
        // case, and for ever in the second.
        ? [compareDateKeys(matter.when.start, today) < 0
            && matter.steps.every(one => one.made === null || !live.has(one.made)),
          matter.when.start]
        // A recurring TASK reads one step, and that step being over is the
        // instance being over — whatever the calendar says. **Over two ways, and
        // they count from different days.** Done: from the day it was done,
        // which for a matter years overdue is the difference between *next
        // spring* and *overdue again immediately*. Dropped: from the day it was
        // **scheduled**, because *this one did not happen* says nothing about
        // when the next one is owed — an air filter you skipped in March is due
        // in June, not three months after you gave up on it.
        : clock?.done != null
          ? [true, dateKeyAt(new Date(clock.done * 1000), this.#day.zone)]
          : [clock?.made != null && !live.has(clock.made), matter.when.start]
      if (!settled || from === null) break
      await this.#store.mutate(async () =>
        this.#store.corpus.use(docket, doc => (doc as DocketDocument).advanceInstance(id, from)))
      moved = true
    }
    return moved
  }

  /** Same rule as `#advanceDocket`: *step* and *made* are the docket's words. */
  async #setStepMade(
    docket: DocumentId,
    matter: string,
    step: string,
    item: string | null,
  ): Promise<void> {
    await this.#store.mutate(async () =>
      this.#store.corpus.use(docket, doc => (doc as DocketDocument).setMade(matter, step, item)))
  }
  #registerReconcilers(): void {
    this.#fixed.register({
      name: 'dockets',
      /**
       * **Everything this clause reads**, which is more than the dockets.
       *
       * A docket write, obviously. But the pass also reads the task list — to
       * know which generated items are still *outstanding*, which is what
       * decides whether an instance is settled and may advance. So resolving a
       * task changes an input, and a task finished is what unblocks the step
       * that follows it.
       *
       * **Routed rather than remembered.** `todoSetStatus` used to end with
       * `if (!isLive(status)) await this.reconcile()` — correct, and an
       * invariant kept by memory at one door out of many, which is the shape
       * note 61 records decaying. The trigger says it once instead.
       *
       * **And the day**, which is an input as much as either document: what is
       * due depends on what day it is, so a roll wakes this the same way a write
       * does. `asked:` covers startup and an explicit request — the triggers
       * that are not changes to anything (`change-keys.ts` has the format).
       */
      trigger: '^(docket|todo|day|asked):',
      pass: () => this.#reconcileDockets(),
    })
  }
}

/**
 * What a generated item is **for**: where inside its docket the step came from.
 *
 * `Section / Matter`, or the matter alone — read outer to inner, so it reads as a
 * place. The docket is not in it because the docket is the item's tag, and saying
 * it twice on one row is the fault this replaced (D85, MT8).
 *
 * **The section only when there is more than one**, which is what *adds
 * something* turns out to mean. Seen on a real notebook: every lima item read
 * *House Bootstrap / Initiate Remodel*, and that docket has exactly one section
 * — so the first half said nothing on every row and made three of five rows wrap
 * onto a second line, which costs the list the thing it is for. A section earns
 * its place when it distinguishes the matter from one somewhere else.
 *
 * **The matter is dropped when its name IS the step's text**, which is the
 * common single-step case (D76 seeds exactly that): *Change the water filter ·
 * Change the water filter* says one thing twice, and an annotation repeating the
 * sentence beside it reads as a fault. The section still says something, so it
 * stays.
 *
 * Explanatory text, not a reference — which is why there is no second field for
 * the section and no separator to parse. What a person needs is the context they
 * had on screen when they wrote the step.
 */
function forWhat(
  matter: Matter,
  step: string,
  sections: readonly Section[],
): string | null {
  const within = sections.find(one => one.matters.some(m => m.id === matter.id))
  const named = sections.filter(one => one.name.trim() !== '').length
  const parts = [
    named < 2 || within === undefined || within.name.trim() === '' ? null : within.name.trim(),
    matter.name.trim() === step.trim() ? null : matter.name.trim(),
  ].filter(one => one !== null)
  return parts.length === 0 ? null : parts.join(' / ')
}
