# Comments

**The design for D47**, answering Q8 and dissolving Q9. R27 and R28 are the
requirements; `milestones.md` M2 items 5–7 are the work.

**In one sentence:** a comment is a *thread* anchored to a range by a marker
pair, whose body is ordinary markdown in the file — visible to any reader,
rendered in the reserved gutter by Tephra.

**One question is deliberately left open** — how a comment body is edited. See
the end.

---

## The wire format

```markdown
Some passage being commented on.<!--tephra:comment-start k3f9--> …
… rest of the range …<!--tephra:comment-end k3f9-->

> [!comment k3f9] 2026-08-23
> The argument assumes the reader already accepts premise 2.
```

**The anchor is metadata and stays hidden. The body is content and stays
visible.** That line is the whole design. Markers work as HTML comments because
an anchor is machine bookkeeping and a plain reader loses nothing by not seeing
it. R27 argues the opposite about commentary — *"commentary is durable content,
and R26 applies to it exactly as it does to the base text"* — so burying a thread
in an HTML comment would make the one part of the document invisible to every
markdown renderer be precisely the part just argued to be as much the document as
the text.

**The body is a callout**, the de facto standard for markdown extensions (GitHub
alerts, Obsidian callouts). It degrades to an ordinary blockquote everywhere,
reads correctly with no tooling, is hand-typable, and **prints for free** because
it is simply text (R11).

**Placement: immediately after the block containing `comment-end`.** Local,
well-defined, and it gives a plain reader the Talmudic arrangement natively —
passage, then its gloss. End-of-segment placement (footnote style) keeps prose
cleaner but a day file runs to 100 KB, so "at the end" can be very far from what
it is about.

**A thread is several blocks sharing one id**, in document order. Replying is
appending another block; nothing nests.

```markdown
> [!comment k3f9] 2026-08-25
> On reflection, premise 2 is the interesting part.
```

## Identifiers, and why they are affordable

Comments need identity in a way tags do not. `format-spec.md` earned the no-id
property with a specific argument — *"same-subject spans may not overlap … tagging
a range that already carries the subject extends or merges the existing span,
**which is what the user means anyway**"* — and that last clause is false here.
Two tags of one subject on a passage **are** one tag. Two comments on a passage
are not, and R27 says several may bear on the same passage.

**But the property was narrower than it looked.** D21's "no id" means *spans
inferred from text need no synthetic key to pair them*; it does not mean names do
not exist. **Anchors already carry file-local names**, unique within a file, with
`duplicate-anchor → first wins` already in the degradation table. A comment id is
that concept, not a new one.

**And the grammar needs no change.** The existing regex takes everything after
the verb as a free-text name:

```ts
/<!--tephra:(mark|tag-start|tag-end)[ \t]+([^\n]*?)-->/g
```

For comment markers that slot is read as whitespace-separated tokens: **the first
is the id, the rest are flags.** Only the verb alternation changes.

**Ids are short random tokens, not counters.** A counter collides the first time
a commented range is pasted from one file into another, and pasting is a thing
people do. Four or five base-36 characters is enough for a file.

The cost is verbosity in raw mode, which `format-spec.md` already lists as an
open judgement call and which this does not worsen in kind.

## What is built, and what is only reserved

| Field | Where | Status |
|---|---|---|
| Range anchor | marker pair | **built** |
| Body (markdown) | callout block | **built** |
| Thread — several bodies, one id | document order | **built** |
| `resolved` | flag token on `comment-start` | **built** |
| Timestamp | visible, in the callout header | **built** |
| Author / assignee | header slot | **reserved, not built** |
| Emoji reactions | trailing line | **reserved, not built** |

Single user, two trusted devices, no sharing model — so assignee, per-comment
author and reactions serve the *standardisation* ambition rather than any Tephra
requirement. Reserving them in the spec costs nothing (unknown content is
preserved verbatim already); building them costs real work. **Design the format
with them; build none of them.**

## The API

`SpanKind` is a locked contract, so this is D47 rather than an edit.

```ts
export type RawSpanKind = … | 'comment-start' | 'comment-end'
export type SpanKind    = 'date' | 'heading' | 'anchor' | 'tag' | 'comment'

| { kind: 'comment'; name: string; resolved: boolean; span: Span }
```

```ts
comment(span: Span, text: string): Promise<string>   // returns the new id
removeComment(id: string): Promise<void>
setCommentResolved(id: string, resolved: boolean): Promise<void>
```

Small on purpose. **Editing a comment's text is an ordinary edit** — the body is
prose in the buffer, so it needs no API of its own, which is the strongest
argument for keeping it there.

## Prose width, and what comes free

`prose.ts` assigns width by role. Comments mirror tags exactly:

| Marker | Width | Renders as |
|---|---|---|
| `comment-start` | 1 — a handle | the numbered circle |
| `comment-end` | 0 — a boundary | nothing |

Which means three mechanisms already built apply unchanged:

- **`partnerRemovals()`** — deleting the numbered circle removes its partner. The
  removal gesture needs no keymap.
- **`ProseMap.carve()`** — protects the zero-width boundary from being swallowed
  by a delete crossing it.
- **`HandleWidget`** is the template for `CommentWidget`; **`tagExtents`** is the
  template for the rail and for underlining the commented range, depth stacking
  included.

## Rendering

**Desktop.** A rail **absolutely positioned over the reserved gutter band**. The
gutter is `padding-right` on `.cm-content`, not a grid track, so drawing into it
moves nothing — which is what keeps D42's invariant true. Notes align to their
anchor's line. Redraw is driven by `onSpansChanged`, as tags are.

**Narrow.** `gutterFits` already computes the fold; `data-gutter='folded'` puts
each note beneath its paragraph, ruled rather than floated. Built.

**Mobile.** Settled by the Pixel 9 study (Q10): a **marker with an open-all
control** — the shaded note box plus a visible anchor showing which passage it
belongs to. Opened all at once this becomes interleaving *with* the anchor, which
is exactly what plain interleaving loses. One arrangement with a collapse state,
not two arrangements. **"Apart" was rejected**: a gloss separated from its text
stops being a gloss.

**Resolved threads are hidden by default**, marker and all, with a count
somewhere unobtrusive. This is the one place `resolved` earns its keep for a
single user.

## Degradation

Extends the table in `format-spec.md`. Every case is reported, never silent, and
**no case loses content**.

| Situation | Behaviour |
|---|---|
| `comment-start` with no matching end | Runs to the end of its **date**, as an unterminated tag does |
| `comment-end` with no start | Ignored |
| Duplicate comment id in one file | First wins |
| **Body block with no matching anchor** | **Kept and rendered in place.** Never deleted — it is commentary, and commentary is content |
| Anchor with no body | Handle renders as an empty thread; removal offered |
| A callout that is not a comment | Left entirely alone |

## Imported documents — Q9, dissolved

Q9 asked whether an imported base text stays pristine, and `open-questions.md`
had it deciding Q8 in favour of a sidecar. **The premise is wrong.**

**For an imported document the pristine artifact is the original file, not the
conversion.** A `.docx` or `.pdf` rendered to markdown is already lossy and
derived; freezing *it* protects nothing that matters.

**The rule, uniform across every inbound path:** import stores the original
untouched in `attachments/` and creates an annotatable markdown copy. Annotate
the copy freely. The original is what a citation points at.

This removes the argument for a sidecar entirely, and **Q8 resolves to inline**.

## Open: how a comment body is edited

**Deliberately unresolved.** The body is prose in the buffer but displays in the
gutter, and the two candidates are:

- **Reveal in the main column.** A block widget hides the body; clicking the rail
  moves the cursor into the block, which reveals by the same `blockRevealed`
  mechanic as tables and equations. One editing surface, consistent with
  everything else — **but it reflows**, and it reflows the text the note is
  anchored beside.
- **Edit in the rail.** No reflow ever, but it is a second editing surface bound
  to a region of the same buffer, which CodeMirror does not make cheap.

**This is Q11, arriving where it said it would.** Q11 names printing and block
constructs as the two tests any candidate must pass, and a comment body is a
block construct that must print. So this is not a corner of Q11 — it may be the
case that settles it.

**How to settle it:** by building both and reacting, which is the precedent the
frame studies set. Nothing above depends on the answer.
