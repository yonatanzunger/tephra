// The document service: one Document, many window handles, and a serial queue.
//
// DELIBERATELY FREE OF ELECTRON. The one rule here that matters more than the
// rest is that edits apply in the order they were composed, and that ordering
// is exactly the kind of thing that is subtly wrong in a way no manual test
// notices. Keeping this module importable from plain Node is what lets it be
// tested at all.
//
// IPC *delivery* is ordered per channel, but `ipcMain.handle` runs handlers
// concurrently — a handler that awaits durability yields, and the next edit can
// start before it finishes. Two keystrokes would then interleave and the
// document would be reordered relative to what the typist saw.

import type { Anomaly } from '../shared/anomalies.ts'
import { CHANNEL, type ChangeAck, type DocumentInfo, type EditAck, type EditRequest, type ExtendRequest, type ReadRequest, type SpansRequest, type WindowChangedMessage, type WindowId, type WindowSnapshot } from '../shared/ipc.ts'
import type { DateKey, DocumentId, DocumentPosition, Span, TypedSpan, VersionId } from '../shared/document-api.ts'
import type { CommentId, CommentThread } from '../shared/comments.ts'
import type { Notebook } from './w/notebook.ts'
import { Wal, type WalRecord } from './w/wal.ts'
import { GitRepository } from './w/git-repository.ts'
import type { Repository } from './w/repository.ts'
import { StreamHistory } from './x/history.ts'
import type { RestoreReport, Version } from '../shared/history-api.ts'
import { resolveInsideNotebook, type RelPath } from './w/layout.ts'
import { join } from 'node:path'
import { LOCAL } from './w/layout.ts'
import { parseUiState, type UiState } from '../shared/ui-state.ts'
import { StreamDocument } from './x/stream-document.ts'
import type { StreamWindow } from './x/window.ts'

/** Anything that can carry a pushed message to a renderer. */
export interface MessageSink {
  send(channel: string, message: unknown): void
}

/**
 * The file-write tier (D32 M2): quiescence OR a ceiling, never quiescence alone.
 *
 * Quiescence alone fails under exactly the condition this notebook exists for —
 * writing continuously for an hour never reaches quiescence, so the file is
 * never written and everything lives in memory until something goes wrong. The
 * ceiling closes that, and it is why both numbers are here rather than one.
 *
 * Durability belongs in main, not in the renderer: the renderer is the process
 * most likely to die, and asking it to remember to save is asking the least
 * reliable component to own the most important guarantee.
 */
const QUIESCE_MS = 1_000

const MAX_INTERVAL_MS = 5_000

/**
 * The third tier (D32) — recording a recoverable VERSION of the notebook, not
 * "committing", which is one store's word for it. Same shape as the file tier
 * and for the same reason:
 * **quiescence alone fails under precisely the condition this notebook exists
 * for.** Writing continuously for an hour never reaches quiescence, so without
 * a ceiling the commit would never happen and the whole hour would live in one
 * commit — or in none, if the process died.
 */
/**
 * The first tier (D32). Small enough that what it can lose is a few keystrokes;
 * large enough that a burst of typing is one write rather than thirty.
 */
const WAL_BATCH_MS = 50

const VERSION_QUIESCE_MS = 5 * 60_000
const VERSION_MAX_MS = 30 * 60_000

export interface ServiceOptions {
  /**
   * Overridable so the tiers can be tested in milliseconds rather than by
   * waiting half an hour. **Both tiers, because they are chained**: a commit is
   * scheduled by a file write, so a test that compresses only the commit tier
   * is still waiting on the file tier's one-second quiescence and concludes,
   * wrongly, that the commit never happens.
   */
  readonly walBatchMs?: number
  /**
   * The file tier's quiescence. Verification lengthens it so that "the file
   * tier has not written yet" is a fact rather than a race — but the VALUE
   * arrives from the caller, because reading it means reading the environment
   * through the verify gate, and that gate imports Electron.
   */
  readonly quiesceMs?: number
  readonly maxIntervalMs?: number
  readonly versionQuiesceMs?: number
  readonly versionMaxMs?: number
  /** Off for tests that only want the document. */
  readonly history?: boolean
}

export class DocumentService {
  readonly #doc: StreamDocument
  readonly #windows = new Map<WindowId, StreamWindow>()
  #nextId: WindowId = 1

  /** The serial queue. Every mutation chains onto it; reads do not need to. */
  #queue: Promise<unknown> = Promise.resolve()

  #flushTimer: ReturnType<typeof setTimeout> | null = null
  #dirtySince: number | null = null

  #repo: Repository | null = null
  #versionTimer: ReturnType<typeof setTimeout> | null = null
  #versionDirtySince: number | null = null
  readonly #quiesceMs: number
  readonly #maxIntervalMs: number
  readonly #versionQuiesceMs: number
  readonly #versionMaxMs: number
  readonly #wantsHistory: boolean

  /** Something is unwritten or unversioned; the tiers have work to do. */
  #unsavedWork = false
  /** Whether anything outside the app changed since the last version. */
  #sawExternal = false

  readonly #wal: Wal
  readonly #walBatchMs: number
  #walPending: WalRecord[] = []
  #walTimer: ReturnType<typeof setTimeout> | null = null

  /** Dates touched since the last version, for its reason. */
  readonly #pendingDates = new Set<string>()
  /** The first line of the most recent insertion, for the message. */
  #headline = ''

  readonly #notebook: Notebook

  constructor(notebook: Notebook, options: ServiceOptions = {}) {
    this.#notebook = notebook
    this.#doc = new StreamDocument(notebook)
    this.#wal = new Wal(notebook)
    this.#walBatchMs = options.walBatchMs ?? WAL_BATCH_MS
    this.#quiesceMs = options.quiesceMs ?? QUIESCE_MS
    this.#maxIntervalMs = options.maxIntervalMs ?? MAX_INTERVAL_MS
    this.#versionQuiesceMs = options.versionQuiesceMs ?? VERSION_QUIESCE_MS
    this.#versionMaxMs = options.versionMaxMs ?? VERSION_MAX_MS
    this.#wantsHistory = options.history !== false

    // What went into the commit message, gathered as it happens. Reconstructing
    // it later would mean diffing, and the point of quoting the text is that it
    // is right there at the moment of the change.
    // Into the log before the file tier gets to it: that gap is the whole
    // reason the log exists.
    this.#doc.onJournal((date, baseLen, edits) => {
      for (const edit of edits) {
        this.#walPending.push({
          date: date as string,
          baseLen,
          from: edit.from,
          to: edit.to,
          insert: edit.insert,
        })
      }
      this.#scheduleWal()
    })

    this.#doc.onChanged(change => {
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

    // Hand-editing is a feature, so the app has to notice. Queued with the
    // edits, because a reload racing a write is the corruption this whole
    // layer exists to avoid.
    notebook.onExternalChange(changes => {
      void this.#serial(async () => {
        for (const change of changes) await this.#doc.externalChanged(change.rel)
        // Nothing to collect: the commit scans for itself. All that is needed
        // is that a commit becomes worth scheduling, and that the message
        // admits the notebook was edited from outside.
        this.#sawExternal = true
        this.#versionable()
      })
    })

    this.#doc.onDiverged(divergence => {
      for (const sink of this.#sinks) sink.send(CHANNEL.diverged, divergence)
    })
  }

  // ── UI state: where the reader was ─────────────────────────

  async loadUiState(): Promise<UiState> {
    return parseUiState(await this.#notebook.read(LOCAL.uiState))
  }

  /**
   * Written straight through rather than queued behind edits: losing a cursor
   * position is cheap and self-correcting, and making it wait behind the write
   * tiers would spend a real guarantee on a soft one.
   */
  async saveUiState(state: UiState): Promise<void> {
    await this.#notebook.write(LOCAL.uiState, JSON.stringify(state, null, 2) + '\n')
  }

  get document(): StreamDocument {
    return this.#doc
  }

  /** Run `work` after everything already queued, and before anything queued later. */
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work)
    // Keep the chain alive even when a link rejects, or one failed edit would
    // wedge every edit after it.
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async info(): Promise<DocumentInfo> {
    return {
      meta: this.#doc.meta,
      generation: this.#doc.generation,
      today: StreamDocument.today(),
      extent: await this.#doc.extent(),
    }
  }

  async openWindow(request: ReadRequest): Promise<WindowSnapshot> {
    const window = (await this.#doc.read({
      begin: this.#doc.positionAt(request.first, 0),
      end: this.#doc.positionAt(request.last, 0),
    })) as StreamWindow

    const id = this.#nextId++
    this.#windows.set(id, window)
    window.onChanged((edits, origin) => {
      this.#broadcast({
        id,
        edits,
        origin,
        generation: window.generation,
        text: window.text,
        spans: window.spans(),
        placement: window.placement(),
        boundaries: window.boundaries,
      })
    })
    window.onReset(() => this.#broadcastReset(id))
    return this.#snapshot(id, window)
  }

  #snapshot(id: WindowId, window: StreamWindow): WindowSnapshot {
    return {
      id,
      text: window.text,
      span: window.span,
      generation: window.generation,
      spans: window.spans(),
      placement: window.placement(),
      boundaries: window.boundaries,
    }
  }

  /** Growing the region is a mutation, so it queues with the edits. */
  async extend(request: ExtendRequest): Promise<void> {
    await this.#serial(async () => {
      const window = this.#windows.get(request.id)
      if (window === undefined) throw new Error(`no such window ${request.id}`)
      await window.extend(request.direction, request.chars)
    })
  }

  async edit(request: EditRequest): Promise<EditAck> {
    return this.#serial(async () => {
      const window = this.#windows.get(request.id)
      if (window === undefined) throw new Error(`no such window ${request.id}`)
      await window.edit(request.edits, request.origin)
      this.#scheduleFlush()
      return {
        generation: window.generation,
        length: window.text.length,
        spans: window.spans(),
        placement: window.placement(),
      }
    })
  }

  /** Where the notebook is. Printing resolves relative links against it. */
  get notebookRoot(): string {
    return this.#notebook.root
  }

  /** Self-check only. What every open window is holding, and whether it agrees. */
  diagnose(): unknown {
    return [...this.#windows.entries()].map(([id, window]) => ({
      id,
      text: window.text.length,
      segments: window.diagnose(),
    }))
  }

  anomalies(): readonly Anomaly[] {
    return this.#doc.anomalies()
  }

  async undo(): Promise<ChangeAck> {
    return this.#serial(async () => {
      const change = await this.#doc.undo()
      this.#scheduleFlush()
      return { change, generation: this.#doc.generation }
    })
  }

  async redo(): Promise<ChangeAck> {
    return this.#serial(async () => {
      const change = await this.#doc.redo()
      this.#scheduleFlush()
      return { change, generation: this.#doc.generation }
    })
  }

  async flush(): Promise<void> {
    this.#cancelFlush()
    const written = await this.#serial(() => this.#doc.writeDirty())
    // ORDER MATTERS: files first, then the log. A crash between the two replays
    // edits the files already contain, which is exactly what `baseLen` makes
    // harmless. The other order would lose them outright.
    if (this.#walTimer !== null) clearTimeout(this.#walTimer)
    this.#walTimer = null
    this.#walPending = []
    await this.#wal.clear()
    if (written.length > 0) {
      this.#versionable()
    }
  }

  // ── the write-ahead log (D32) ────────────────────────────────

  #scheduleWal(): void {
    if (this.#walTimer !== null) return
    this.#walTimer = setTimeout(() => {
      this.#walTimer = null
      const batch = this.#walPending
      this.#walPending = []
      void this.#wal.append(batch)
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
    const records = await this.#wal.read()
    if (records.length === 0) return 0

    let applied = 0
    for (const record of records) {
      const segment = await this.#doc.segment(record.date as DateKey)
      if (segment.readOnly || segment.diverged) continue
      if (segment.length !== record.baseLen) continue // already on disk
      const body = segment.body
      segment.setBody(body.slice(0, record.from) + record.insert + body.slice(record.to))
      applied++
    }

    if (applied > 0) await this.flush()
    else await this.#wal.clear()
    return applied
  }

  // ── the version tier (D32) ───────────────────────────────────

  /**
   * Open the repository and reconcile whatever happened while the app was not
   * running. Separate from the constructor because it does real I/O and can
   * legitimately be skipped — a test that only wants the document should not
   * pay for a git repository.
   */
  async openHistory(): Promise<void> {
    if (!this.#wantsHistory) return
    this.#repo = await GitRepository.open(this.#notebook.root)
    const first = (await this.#repo.latest()) === null
    await this.#repo.save(first ? 'Opened the notebook' : 'Changes made outside Tephra')
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

  /**
   * The reason a version was recorded: the first line of what changed, prefixed
   * by the dates touched — chosen because the job is finding a lost paragraph a year later,
   * and a timestamp does not help with that.
   *
   * NOTE for the purge procedure (T10): this puts content in the version's
   * reason as well as in the file, so deleted text lives in two places per commit
   * and a purge must rewrite messages too.
   */
  #reason(): string {
    const dates = [...this.#pendingDates].sort()
    const where =
      dates.length === 0
        ? 'notebook'
        : dates.length === 1
          ? (dates[0] as string)
          : `${dates[0] as string}..${dates[dates.length - 1] as string}`
    const text = this.#headline.length > 72 ? `${this.#headline.slice(0, 71)}\u2026` : this.#headline
    // One scan means a commit may carry work from elsewhere alongside ours.
    // Saying so is the honest version of the earlier attempt to separate them:
    // the message quotes only what WE wrote, and admits when that is not the
    // whole story.
    if (text === '') return this.#sawExternal ? 'Changes made outside Tephra' : where
    return `${where} \u00b7 ${text}${this.#sawExternal ? ' (with changes made outside Tephra)' : ''}`
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

  /** The history, for reading. Null when history is off. */
  get repository(): Repository | null {
    return this.#repo
  }

  /** Days and versions, rather than paths and object ids (D32). */
  get history(): StreamHistory | null {
    return this.#repo === null ? null : new StreamHistory(this.#repo)
  }

  async versions(limit = 50): Promise<readonly Version[]> {
    return (await this.history?.versions(limit)) ?? []
  }

  async readDay(version: VersionId, date: DateKey): Promise<string | null> {
    return (await this.history?.readDay(version, date)) ?? null
  }

  /**
   * Put the stream back the way it was at a version.
   *
   * **Flushed immediately, and a version taken straight away.** A restore that
   * lived only in memory would be undone by a crash, and the one thing someone
   * doing a restore cannot afford is for it not to have happened. Committing it
   * at once also makes the restore itself a point to come back FROM, which is
   * what makes "the way back from a bad restore is another restore" true.
   */
  async restore(version: VersionId): Promise<RestoreReport> {
    const history = this.history
    if (history === null) throw new Error('this notebook has no history to restore from')
    const report = await this.#serial(() => history.restore(version, this.#doc))
    this.#unsavedWork = true
    await this.flush()
    await this.#repo?.save(`Restored to ${version.slice(0, 7)}`)
    return report
  }

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

  releaseWindow(id: WindowId): void {
    this.#windows.get(id)?.release()
    this.#windows.delete(id)
  }

  async spans(request: SpansRequest): Promise<readonly TypedSpan[]> {
    return request.kind === undefined ? this.#doc.spans() : this.#doc.spans(request.kind)
  }

  /** Bookmark a point (R11's degenerate range). Serial, like every mutation. */
  async setAnchor(at: DocumentPosition, name: string): Promise<void> {
    await this.#serial(() => this.#doc.setAnchor(at, name))
    this.#touched()
  }

  /**
   * Put a subject over a range, or take it off one. Serial, like every mutation.
   *
   * Z asks for both through the same door because they are the same operation
   * with opposite signs — see `StreamDocument.#retag`.
   */
  async tag(span: Span, subject: string): Promise<void> {
    await this.#serial(() => this.#doc.tag(span, subject))
    this.#touched()
  }

  async untag(span: Span, subject: string): Promise<void> {
    await this.#serial(() => this.#doc.untag(span, subject))
    this.#touched()
  }

  /**
   * Branch a range into its own file. Serial, and flushed straight away: the
   * new file is already on disk, so leaving the stream's half of the operation
   * sitting in memory is the one window where the two disagree (D13).
   */
  async branch(span: Span, name: string): Promise<DocumentId> {
    const id = await this.#serial(() => this.#doc.branch(span, name))
    // Not `#touched()`: the branched file is already on disk, so the window
    // where the two halves disagree is closed now rather than in a second (D13).
    this.#unsavedWork = true
    await this.flush()
    return id
  }

  /**
   * Where a link found in the text points, or null if it will not be followed.
   *
   * Containment is `resolveInsideNotebook`'s job and is tested there; a link
   * that leads out of the notebook, or names a file that is not there, resolves
   * to nothing.
   *
   * **This returns a path rather than opening it**, because opening is
   * Electron's and this object is deliberately free of Electron — three test
   * suites drive it under plain node, and an `import { shell }` at the top of
   * this file broke all three at module load. That is the same fault as reading
   * `app.isPackaged` at module scope (see `verify-mode.ts`), and it is the
   * layering telling the truth: what a link means is a question about the
   * notebook, and opening a file is a question about the desktop.
   */
  async linkTarget(target: string): Promise<string | null> {
    const rel = resolveInsideNotebook(this.#notebook.root, target)
    if (rel === null) return null
    if (!(await this.#notebook.has(rel))) return null
    return join(this.#notebook.root, rel)
  }

  /** Change what one span is tagged as. Not a corpus-wide rename (D44). */
  async renameTag(span: Span, from: string, to: string): Promise<void> {
    await this.#serial(() => this.#doc.renameTag(span, from, to))
    this.#touched()
  }

  async removeAnchor(name: string): Promise<void> {
    await this.#serial(() => this.#doc.removeAnchor(name))
    this.#touched()
  }

  // ── comments (D47) ─────────────────────────────────────────
  //
  // Serial like every mutation, and flushed on the ordinary schedule. Reading
  // is not serialised: a thread list is derived from bodies already in memory.

  comments(): Promise<readonly CommentThread[]> {
    return this.#doc.comments()
  }

  async startComment(span: Span, body: string): Promise<CommentId> {
    const id = await this.#serial(() => this.#doc.startComment(span, body))
    this.#touched()
    return id
  }

  async addComment(id: CommentId, body: string): Promise<void> {
    await this.#serial(() => this.#doc.addComment(id, body))
    this.#touched()
  }

  async editComment(id: CommentId, index: number, body: string): Promise<void> {
    await this.#serial(() => this.#doc.editComment(id, index, body))
    this.#touched()
  }

  async deleteComment(id: CommentId, index: number): Promise<void> {
    await this.#serial(() => this.#doc.deleteComment(id, index))
    this.#touched()
  }

  async setCommentResolved(id: CommentId, resolved: boolean): Promise<void> {
    await this.#serial(() => this.#doc.setCommentResolved(id, resolved))
    this.#touched()
  }

  async setCommentAssignee(id: CommentId, to: string | null): Promise<void> {
    await this.#serial(() => this.#doc.setCommentAssignee(id, to))
    this.#touched()
  }

  async reactToComment(id: CommentId, index: number, emoji: string, on: boolean): Promise<void> {
    await this.#serial(() => this.#doc.reactToComment(id, index, emoji, on))
    this.#touched()
  }

  /**
   * Something changed that has to reach the file tier.
   *
   * Every mutation ends with this pair, and for a while every mutation wrote it
   * out again — nine copies of two lines, which is nine chances for the next
   * one to set the flag and forget the timer, and a document that then saves
   * only when something else happens to save.
   */
  #touched(): void {
    this.#unsavedWork = true
    this.#scheduleFlush()
  }

  /** The same, for the version tier's much longer clock (D32). */
  #versionable(): void {
    this.#unsavedWork = true
    this.#scheduleVersion()
  }

  /**
   * Import text at a point. **The clipboard is read by `ipc.ts`**, not here —
   * reading it means importing Electron, and this object stays free of it
   * (`tests/unit/main/no-electron.test.ts`).
   */
  async importText(
    at: DocumentPosition,
    text: string,
    original: { readonly content: string; readonly ext: string },
  ): Promise<string> {
    const rel = await this.#serial(() => this.#doc.importText(at, text, original))
    this.#touched()
    return rel
  }

  async resolveAnchor(name: string): Promise<DocumentPosition | null> {
    return this.#doc.resolveAnchor(name)
  }

  async extent(): Promise<{ readonly first: DateKey; readonly last: DateKey } | null> {
    return this.#doc.extent()
  }

  // ── pushing to the renderer ────────────────────────────────

  #sinks: MessageSink[] = []

  /**
   * Where pushed messages go. An interface rather than a BrowserWindow so this
   * whole class stays free of Electron — which is what lets its serial queue,
   * the part most likely to be subtly wrong, be tested in plain Node.
   */
  addSink(sink: MessageSink): () => void {
    this.#sinks.push(sink)
    return () => {
      this.#sinks = this.#sinks.filter(s => s !== sink)
    }
  }

  #broadcast(message: WindowChangedMessage): void {
    for (const sink of this.#sinks) sink.send(CHANNEL.windowChanged, message)
  }

  #broadcastReset(id: WindowId): void {
    for (const sink of this.#sinks) sink.send(CHANNEL.windowReset, { id })
  }
}

