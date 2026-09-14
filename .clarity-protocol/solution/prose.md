# Prose — the document as displayed

> **Decided as D50, and built.** The shapes below are the ones in
> `src/shared/prose.ts` and `src/shared/presentation.ts`; where the sketch was
> wrong — the map — the correction is marked in place and recorded in D50.

## The claim

`document-api.ts` already says the thing, in the box for layer 3:

> **THREE THINGS TRAVEL, and only the first is text:** the text (`ProseText`),
> the mapping (`ProseMap`, per segment, deliberately textless), and the meaning
> (`TypedSpan[]` from `spans()`, which is where a tag's subject and a comment's
> id actually live).

Three values, always assembled together, never meaningful apart. That is a
struct nobody has named — and the cost of not naming it showed up the first time
something outside the editor asked for the document: `proseIn`, written for
printing, throws the annotations away, because throwing them away was the only
option the shape offered.

**So: `Prose` is the document as displayed** — text, the offset map, and
everything anchored into it. `ProseMap` becomes the offset table inside it
rather than the top-level noun.

## The shape

```ts
/** Prose is addressed in one of two coordinate systems, never in both (D48). */
export type Anchored = ProseOffset | WindowPosition

export interface Range<At extends Anchored> {
  readonly from: At
  readonly to: At          // from === to for a point, as everywhere else
}

/**
 * Everything the document holds that is not its text.
 *
 * One union rather than four parallel mechanisms: a day, a bookmark, a tagged
 * range and a comment thread differ in what they carry and in how they are
 * drawn, and in nothing else. They are anchored the same way, they move through
 * an edit the same way, and — the point of the exercise — they are chosen
 * between the same way when something has to decide where to put them.
 */
export type Annotation<At extends Anchored> =
  | { readonly kind: 'day'; readonly range: Range<At>; readonly date: DateKey }
  | { readonly kind: 'anchor'; readonly range: Range<At>; readonly name: string }
  | { readonly kind: 'tag'; readonly range: Range<At>; readonly subject: string }
  | { readonly kind: 'comment'; readonly range: Range<At>; readonly thread: CommentThread }

export interface Prose<At extends Anchored> {
  readonly text: ProseText
  readonly annotations: readonly Annotation<At>[]
}

/** One segment's prose, which has a single map because it has one body. */
export interface SegmentProse extends Prose<ProseOffset> {
  readonly map: ProseMap
}
```

**The map is not in `Prose`, and the first draft of this had it there.** A map
relates one prose to one document text; a segment owns both, and a window owns
neither — it is several segments joined, and a document position is segment plus
offset (D48). See D50's revision note. Nothing downstream wanted it: the printer
converts no coordinates, and the renderer builds its own maps from the markers
the snapshot already carries.

**Generic over its coordinate, and that is not decoration.** A segment's prose is
addressed in `ProseOffset` and a window's in `WindowPosition` (D48); the same
struct at two scopes, with the compiler refusing to mix them. `Prose<ProseOffset>`
is what a `Segment` produces; `Prose<WindowPosition>` is what a `DocumentWindow`
serves and what a printer consumes.

**A day is an annotation.** It reads as a stretch, but the day seam is already a
block widget over a range, special-cased in `days.ts`; making the day an
annotation is what lets it pick up the same treatments as everything else —
which is exactly what "could be absent, a page header, or a section break"
requires.

## The treatments, per kind

Each kind can be drawn several ways, and the ways are *not* interchangeable
across kinds — a day cannot be a footnote, and a comment has no business being a
running head. So the policy is one field per kind, each with its own union,
rather than one enum for all of them.

| Kind | Treatments | Where each already exists |
|---|---|---|
| **day** | `absent` · `seam` (a rule across the measure, dates either side) · `pageHeader` (a running head, paper only) | `seam` on screen, `days.ts` |
| **anchor** | `absent` · `margin` (a mark in the reserved gutter) | on screen it is inline today — a handle in the text (D44) |
| **tag** | `absent` · `inline` (the stacked underlines) · `margin` (the subject beside the passage, on paper) · `byExtent` (D82: `inline` under a phrase, `spine` over a region) | `byExtent` on screen — `tags.ts` for the rules, `tag-spines.ts` for the band |
| **comment** | `absent` · `inline` (as mobile shows it) · `margin` (the rail) · `footnote` · `endOfSection` | `margin` on screen, `Rail.tsx`; `inline` is Q10's mobile arrangement |

```ts
export interface Presentation {
  readonly day: 'absent' | 'seam' | 'pageHeader'
  readonly anchor: 'absent' | 'margin'
  readonly tag: 'absent' | 'inline' | 'margin'
  readonly comment: 'absent' | 'inline' | 'margin' | 'footnote' | 'endOfSection'
}

export const DESKTOP: Presentation = { day: 'seam', anchor: 'margin', tag: 'inline', comment: 'margin' }
export const MOBILE: Presentation  = { day: 'seam', anchor: 'margin', tag: 'inline', comment: 'inline' }
export const PAPER: Presentation   = { day: 'seam', anchor: 'margin', tag: 'margin', comment: 'footnote' }
export const CLEAN: Presentation   = { day: 'absent', anchor: 'absent', tag: 'absent', comment: 'absent' }
```

**Inline versus margin stops being two features and becomes one setting.** Today
comments have a rail and tags have an underline, which is not a decision anyone
made — they are two mechanisms that grew a fortnight apart. Under one policy,
desktop and mobile are the same renderer with different defaults, and the print
switch is that same field with a third default.

## One placement pass, two renderers

The part worth sharing between screen and paper is not the drawing — a
CodeMirror decoration and a `<aside>` have nothing in common — it is the
*decision*: which annotations are in the flow, which are in the column, which
become notes, and in what order they are numbered when they do.

```ts
export type Slot = 'none' | 'flow' | 'margin' | 'foot' | 'section' | 'head'

export interface Placed<At extends Anchored> {
  readonly annotation: Annotation<At>
  readonly slot: Slot
  /** The mark at the anchor point, for a slot that is somewhere else. */
  readonly cue: string | null
}

export function place<At extends Anchored>(
  prose: Prose<At>,
  how: Presentation,
): readonly Placed<At>[]
```

- **The screen renderer** turns `Placed[]` into decorations: `flow` into inline
  marks and widgets, `margin` into rail entries at the anchor's line, `section`
  into a block closing the day. `foot` and `head` are paper's, and a screen
  asked for them falls back to `section` — **the on-screen cousin of a footnote
  is the end of the section**, since a scrolling document has no page to sit at
  the foot of.
- **The paper renderer** turns the same `Placed[]` into HTML: `flow` inline,
  `margin` into a floated column, `foot` into real page footnotes (paged.js —
  see below), `section` into notes closing the day, `head` into a running date.

A third renderer — an export, a mobile view, a filtered view — is then a
`Presentation` and a drawer, not a new pass over the document.

## What is genuinely hard, said plainly

- **Footnotes need pagination, and the web does not have it — so paged.js.**
  Chromium's print path has no CSS footnotes: a note at the foot of *the page its
  anchor fell on* means knowing where the pages break. `paged.js` is the library
  that knows (~200 KB, and it takes over layout, which is why it is confined to
  the print path and never loaded by the editor). Notes closing each day's
  section remain available as `endOfSection` — that is the on-screen treatment,
  and the fallback if paged.js proves to be more trouble than a footnote is
  worth. Endnotes for the whole document are not on the list.
- **Margin alignment collides.** Two annotations anchored three lines apart
  overlap in the column; the rail already solves this on screen by stacking, and
  the paper renderer needs the same pass rather than a fresh one.
- **A tag in the margin is a range, not a point.** It needs a vertical rule with
  an extent and a label beside it, which is a different primitive from a note
  aligned to a line. *(Built on screen as the spine, D82 — and the label was the
  part that did not survive: three lanes leave no room for three captions, so the
  rule is silent and the subject lives in the tooltip and the panel, which is
  what D44 already said about marks.)*
- **Not every payload survives every slot.** A comment thread in a footnote
  cannot show its reactions or its assignee; what a treatment *drops* should be
  in the design rather than discovered on paper.

## What it would cost

- `Segment.prose` returns `Prose<ProseOffset>` with its annotations, absorbing
  the scan `spans()` does today.
- `DocumentWindow` serves `Prose<WindowPosition>`; `spans()` becomes a filter
  over it rather than a parallel path. The snapshot already carries the markers
  and the spans, so the wire does not change shape — only who assembles them.
- The rail and the tag decorations read `Placed[]` instead of `TypedSpan[]`.
- `proseIn(from, to)` becomes `proseIn(from, to, presentation)`, and today's
  behaviour is the `CLEAN` preset.

## Open questions this raises

- **What does the print dialog ask?** A preset ("as on screen" / "clean" /
  "with notes"), or four switches, or a preset with a disclosure? Four switches
  is sixteen states to have opinions about.
- **Does the screen policy follow the width automatically** — the reserved
  gutter is D42's, and a narrow window has nowhere to put a rail — or is it a
  setting a person chooses once?

## The fifth kind, when it comes

**A footnote is not a comment**, and the difference is authorship: a footnote is
the document author writing more of the document, a comment is commentary about
it (D47's distinction, one level up). They differ in almost nothing else — both
anchor to a point or a range, both carry markdown, both move through an edit the
same way — so a footnote is a fifth `Annotation`, not a second mechanism.

What it buys immediately is the combination the union was shaped for: **notes at
the foot of the page and commentary in the margin, in one print.** That is
already expressible — `{ footnote: 'foot', comment: 'margin' }` — because
treatments are per kind. Adding the kind is an entry in the union, a case in
`proseOf`, and a field in `Presentation`; nothing else moves.

Its treatments would not be a comment's: `absent | foot | endOfSection | margin`
(a sidenote is a respectable footnote), and **not `inline`** — a footnote drawn
inline is just text, which is what the author would have written instead.

The open part is the encoding, and it is a real fork:

- **GFM's `[^1]` and its definition.** Readable as a footnote by every markdown
  renderer that supports them, which is the R26 argument that made comment
  bodies visible content rather than HTML comments. Costs a parser extension —
  `@lezer/markdown`'s GFM has Table, TaskList, Strikethrough and Autolink, and
  no footnotes — and a rule about WHERE the definition lives in a day file.
- **A marker pair, as comments have.** Consistent with D47, degradation rules
  already written, no parser work — and an HTML comment where a reader of the
  raw file would expect to see the note.
