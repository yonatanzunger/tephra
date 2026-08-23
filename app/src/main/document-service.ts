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
import type { DateKey, TypedSpan, DocumentPosition } from '../shared/document-api.ts'
import type { Notebook } from './w/notebook.ts'
import { Repository } from './w/repo.ts'
import type { RelPath } from './w/layout.ts'
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
 * The third tier (D32). Same shape as the file tier and for the same reason:
 * **quiescence alone fails under precisely the condition this notebook exists
 * for.** Writing continuously for an hour never reaches quiescence, so without
 * a ceiling the commit would never happen and the whole hour would live in one
 * commit — or in none, if the process died.
 */
const COMMIT_QUIESCE_MS = 5 * 60_000
const COMMIT_MAX_MS = 30 * 60_000

export interface ServiceOptions {
  /**
   * Overridable so the tiers can be tested in milliseconds rather than by
   * waiting half an hour. **Both tiers, because they are chained**: a commit is
   * scheduled by a file write, so a test that compresses only the commit tier
   * is still waiting on the file tier's one-second quiescence and concludes,
   * wrongly, that the commit never happens.
   */
  readonly quiesceMs?: number
  readonly maxIntervalMs?: number
  readonly commitQuiesceMs?: number
  readonly commitMaxMs?: number
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
  #commitTimer: ReturnType<typeof setTimeout> | null = null
  #commitDirtySince: number | null = null
  readonly #quiesceMs: number
  readonly #maxIntervalMs: number
  readonly #commitQuiesceMs: number
  readonly #commitMaxMs: number
  readonly #wantsHistory: boolean

  /** Something is unsaved or uncommitted; the tier has work to do. */
  #commitPending = false
  /** Whether anything outside the app changed since the last commit. */
  #sawExternal = false
  /** Dates touched since the last commit, for the message. */
  readonly #pendingDates = new Set<string>()
  /** The first line of the most recent insertion, for the message. */
  #headline = ''

  readonly #notebook: Notebook

  constructor(notebook: Notebook, options: ServiceOptions = {}) {
    this.#notebook = notebook
    this.#doc = new StreamDocument(notebook)
    this.#quiesceMs = options.quiesceMs ?? QUIESCE_MS
    this.#maxIntervalMs = options.maxIntervalMs ?? MAX_INTERVAL_MS
    this.#commitQuiesceMs = options.commitQuiesceMs ?? COMMIT_QUIESCE_MS
    this.#commitMaxMs = options.commitMaxMs ?? COMMIT_MAX_MS
    this.#wantsHistory = options.history !== false

    // What went into the commit message, gathered as it happens. Reconstructing
    // it later would mean diffing, and the point of quoting the text is that it
    // is right there at the moment of the change.
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
        this.#commitPending = true
        this.#scheduleCommit()
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
    if (written.length > 0) {
      this.#commitPending = true
      this.#scheduleCommit()
    }
  }

  // ── the commit tier (D32) ────────────────────────────────────

  /**
   * Open the repository and reconcile whatever happened while the app was not
   * running. Separate from the constructor because it does real I/O and can
   * legitimately be skipped — a test that only wants the document should not
   * pay for a git repository.
   */
  async startHistory(): Promise<void> {
    if (!this.#wantsHistory) return
    this.#repo = await Repository.open(this.#notebook.root)
    const existing = await this.#repo.log(1)
    await this.#repo.commitAll(
      existing.length === 0 ? 'Opened the notebook' : 'Changes made outside Tephra',
    )
  }

  /**
   * Commit now. Flushes first, because committing a file the editor has not
   * written yet records the previous state and quietly loses the newest work
   * from the history — the one place it was supposed to be safe.
   */
  async commitNow(): Promise<string | null> {
    this.#cancelCommit()
    if (this.#repo === null) return null
    await this.flush()

    const message = this.#message()
    this.#pendingDates.clear()
    this.#headline = ''
    this.#sawExternal = false
    this.#commitPending = false
    // `commitAll` finds what changed for itself, the way `git add -A` does.
    // Nothing is tracked here on its behalf.
    return this.#repo.commitAll(message)
  }

  /**
   * The message quotes the first line of what changed, prefixed by the dates
   * touched — chosen because the job is finding a lost paragraph a year later,
   * and a timestamp does not help with that.
   *
   * NOTE for the purge procedure (T10): this puts content in the commit
   * message as well as the blob, so deleted text lives in two places per commit
   * and a purge must rewrite messages too.
   */
  #message(): string {
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

  #scheduleCommit(): void {
    if (this.#repo === null) return
    if (!this.#commitPending) return
    const now = Date.now()
    this.#commitDirtySince ??= now
    if (this.#commitTimer !== null) clearTimeout(this.#commitTimer)
    const remaining = this.#commitMaxMs - (now - this.#commitDirtySince)
    this.#commitTimer = setTimeout(
      () => void this.commitNow(),
      Math.max(0, Math.min(this.#commitQuiesceMs, remaining)),
    )
  }

  #cancelCommit(): void {
    if (this.#commitTimer !== null) clearTimeout(this.#commitTimer)
    this.#commitTimer = null
    this.#commitDirtySince = null
  }

  /** The history, for reading. Null when history is off. */
  get repository(): Repository | null {
    return this.#repo
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
    await this.commitNow()
    this.#cancelFlush()
    this.#cancelCommit()
  }

  releaseWindow(id: WindowId): void {
    this.#windows.get(id)?.release()
    this.#windows.delete(id)
  }

  async spans(request: SpansRequest): Promise<readonly TypedSpan[]> {
    return request.kind === undefined ? this.#doc.spans() : this.#doc.spans(request.kind)
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

