// Pane — the navigation and extent API, transcribed from solution/pane-api.md.
//
// TYPES ONLY. Pane is Z's view-model: a person's position in the corpus over
// time, where a DocumentWindow is a loaded region of one document. It cannot
// live on DocumentWindow because navigation crosses documents, and whatever
// holds a back stack must sit above the thing it replaces as it moves (D35).

import type {
  DateKey,
  DocumentId,
  DocumentWindow,
  Span,
  Unsubscribe,
  WindowPosition,
} from './document-api.ts'
import type { ExtentPolicy } from './extent.ts'

export type { ExtentPolicy, Screens } from './extent.ts'
export { screens, V1_EXTENT_POLICY, ScreenMetric, charsFor } from './extent.ts'

/**
 * The same taxonomy as a fileset entry (D10: bookmark, file, URL, external
 * document). They are one type, not two that resemble each other — a section
 * entry *is* a navigation target, which is why clicking one needs no adapter.
 */
export type NavTarget =
  | { readonly kind: 'today' }
  | { readonly kind: 'date'; readonly date: DateKey }
  | { readonly kind: 'anchor'; readonly name: string }
  | { readonly kind: 'document'; readonly id: DocumentId; readonly at?: NavTarget }
  | { readonly kind: 'span'; readonly doc: DocumentId; readonly span: Span } // a search result
  /**
   * The link directory (R10a, ML3) — **a window's location that is not a
   * document at all.**
   *
   * The first of these, and the shape every filtered view after it inherits: a
   * window shows a document *or* a query, and back/forward, restore and the
   * title bar all follow from that one change rather than from a special case
   * per view. Deliberately concrete rather than a general `{kind:'query'}`:
   * there is one query, and what a shared shape should look like is a thing the
   * second one will say.
   */
  | { readonly kind: 'links' }
  | { readonly kind: 'url'; readonly href: string } // browser
  | { readonly kind: 'external'; readonly path: string } // OS intent

export type BoundaryState =
  | { readonly kind: 'open' } // more is loaded in that direction
  | { readonly kind: 'extending' } // in flight
  | { readonly kind: 'extendable'; readonly earliest: DateKey } // an "earlier ▲" affordance belongs here
  | { readonly kind: 'capped'; readonly earliest: DateKey } // beyond the cap; jumping is the gesture
  | { readonly kind: 'end' } // genuinely the start or end of the corpus

export interface Pane {
  readonly window: DocumentWindow | null
  /** Where we are, in user terms — the title bar. */
  readonly location: NavTarget
  readonly boundary: { readonly earlier: BoundaryState; readonly later: BoundaryState }
  readonly canGoBack: boolean
  readonly canGoForward: boolean

  goTo(target: NavTarget): Promise<void>
  /** Sugar for the most-used action. */
  goToToday(): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>

  /** Explicit extension — the "earlier ▲" affordance. */
  extend(direction: 'earlier' | 'later'): Promise<void>

  /**
   * The editor reports a fact; the Pane owns the policy. This is the whole of
   * the auto-extend mechanism, and inverting it — having the Pane observe the
   * editor — would make X depend on Z.
   *
   * It carries a second job that the extent unit depends on: `to - from` is the
   * character extent of one screenful, so this is also how ScreenMetric stays
   * calibrated. No extra signal is needed for it.
   */
  viewportChanged(visible: { readonly from: WindowPosition; readonly to: WindowPosition }): void

  /** Mutable; that is the point. */
  policy: ExtentPolicy

  onWindowChanged(h: () => void): Unsubscribe // rebind the editor
  onLocationChanged(h: () => void): Unsubscribe // retitle
  onBoundaryChanged(h: () => void): Unsubscribe // repaint the edge affordance
}

/**
 * Two things stay off the Pane.
 *
 * CAPTURE does not need one: `appendToToday(text)` belongs on Corpus or
 * Document — no navigation, no window, no pane. That is what makes a capture
 * bar cheap to add later, and it is Portal's finding that the widget is the
 * capture surface, not the editor.
 *
 * UNDO does not either. It stays `document.undo()` (D26): document-scoped, and
 * it can land outside the current window — in which case the Pane is *told* to
 * go there, which is a goTo, which is a shape that already exists.
 */
