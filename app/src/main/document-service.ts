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

import { CHANNEL, type ChangeAck, type DocumentInfo, type EditAck, type EditRequest, type ExtendRequest, type ReadRequest, type SpansRequest, type WindowChangedMessage, type WindowId, type WindowSnapshot } from '../shared/ipc.ts'
import type { DateKey, TypedSpan, DocumentPosition } from '../shared/document-api.ts'
import type { Notebook } from './w/notebook.ts'
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

export class DocumentService {
  readonly #doc: StreamDocument
  readonly #windows = new Map<WindowId, StreamWindow>()
  #nextId: WindowId = 1

  /** The serial queue. Every mutation chains onto it; reads do not need to. */
  #queue: Promise<unknown> = Promise.resolve()

  #flushTimer: ReturnType<typeof setTimeout> | null = null
  #dirtySince: number | null = null

  readonly #notebook: Notebook

  constructor(notebook: Notebook) {
    this.#notebook = notebook
    this.#doc = new StreamDocument(notebook)

    // Hand-editing is a feature, so the app has to notice. Queued with the
    // edits, because a reload racing a write is the corruption this whole
    // layer exists to avoid.
    notebook.onExternalChange(changes => {
      void this.#serial(async () => {
        for (const change of changes) await this.#doc.externalChanged(change.rel)
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
    await this.#serial(() => this.#doc.flush())
  }

  /**
   * Write after a second of quiet, but never later than five seconds after the
   * first unsaved change — whichever comes first.
   */
  #scheduleFlush(): void {
    const now = Date.now()
    this.#dirtySince ??= now
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer)
    const remaining = MAX_INTERVAL_MS - (now - this.#dirtySince)
    this.#flushTimer = setTimeout(() => void this.flush(), Math.max(0, Math.min(QUIESCE_MS, remaining)))
  }

  #cancelFlush(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer)
    this.#flushTimer = null
    this.#dirtySince = null
  }

  /** Quiesce: write anything outstanding and stop the timer. */
  async stop(): Promise<void> {
    await this.flush()
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

