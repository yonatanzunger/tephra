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

import type { BufferPosition, DateKey, DocumentWindow, SegmentKey, Unsubscribe } from '@shared/document-api.ts'
import type { BoundaryState, NavTarget } from '@shared/pane-api.ts'
import { ScreenMetric, V1_EXTENT_POLICY, charsFor, type ExtentPolicy } from '@shared/extent.ts'
import type { RemoteDocument } from '../x/remote-document'
import type { RemoteWindow } from '../x/remote-window'

export class Pane {
  readonly #doc: RemoteDocument
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

  constructor(doc: RemoteDocument) {
    this.#doc = doc
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
    if (options.push !== false && this.#window !== null) {
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
    const window = await this.#open(target)
    previous?.release()

    this.#window = window as RemoteWindow
    this.#location = target
    for (const h of this.#windowHandlers) h()
    for (const h of this.#locationHandlers) h()
    for (const h of this.#boundaryHandlers) h()

    // The initial extent is small so opening is instant; growing to `target`
    // happens behind the reader while they orient (D40).
    if (this.#policy.target > this.#policy.initial) void this.#growToTarget()
  }

  async #open(target: NavTarget): Promise<DocumentWindow> {
    switch (target.kind) {
      case 'today':
        return this.#doc.readToday()
      case 'date': {
        const at = { segment: target.date as SegmentKey, offset: 0 as never, generation: this.#doc.generation }
        return this.#doc.read({ begin: at, end: at })
      }
      case 'anchor': {
        const found = await this.#doc.resolveAnchor(target.name)
        if (found === null) throw new Error(`no anchor named ${target.name}`)
        return this.#doc.read({ begin: found, end: found })
      }
      case 'span':
        return this.#doc.read(target.span)
      default:
        // 'document', 'url' and 'external' arrive with filesets and the nav
        // panel; failing loudly beats opening the wrong thing.
        throw new Error(`navigation target ${target.kind} is not implemented yet`)
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
  viewportChanged(visible: { from: BufferPosition; to: BufferPosition }): void {
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
