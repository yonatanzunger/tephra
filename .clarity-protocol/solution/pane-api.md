# Pane — the navigation and extent API

The view-model the editor binds to. Answers Q7 by making its options *configuration* rather than four different implementations.

## It cannot live on DocumentWindow, and the reason is decisive

**Navigation crosses documents.** Jump from the stream to a branched note, to a fileset, back. A `DocumentWindow` is bound to one `Document` — so whatever owns a back stack must sit above it and replace windows as it moves.

It also holds state a window has no business holding: where the user is *in user terms*, how they got there, and the loading policy that decides whether an extension blocks or happens quietly. **A DocumentWindow is a loaded region of one document; a Pane is a person's position in the corpus over time.**

## The naming, settled (D35)

The bare name `Window` collided three ways: a loaded region, an **OS window** (D10's "current window or a new window"), and a UI area. Worse, **`Window` is a DOM global in TypeScript's `lib.dom`** — a bare `Window` type in a renderer process is a live footgun, not merely a vague name.

So: **`DocumentWindow`**, qualified and unambiguous, and **`BufferPosition`** for an offset into its text. `WindowPosition` was rejected for a concrete reason — in an Electron codebase it reads as *screen coordinates*, which is an active hazard rather than an ambiguity. "Buffer" is the standard term for loaded editor text and cannot be misread that way.

The full set now reads: `DocumentPosition` (logical), `BufferPosition` (loaded), `StoragePosition` (internal), `DocumentWindow` (the region), `Pane` (navigation).

## The four options are a policy object, not four implementations

This is the point of the class. Q7's options become settings:

```ts
export interface ExtentPolicy {
  initial: Screens           // load this much on open — small, so opening is instant
  target: Screens            // extend to this in the background while the reader orients
  cap: Screens | null        // stop growing here; beyond the cap, jumping is the affordance
  extendWhenWithin: Screens  // headroom that triggers an extension
  autoExtendOnApproach: boolean
  evict: boolean             // drop the far end to hold memory constant
  maxChars: number           // hard ceiling; the screen arithmetic may never exceed it
}
```

**The unit is screens, not days, and that is a safety property rather than a preference** (D40). A day holds between ~100 KB and the 1 MB split threshold, so `target: days(14)` asks for somewhere between 1.4 MB and 14 MB — and Spike A measured flat cost at 1.05 MB with nothing above it tested. A day-denominated target walks into the region D36's deferral depends on avoiding, silently. `maxChars` is the hard bound that keeps that deferral honest, and it is set to measured ground.

**The rate is measured, not guessed.** `viewportChanged` already carries `from` and `to`, so `to - from` *is* the character extent of one screenful; `ScreenMetric` smooths and clamps those samples, so a full-page figure of forty characters cannot convince the policy that a screen holds forty characters. It adapts to window size, font size and content density with no extra signal.

**A window boundary may therefore fall mid-day**, and the "earlier ▲" affordance names the date of the earliest loaded position. This costs nothing: positions were always `(segment, offset)` and `read` always widened markdown-aware, so partial segments were expressible all along — only `ExtentPolicy` imposed day granularity, and it did so by accident.

| Q7 option | Policy |
|---|---|
| 1 — fixed extent, explicit extend | `autoExtend: false` |
| 2 — auto-extending, no eviction | `autoExtend: true, cap: null` |
| 4 — continuous within a cap, jump beyond | `autoExtend: true, cap: set` |
| 3 — sliding window with eviction | `evict: true` |

**Three of the four are flags. Only eviction is new code** — it is the one that makes scroll anchoring mandatory — and that code is isolated inside `DocumentWindow`. So the evolution can be exactly as described: ship option 1, move to 2-with-a-cap, and add eviction only if the cap proves annoying.

`initial` and `target` differing is what decouples "opens instantly" from "rarely hits the boundary."

## Targets, and a unification

```ts
export type NavTarget =
  | { kind: 'today' }
  | { kind: 'date';     date: DateKey }
  | { kind: 'anchor';   name: string }
  | { kind: 'document'; id: DocumentId; at?: NavTarget }
  | { kind: 'span';     doc: DocumentId; span: Span }   // a search result
  | { kind: 'url';      href: string }                  // browser
  | { kind: 'external'; path: string }                  // OS intent
```

**This is the same taxonomy as a fileset entry** (D10: bookmark, file, URL, external document). They are one type, not two that resemble each other — a section entry *is* a navigation target, which is why clicking one works with no adapter.

## The interface

```ts
export type BoundaryState =
  | { kind: 'open' }                       // more is loaded in that direction
  | { kind: 'extending' }                  // in flight
  | { kind: 'extendable'; earliest: DateKey }   // an "earlier ▲" affordance belongs here
  | { kind: 'capped'; earliest: DateKey }  // beyond the cap; jumping is the gesture
  | { kind: 'end' }                        // genuinely the start or end of the corpus

export interface Pane {
  readonly window: DocumentWindow | null
  readonly location: NavTarget             // where we are, in user terms — the title bar
  readonly boundary: { earlier: BoundaryState; later: BoundaryState }
  readonly canGoBack: boolean
  readonly canGoForward: boolean

  goTo(target: NavTarget): Promise<void>
  goToToday(): Promise<void>               // sugar for the most-used action
  back(): Promise<void>
  forward(): Promise<void>

  /** Explicit extension — the "earlier ▲" affordance. */
  extend(direction: 'earlier' | 'later'): Promise<void>

  /**
   * The editor reports a fact; the Pane owns the policy. This is the whole of
   * the auto-extend mechanism, and inverting it — having the Pane observe the
   * editor — would make X depend on Z.
   */
  viewportChanged(visible: { from: BufferPosition; to: BufferPosition }): void

  policy: ExtentPolicy                     // mutable; that is the point

  onWindowChanged(h: () => void): Unsubscribe       // rebind the editor
  onLocationChanged(h: () => void): Unsubscribe    // retitle
  onBoundaryChanged(h: () => void): Unsubscribe    // repaint the edge affordance
}
```

**`viewportChanged` is the only thing that needs saying carefully.** The editor knows where the viewport is; the Pane knows what to do about it. Reporting upward keeps the dependency pointing the right way and puts every scroll-policy decision in one place, where it can be changed by feel.

## Layering: Pane is Z, and Z now has two tiers

`Pane` is the **view-model** — the model of the UI, not of the domain. It consumes Document, DocumentWindow and Corpus, and X gains no notion of where the user is.

That gives Z the same internal split X has: a state-holding tier (Pane) and a mechanism tier (the CodeMirror view). It is also Portal's finding restated — *model construction separate from view construction* — with the model now having a name and an owner rather than being implied.

**`ui-state.json` is Pane state serialised.** R1.2 requires the open view to survive a restart, and this is what it means concretely.

## Two things that stay off the Pane

**Capture does not need one.** `appendToToday(text)` belongs on Corpus or Document — no navigation, no window, no pane. That is what makes a capture bar cheap to add later, and it is Portal's finding that *the widget is the capture surface, not the editor*.

**Undo does not, either.** Still `document.undo()` (D26): document-scoped, and it can land outside the current window — in which case the Pane is *told* to go there, which is a `goTo`, which is exactly the shape that already exists.

## What this defers correctly

Q7(c) — one pane or a privileged stream pane — stops being an architectural question and becomes a layout one. The application owns a list of Panes; whether one is pinned to the stream is a decision that can be made and remade in an afternoon.
