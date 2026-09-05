// Pane — a person's position in the corpus over time (D35).
//
// A DocumentWindow is a loaded region of ONE document; a Pane is where the user
// is, how they got there, and the policy deciding whether an extension blocks or
// happens quietly. Navigation crosses documents, so whatever holds a back stack
// has to sit above the thing it replaces as it moves.
//
// This is Z's view-model. X gains no notion of where the user is, and the editor
// reports facts upward rather than being observed — which is what keeps the
// dependency pointing the right way.

import type { WindowPosition, DateKey, DocumentWindow, SegmentKey, Unsubscribe } from '../../../shared/document-api.ts'
import type { BoundaryState, NavTarget } from '../../../shared/pane-api.ts'
import { ScreenMetric, V1_EXTENT_POLICY, charsFor, type ExtentPolicy } from '../../../shared/extent.ts'
import type { RemoteDocument } from '../x/remote-document'
import type { RemoteWindow } from '../x/remote-window'
import type { Documents } from '../x/documents'
import { home } from '../x/kinds/registry'

export class Pane {
  readonly #documents: Documents
  /** The document the pane is currently showing. Navigation may change it. */
  #doc: RemoteDocument | null
  /** Whether anything has been loaded yet, which is what history counts from. */
  #loaded = false
  #window: RemoteWindow | null = null
  #location: NavTarget = { kind: 'today' }

  /** Browser-fashion: a jump moves this pane and keeps a stack (Q7b). */
  readonly #back: NavTarget[] = []
  readonly #forward: NavTarget[] = []

  /** Calibrated from viewportChanged; see D40 for why screens, not days. */
  readonly #metric = new ScreenMetric()
  #policy: ExtentPolicy = V1_EXTENT_POLICY

  #extending: 'earlier' | 'later' | null = null

  readonly #windowHandlers = new Set<() => void>()
  readonly #locationHandlers = new Set<() => void>()
  readonly #boundaryHandlers = new Set<() => void>()

  constructor(documents: Documents, doc: RemoteDocument) {
    this.#documents = documents
    this.#doc = doc
  }

  /**
   * Whose undo stack a keystroke in this pane means (D54).
   *
   * **Null on a pane showing a query** (ML3), which has no document behind it
   * and therefore nothing to undo into. Keeping the last one would have been
   * one character less and would have put ⌘Z on a document nobody is looking at.
   */
  get document(): RemoteDocument | null {
    return this.#doc
  }

  get window(): DocumentWindow | null {
    return this.#window
  }

  get location(): NavTarget {
    return this.#location
  }

  get policy(): ExtentPolicy {
    return this.#policy
  }

  set policy(next: ExtentPolicy) {
    this.#policy = next
  }

  get canGoBack(): boolean {
    return this.#back.length > 0
  }

  get canGoForward(): boolean {
    return this.#forward.length > 0
  }

  get boundary(): { earlier: BoundaryState; later: BoundaryState } {
    const w = this.#window
    if (w === null) return { earlier: { kind: 'end' }, later: { kind: 'end' } }
    const edges = w.boundaries
    const earliest = (w.span.begin.segment as DateKey) ?? ('' as DateKey)
    const latest = (w.span.end.segment as DateKey) ?? ('' as DateKey)
    return {
      earlier:
        this.#extending === 'earlier'
          ? { kind: 'extending' }
          : edges.earlier
            ? { kind: 'extendable', earliest }
            : { kind: 'end' },
      later:
        this.#extending === 'later'
          ? { kind: 'extending' }
          : edges.later
            ? { kind: 'extendable', earliest: latest }
            : { kind: 'end' },
    }
  }

  // ── navigation ─────────────────────────────────────────────

  async goToToday(): Promise<void> {
    await this.goTo({ kind: 'today' })
  }

  async goTo(target: NavTarget, options: { push?: boolean } = {}): Promise<void> {
    // **`#location`, not `#window`.** A pane showing a query has no window, and
    // testing for one lost the history entry on the way out of the directory —
    // so back from a link you followed would have skipped it.
    if (options.push !== false && this.#loaded) {
      this.#back.push(this.#location)
      this.#forward.length = 0
    }
    await this.#load(target)
  }

  async back(): Promise<void> {
    const previous = this.#back.pop()
    if (previous === undefined) return
    this.#forward.push(this.#location)
    await this.#load(previous)
  }

  async forward(): Promise<void> {
    const next = this.#forward.pop()
    if (next === undefined) return
    this.#back.push(this.#location)
    await this.#load(next)
  }

  async #load(target: NavTarget): Promise<void> {
    const previous = this.#window
    const opened = await this.#open(target)
    previous?.release()

    // Null for a query, which is the whole of what ML3 changes here.
    this.#doc = opened?.doc ?? null
    this.#window = (opened?.window ?? null) as RemoteWindow | null
    this.#location = target
    this.#loaded = true
    for (const h of this.#windowHandlers) h()
    for (const h of this.#locationHandlers) h()
    for (const h of this.#boundaryHandlers) h()

    // The initial extent is small so opening is instant; growing to `target`
    // happens behind the reader while they orient (D40).
    if (this.#policy.target > this.#policy.initial) void this.#growToTarget()
  }

  /**
   * Open what a target names, and say which document it turned out to be.
   *
   * **The document is part of the answer.** Three of these targets are the
   * stream's — a day, a bookmark, today — and two name a document of their own;
   * a pane that assumed one document could express the first three and threw on
   * the rest (D35, D54).
   */
  async #open(target: NavTarget): Promise<{ doc: RemoteDocument; window: DocumentWindow } | null> {
    switch (target.kind) {
      // **A query has nothing to open.** The pane holds the location and the
      // renderer draws the view; there is no document behind it and no window
      // to read (ML3).
      case 'links':
        return null
      case 'today': {
        const stream = await this.#documents.stream()
        return { doc: stream, window: await stream.readToday() }
      }
      case 'date': {
        const stream = await this.#documents.stream()
        const at = stream.positionAt(target.date as SegmentKey, 0)
        return { doc: stream, window: await stream.read({ begin: at, end: at }) }
      }
      case 'anchor': {
        const stream = await this.#documents.stream()
        const found = await stream.resolveAnchor(target.name)
        if (found === null) throw new Error(`no anchor named ${target.name}`)
        return { doc: stream, window: await stream.read({ begin: found, end: found }) }
      }
      case 'span': {
        const doc = await this.#documents.open(target.doc)
        return { doc, window: await doc.read(target.span) }
      }
      case 'document': {
        // The whole of it, unless the entry said where inside — which is what
        // `at` is for, and what a fileset entry pointing at a heading will use.
        const doc = await this.#documents.open(target.id)
        return { doc, window: await doc.read(await home(doc)) }
      }
      default:
        // 'url' and 'external' leave the app entirely; the layer that can open
        // a browser or a Finder window handles them, not the pane.
        throw new Error(`navigation target ${target.kind} is not the pane's to open`)
    }
  }

  // ── extent ─────────────────────────────────────────────────

  /**
   * The editor reports a fact; the Pane owns the policy.
   *
   * Two jobs in one signal: it keeps ScreenMetric calibrated, because `to−from`
   * IS the character extent of a screenful, and it is what auto-extension would
   * watch. v1 ships option 1 so nothing here grows on its own — and D36's
   * deferral of the ceiling measurement depends on exactly that.
   */
  viewportChanged(visible: { from: WindowPosition; to: WindowPosition }): void {
    this.#metric.observe((visible.to as number) - (visible.from as number))
    if (!this.#policy.autoExtendOnApproach) return

    const w = this.#window
    if (w === null || this.#extending !== null) return
    const headroom = charsFor(this.#policy, this.#policy.extendWhenWithin, this.#metric)
    if ((visible.from as number) < headroom && w.boundaries.earlier) void this.extend('earlier')
  }

  async extend(direction: 'earlier' | 'later'): Promise<void> {
    const w = this.#window
    if (w === null || this.#extending !== null) return
    this.#extending = direction
    for (const h of this.#boundaryHandlers) h()
    try {
      await w.extend(direction, charsFor(this.#policy, this.#policy.initial, this.#metric))
    } finally {
      this.#extending = null
      for (const h of this.#boundaryHandlers) h()
    }
  }

  /** Grow quietly toward `target` after opening, one step at a time. */
  async #growToTarget(): Promise<void> {
    const w = this.#window
    if (w === null) return
    const want = charsFor(this.#policy, this.#policy.target, this.#metric)
    while (w === this.#window && w.text.length < want && w.boundaries.earlier) {
      const before = w.text.length
      await this.extend('earlier')
      if (w.text.length === before) break // nothing more to load
    }
  }

  // ── subscriptions ──────────────────────────────────────────

  onWindowChanged(handler: () => void): Unsubscribe {
    this.#windowHandlers.add(handler)
    return () => this.#windowHandlers.delete(handler)
  }

  onLocationChanged(handler: () => void): Unsubscribe {
    this.#locationHandlers.add(handler)
    return () => this.#locationHandlers.delete(handler)
  }

  onBoundaryChanged(handler: () => void): Unsubscribe {
    this.#boundaryHandlers.add(handler)
    return () => this.#boundaryHandlers.delete(handler)
  }

  release(): void {
    this.#window?.release()
    this.#window = null
    this.#windowHandlers.clear()
    this.#locationHandlers.clear()
    this.#boundaryHandlers.clear()
  }
}
