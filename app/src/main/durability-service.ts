// **Foundation. Depends on `CorpusService` and `Bus`.**
//
// The three write tiers (D32), and nothing else: the log, the file, the version.
//
// **Quiescence alone fails under exactly the condition this notebook exists
// for.** Writing continuously never reaches quiet, so a quiescence-only rule
// would never write and everything would live in memory until something went
// wrong. Every tier here is therefore *quiescence OR a ceiling*, and that is why
// each has two numbers rather than one.
//
// **Durability belongs in main, not in the renderer**: the renderer is the
// process most likely to die, and asking it to remember to save is asking the
// least reliable component to own the most important guarantee.
//
// **It subscribes; the corpus does not call it.** Marking work unsaved when a
// document changes looks like the corpus reaching up into this service. It is
// the other way round: this one asks the corpus to tell it, which keeps the
// dependency pointing down while the news travels up (D83).
//
// No IPC channels of its own. `flush` is the renderer-facing door and belongs to
// whichever domain service owns the text; this is what it calls.

import { Wal, type WalRecord } from './w/wal.ts'
import { GitRepository } from './w/git-repository.ts'
import type { Repository } from './w/repository.ts'
import { StreamHistory } from './x/history.ts'
import { applyEdits } from './x/text-edits.ts'
import type { CorpusService } from './corpus-service.ts'
import type { DateKey, DocumentId, VersionId } from '../shared/document-api.ts'
import { STREAM_ID } from '../shared/document-api.ts'

/**
 * The first tier (D32). Small enough that what it can lose is a few keystrokes;
 * large enough that a burst of typing is one write rather than thirty.
 */
const WAL_BATCH_MS = 50

/** The file tier (D32 M2): a second of quiet, and never later than five. */
const QUIESCE_MS = 1_000
const MAX_INTERVAL_MS = 5_000

/**
 * The third tier (D32) — recording a recoverable VERSION of the notebook, not
 * "committing", which is one store's word for it. Same shape as the file tier
 * and for the same reason: writing for an hour without pause would otherwise be
 * one commit, or none if the process died.
 */
const VERSION_QUIESCE_MS = 5 * 60_000
const VERSION_MAX_MS = 30 * 60_000

/**
 * What the tiers can be told.
 *
 * **Overridable so they can be tested in milliseconds rather than by waiting
 * half an hour — and all of them, because they are chained**: a commit is
 * scheduled by a file write, so a test that compresses only the commit tier is
 * still waiting on the file tier's one-second quiescence, and concludes wrongly
 * that the commit never happens.
 */
export interface DurabilityOptions {
  readonly walBatchMs?: number
  readonly quiesceMs?: number
  readonly maxIntervalMs?: number
  readonly versionQuiesceMs?: number
  readonly versionMaxMs?: number
  /** Off for tests that only want the document. */
  readonly history?: boolean
}

export class DurabilityService {
  readonly #corpus: CorpusService

  /** Something is unwritten or unversioned; the tiers have work to do. */
  #unsavedWork = false

  #flushTimer: ReturnType<typeof setTimeout> | null = null
  #dirtySince: number | null = null
  readonly #quiesceMs: number
  readonly #maxIntervalMs: number

  #repo: Repository | null = null
  #versionTimer: ReturnType<typeof setTimeout> | null = null
  #versionDirtySince: number | null = null
  readonly #versionQuiesceMs: number
  readonly #versionMaxMs: number
  readonly #wantsHistory: boolean

  /** Dates touched since the last version, for its reason. */
  readonly #pendingDates = new Set<string>()
  /** The first line of the most recent insertion, for the message. */
  #headline = ''
  /** Whether anything outside the app changed since the last version. */
  #sawExternal = false

  /**
   * One log per document (D32, D54).
   *
   * `walFile(docId)` has always taken an id and has only ever been given
   * `'stream'`. Making it real here rather than when the second writable kind
   * arrives means a pin's durability is not a thing anybody has to remember to
   * add.
   */
  readonly #wals = new Map<DocumentId, Wal>()
  readonly #walBatchMs: number
  readonly #walPending = new Map<DocumentId, WalRecord[]>()
  #walTimer: ReturnType<typeof setTimeout> | null = null

  constructor(corpus: CorpusService, options: DurabilityOptions = {}) {
    this.#corpus = corpus
    this.#walBatchMs = options.walBatchMs ?? WAL_BATCH_MS
    this.#quiesceMs = options.quiesceMs ?? QUIESCE_MS
    this.#maxIntervalMs = options.maxIntervalMs ?? MAX_INTERVAL_MS
    this.#versionQuiesceMs = options.versionQuiesceMs ?? VERSION_QUIESCE_MS
    this.#versionMaxMs = options.versionMaxMs ?? VERSION_MAX_MS
    this.#wantsHistory = options.history !== false

    // Into the log before the file tier gets to it: that gap is the whole
    // reason the log exists.
    // Through the Corpus rather than from a document: with documents opening
    // and being let go, a subscription against one of them has no lifetime to
    // live in (D54). The id says which document an edit belongs to.
    corpus.onJournal((id, segment, baseLen, edits) => {
      const pending = this.#walPending.get(id) ?? []
      for (const edit of edits) {
        pending.push({
          doc: id as string,
          date: segment as string,
          baseLen,
          from: edit.from,
          to: edit.to,
          insert: edit.insert,
        })
      }
      this.#walPending.set(id, pending)
      this.#scheduleWal()
    })

    corpus.onChanged((_id, change) => {
      // **Any document changing schedules a write.** The service used to say so
      // at each of its own mutating methods, which was complete while it was
      // the only writer — then a pin became a document edit made through
      // another object, and nothing scheduled anything: the text sat in memory
      // until the app quit. A change is a change, whoever asked for it (D54).
      if (change.origin !== 'external') this.touched()

      // An external change must not colour OUR commit message. Measured before
      // this guard existed: a hand-edit set the headline, and the next commit
      // triggered by typing quoted text its author never wrote.
      if (change.origin === 'external') return
      for (const edit of change.edits) {
        this.#pendingDates.add(edit.span.begin.segment as string)
        const line = edit.payload.split('\n').find(l => l.trim() !== '')
        if (line !== undefined) this.#headline = line.trim()
      }
    })

    // Nothing to collect: the commit scans for itself. All that is needed is
    // that a commit becomes worth scheduling, and that the message admits the
    // notebook was edited from outside.
    corpus.onExternalChange(() => {
      this.#sawExternal = true
      this.versionable()
    })
  }

  // ── saying there is work ─────────────────────────────────────

  /**
   * There is unsaved work, and it should reach the file soon.
   *
   * Every mutation ends with this, and for a while every mutation wrote the
   * pair out again — nine copies of two lines, which is nine chances for the
   * next one to set the flag and forget the timer, and a document that then
   * saves only when something else happens to save.
   */
  touched(): void {
    this.#unsavedWork = true
    this.#scheduleFlush()
  }

  /** The same, for the version tier's much longer clock (D32). */
  versionable(): void {
    this.#unsavedWork = true
    this.#scheduleVersion()
  }

  /**
   * Write soon, without claiming there is unversioned work.
   *
   * **Deliberately not `touched()`.** Three callers — `edit`, `undo`, `redo` —
   * want the file timer and nothing else, because the change subscription has
   * already marked the work for whichever of them actually changed something.
   * Setting the flag here as well would tell the version tier there was
   * something to commit after an undo that put the document back exactly as it
   * was found.
   */
  writeSoon(): void {
    this.#scheduleFlush()
  }

  /**
   * There is unsaved work and the caller is about to write it itself.
   *
   * For the two verbs that flush immediately — `restore` and `branch` — where
   * scheduling a timer for something happening on the next line would be
   * arranging to do it twice.
   */
  unsaved(): void {
    this.#unsavedWork = true
  }

  // ── the file tier ────────────────────────────────────────────

  /**
   * Write after a second of quiet, but never later than five seconds after the
   * first unsaved change — whichever comes first.
   */
  #scheduleFlush(): void {
    const now = Date.now()
    this.#dirtySince ??= now
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer)
    const remaining = this.#maxIntervalMs - (now - this.#dirtySince)
    this.#flushTimer = setTimeout(
      () => void this.flush(),
      Math.max(0, Math.min(this.#quiesceMs, remaining)),
    )
  }

  #cancelFlush(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer)
    this.#flushTimer = null
    this.#dirtySince = null
  }

  async flush(): Promise<void> {
    this.#cancelFlush()
    // Everything with unsaved work, not only the stream: the tiers are the
    // corpus's, not one document's (D54, MC2c).
    const written = await this.#corpus.mutate(() => this.#corpus.corpus.flushAll())
    // ORDER MATTERS: files first, then the log. A crash between the two replays
    // edits the files already contain, which is exactly what `baseLen` makes
    // harmless. The other order would lose them outright.
    if (this.#walTimer !== null) clearTimeout(this.#walTimer)
    this.#walTimer = null
    this.#walPending.clear()
    for (const wal of this.#wals.values()) await wal.clear()
    if (written.length > 0) {
      this.versionable()
    }
  }

  // ── the log tier ─────────────────────────────────────────────

  /** The log for one document, made on first use. */
  #walFor(id: DocumentId): Wal {
    const held = this.#wals.get(id)
    if (held !== undefined) return held
    const made = new Wal(this.#corpus.notebook, id as string)
    this.#wals.set(id, made)
    return made
  }

  #scheduleWal(): void {
    if (this.#walTimer !== null) return
    this.#walTimer = setTimeout(() => {
      this.#walTimer = null
      for (const [id, batch] of [...this.#walPending]) {
        this.#walPending.delete(id)
        void this.#walFor(id).append(batch)
      }
    }, this.#walBatchMs)
  }

  /**
   * Replay whatever the last session did not manage to write, and write it.
   *
   * Called once at startup, before any window opens. A record whose day is not
   * the length that record expected is skipped: it is already in the file,
   * because the crash landed after the write and before the log was cleared.
   * Later records then match again, so recovery resumes wherever the files
   * actually got to rather than refusing wholesale.
   */
  async recover(): Promise<number> {
    // One log per document, so recovery asks each of them. Only the stream is
    // writable today; a record naming anything else is from a build that could
    // write more, and is skipped rather than guessed at.
    const records = await this.#walFor(STREAM_ID).read()
    if (records.length === 0) return 0

    let applied = 0
    for (const record of records) {
      if (record.doc !== (STREAM_ID as string)) continue
      const segment = await (await this.#corpus.stream).segment(record.date as DateKey)
      if (segment.readOnly || segment.diverged) continue
      if (segment.length !== record.baseLen) continue // already on disk
      const body = segment.body
      segment.setBody(applyEdits(body, [{ from: record.from, to: record.to, insert: record.insert }]))
      applied++
    }

    if (applied > 0) await this.flush()
    else await this.#walFor(STREAM_ID).clear()
    return applied
  }

  // ── the version tier ─────────────────────────────────────────

  /**
   * Open the repository and reconcile whatever happened while the app was not
   * running. Separate from construction because it does real I/O and can
   * legitimately be skipped — a test that only wants the document should not
   * pay for a git repository.
   */
  async openHistory(): Promise<void> {
    if (!this.#wantsHistory) return
    this.#repo = await GitRepository.open(this.#corpus.notebook.root)
    const first = (await this.#repo.latest()) === null
    await this.#repo.save(first ? 'Opened the notebook' : 'Changes made outside Tephra')
  }

  /**
   * The store itself, for the one caller that needs it raw.
   *
   * Handed out rather than wrapped because `restore` reaches through the Corpus
   * — which is what knows which documents are open — and a restore that wrote
   * files under an open one would be undone by its buffer (MC7).
   */
  get repository(): Repository | null {
    return this.#repo
  }

  /** The history, for reading. Null when history is off. */
  get history(): StreamHistory | null {
    return this.#repo === null ? null : new StreamHistory(this.#repo)
  }

  /**
   * Record a version of the notebook now.
   *
   * Flushes first: saving a file the editor has not written yet records the
   * previous state and quietly loses the newest work from the history — the one
   * place it was supposed to be safe.
   */
  async saveVersion(): Promise<VersionId | null> {
    this.#cancelVersion()
    if (this.#repo === null) return null
    await this.flush()

    const message = this.#reason()
    this.#pendingDates.clear()
    this.#headline = ''
    this.#sawExternal = false
    this.#unsavedWork = false
    // The store finds what changed for itself. Nothing is tracked here on its
    // behalf, and nothing here knows how it is stored.
    return this.#repo.save(message)
  }

  /** Record a version under a reason the caller has, rather than the gathered one. */
  async saveVersionNamed(message: string): Promise<VersionId | null> {
    return (await this.#repo?.save(message)) ?? null
  }

  /**
   * The reason a version was recorded: the first line of what changed, prefixed
   * by the dates touched — chosen because the job is finding a lost paragraph a
   * year later, and a timestamp does not help with that.
   *
   * NOTE for the purge procedure (T10): this puts content in the version's
   * reason as well as in the file, so deleted text lives in two places per
   * commit and a purge must rewrite messages too.
   */
  #reason(): string {
    const dates = [...this.#pendingDates].sort()
    const where =
      dates.length === 0
        ? 'notebook'
        : dates.length === 1
          ? (dates[0] as string)
          : `${dates[0] as string}..${dates[dates.length - 1] as string}`
    const text = this.#headline.length > 72 ? `${this.#headline.slice(0, 71)}…` : this.#headline
    // One scan means a commit may carry work from elsewhere alongside ours.
    // Saying so is the honest version of the earlier attempt to separate them:
    // the message quotes only what WE wrote, and admits when that is not the
    // whole story.
    if (text === '') return this.#sawExternal ? 'Changes made outside Tephra' : where
    return `${where} · ${text}${this.#sawExternal ? ' (with changes made outside Tephra)' : ''}`
  }

  #scheduleVersion(): void {
    if (this.#repo === null) return
    if (!this.#unsavedWork) return
    const now = Date.now()
    this.#versionDirtySince ??= now
    if (this.#versionTimer !== null) clearTimeout(this.#versionTimer)
    const remaining = this.#versionMaxMs - (now - this.#versionDirtySince)
    this.#versionTimer = setTimeout(
      () => void this.saveVersion(),
      Math.max(0, Math.min(this.#versionQuiesceMs, remaining)),
    )
  }

  #cancelVersion(): void {
    if (this.#versionTimer !== null) clearTimeout(this.#versionTimer)
    this.#versionTimer = null
    this.#versionDirtySince = null
  }

  /**
   * Quiesce: write anything outstanding, commit it, and stop the timers.
   *
   * Session end is the third of the commit tier's three triggers (D32), and the
   * important one — it is what makes "I wrote for ten minutes and quit" land in
   * the history rather than waiting for a quiescence that will never come.
   */
  async stop(): Promise<void> {
    await this.flush()
    await this.saveVersion()
    this.#cancelFlush()
    this.#cancelVersion()
    if (this.#walTimer !== null) clearTimeout(this.#walTimer)
    this.#walTimer = null
  }
}
