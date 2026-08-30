// The one global the self-check drives this window through (MC6).
//
// **One per renderer, and it says which window it is.** There used to be three
// — `__view`, `__pane`, `__doc` — which was fine while a renderer could only be
// the app; with a set of windows, a scene has to be able to say *which* window
// it is asking about, and three loose globals cannot carry that.
//
// Temporary in the same way `verify.ts` is: it exists so an acceptance run can
// drive the real app rather than a mock of it, and it goes when that does.

import type { Pane } from './pane/pane'
import type { RemoteStream } from './x/kinds/stream'

export interface TephraHandle {
  /** Which window this renderer is, as main numbered it. */
  id: number
  /** What it is called: the title bar's text. */
  name: string
  pane: Pane | null
  /** The stream, which every window holds whatever else it is showing. */
  doc: RemoteStream | null
  /**
   * The live editing view, when the surface has one.
   *
   * Re-read rather than remembered: landing in another document rebinds the
   * surface, so a reference captured earlier is a destroyed view still holding
   * the text you navigated away from (D54).
   */
  view: unknown | null
}

export const tephra: TephraHandle = { id: 0, name: '', pane: null, doc: null, view: null }

// Under one name, so a scene can find it and a second window cannot be
// confused for the first.
;(globalThis as unknown as { __tephra: TephraHandle }).__tephra = tephra
