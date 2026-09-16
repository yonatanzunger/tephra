# Comments

**Answers Q8; dissolves Q9.** R27 and R28 are the requirements; M2 items 5–7 are
the work. An earlier draft of this file proposed a different arrangement; where
this differs from it, the reason is given, and git has the original.

**In one sentence:** a comment is a **thread** — anchored to a range by a marker
pair, written as ordinary blockquotes in the day file, elided from the editor's
prose exactly as markers are, and rendered in the reserved margin.

---

## The one change that moves everything else

Draft 1 put the comment's body **in the buffer** and left "how is a comment body
edited" as its open question. That question is not incidental: the body would be
a block hidden in the middle of the prose, revealed by moving the cursor into it,
which reflows the text the note is anchored beside — Q11's exact complaint, on
the construct least able to afford it.

**The body leaves the buffer, as markers did (D44).** It stays in the file, in
plain markdown, readable by anything — R26 and R27 are about the *file*, and the
file is unchanged. What changes is that the editor never holds it, so:

- **the open question disappears.** The body is not prose in the main column, so
  it is not edited there. It is edited in the margin, where it is displayed —
  which is what the API below exists for.
- **nothing reflows, ever.** No hidden block, no reveal, no Q11 entanglement.
- **`ProseMap` already does it.** A comment block is a marker with width 0 that
  happens to be two hundred characters long. Widths were assigned by role for
  exactly this reason, and comments are the second citizen of that split.

The line D44 drew was *Tephra's syntax is not text; markdown is*. Commentary
sharpens it: **what is not the passage is not in the passage's buffer.** A gloss
is content — durable, printable, readable elsewhere — and it is still not part of
the text it glosses.

## The wire format

```markdown
The passage being commented on<!--tephra:comment-start k3f9--> runs from here
to about here<!--tephra:comment-end k3f9-->, and then the day continues.

> **Yonatan** 2026-08-23T14:02 <!--tephra:comment k3f9-->
> The argument assumes the reader already accepts premise 2.

> **Yonatan** 2026-08-25T09:10 👍 <!--tephra:comment k3f9-->
> On reflection, premise 2 is the interesting part.
```

**A plain blockquote, not a callout.** Draft 1 chose `> [!comment k3f9]`, which
renders as a styled box in Obsidian and GitHub and as the literal text
`[!comment k3f9]` everywhere else. A blockquote with a byline reads correctly in
*every* renderer and never shows a machine token to a human. The Talmudic
arrangement asks the gloss to read as a gloss; a visible identifier is the one
thing that would stop it.

**The identifier is an HTML comment at the END of the byline.** Not the start:
a comment beginning a block's first line makes the whole block an HTML block and
kills its formatting (format-spec, found the hard way). At the end of the line it
is invisible, greppable, and inside the region being elided anyway.

**One representation of every fact.** The byline is both what a person reads and
what Tephra parses. Draft 1's alternative — human text plus machine attributes —
is the same fault this milestone met four times: two copies of one quantity,
drifting quietly.

### The byline grammar

```
> **Author** <ISO-8601> [→ **Assignee**] [<emoji>@name[,name…]]… [resolved] <!--tephra:comment ID-->
```

Whitespace-separated after the author. A token is: an ISO timestamp, `→` plus a
bold name (assignee), a **reaction** — an emoji followed by `@` and a
comma-separated list of who — the word `resolved`, or — crucially — **anything
else, which is preserved verbatim and ignored**. That last rule is what lets this
grow without a format break.

Reactions are written **in the order they were first used**, left to right, so
the file preserves the order for the same reason the API does: three emoji in a
row are a sentence.

```
> **Yonatan** 2026-08-23T14:02 👍@yonatan 🎉@yonatan,rivka <!--tephra:comment k3f9-->
```

Naming the reactor even when there is only ever one is not ceremony: the
alternative is an implicit "whoever owns this file", which is state that lives
nowhere and stops being true the first time a notebook is read by anyone else.
If bylines grow uncomfortable in practice, moving reactions to a marked trailing
line inside the block is a compatible change — unknown tokens are preserved.

Thread-level state (`resolved`, assignee) lives on the **first** message's
byline; repeating it on every message would be a second copy of one fact.

## Threads and messages

- A **thread** is every block sharing one id, in document order. Its anchor is
  the marker pair carrying that id.
- A **message** is one block. Replying appends a block; nothing nests.
- A message is identified by **(thread id, ordinal)**. Ordinals are stable within
  a call because every mutation goes through the API and there is no concurrent
  editor (D12). Per-message ids can arrive later in the free token slot.
- **A thread with no messages is not a thread.** Deleting the last message
  removes the anchor markers too — the same rule as a tag span that covers only
  whitespace, and for the same reason.

**Ids are short random base-36 tokens, not counters.** A counter collides the
first time a commented range is pasted from one file into another.

**Placement: immediately after the block containing `comment-end`.** Local, so a
plain reader gets passage-then-gloss natively. End-of-file placement keeps the
prose contiguous but a day runs to 1 MB, and "at the end" is then very far from
what it is about. Reversible: with the body elided, placement affects plain
readers and diffs, and nothing in the editor.

## Author, assignee, reactions — built, not reserved

Draft 1 reserved these on the grounds that a single user with two devices needs
none of them. True, and beside the point: **they are cheap now and expensive
later.** Each is one token in a line already being parsed and written. Deferring
them means a second pass over the same grammar, a migration for files written in
between, and a UI built twice.

`author` defaults to the machine's user; it is a name in a file, not an identity
claim, and nothing authenticates it.

## Prose width

| Marker | Width | In the editor |
|---|---|---|
| `comment-start` | 1 — a handle | the mark |
| `comment-end` | 0 — a boundary | nothing |
| the thread block | 0 — the whole blockquote, and its trailing blank line | nothing |

Everything MA built applies unchanged: `partnerRemovals` makes deleting the mark
remove the pair, `carve` stops an ordinary deletion swallowing the boundary, and
`ProseMap` maps positions across all three.

**Deleting the mark deletes the thread**, markers and messages together, in one
undo step. This is deliberate asymmetry with the degradation table below:
degradation never loses content, a deliberate gesture may — and the panel says
"Delete thread" rather than "Remove", because the two are not the same act.

## The API

`SpanKind` gains a member. It is a union in this codebase, not a contract with
anyone else, and treating it as frozen was an invented constraint.

**There are two kind-types, and they stay two — but the name was the problem.**
`RawSpanKind` claimed to be a raw form of `SpanKind`, which invites exactly the
question of why both exist. They are not two forms of one thing; they are two
vocabularies:

| | describes | a tag is | has `date` |
|---|---|---|---|
| `MarkerKind` (was `RawSpanKind`) | what one walk of a body FINDS | two findings — a start and an end | no |
| `SpanKind` | what the API EXPOSES | one span | yes |

Turning the first into the second is `resolveTags`'s whole job, and collapsing
them would mean either the scanner reporting pairs it has not paired yet or the
API exposing halves. Renamed rather than merged; `MarkerKind` is private to X and
has no users outside `markers.ts`.

```ts
export type SpanKind = 'date' | 'heading' | 'anchor' | 'tag' | 'comment'
| { kind: 'comment'; name: CommentId; resolved: boolean; span: Span }
```

Spans are what the editor decorates: the mark and the underlined range. The
thread's contents come from a separate call, because a decoration does not want a
message list and the margin does not want to re-derive spans.

```ts
interface CommentThread {
  readonly id: CommentId
  readonly span: Span
  readonly resolved: boolean
  readonly assignee: string | null
  readonly messages: readonly CommentMessage[]
}

interface CommentMessage {
  readonly author: string
  readonly at: string    // ISO-8601
  readonly body: string  // markdown
  /**
   * Emoji → who reacted with it, **in the order the emoji were first used**.
   *
   * A map rather than a list, because the view is the common case and the edit
   * is the rare one: rendering wants `👍 ×3` with the names on hover, which a
   * list of reactions makes you group first, and grouping in the renderer is a
   * derived value computed in two places the moment there are two renderers.
   * Finding your own reaction to toggle it happens far less often than drawing
   * the row, and is a scan over three keys.
   *
   * **Order is content, not presentation.** People spell things with emoji —
   * three in a row are a sentence, not a set — so the order they were added in
   * is preserved rather than sorted by count or by name.
   *
   * A plain object, and that is deliberate: JavaScript preserves insertion
   * order for string keys that are not array indices, which emoji never are, so
   * this IS an ordered map and it survives JSON and both IPC hops unchanged. A
   * `Map` would say so more loudly and would not survive the trip.
   *
   * **Do not sort these keys**, and do not rebuild the object in a way that
   * reorders them.
   */
  readonly reactions: Readonly<Record<string, readonly string[]>>
}

comments(): Promise<readonly CommentThread[]>
commentsAt(at: DocumentPosition): Promise<readonly CommentThread[]>

startComment(span: Span, body: string): Promise<CommentId>
addComment(id: CommentId, body: string): Promise<void>
editComment(id: CommentId, index: number, body: string): Promise<void>
deleteComment(id: CommentId, index: number): Promise<void>
setCommentResolved(id: CommentId, resolved: boolean): Promise<void>
setCommentAssignee(id: CommentId, to: string | null): Promise<void>
/** Toggles the CURRENT user's reaction; there is no reacting on someone's behalf. */
reactToComment(id: CommentId, index: number, emoji: string, on: boolean): Promise<void>
```

**`editComment` exists, and draft 1 was wrong to say it need not.** Its argument
was that the body is prose in the buffer and therefore edited like any prose —
which was true only while the body was in the buffer. It is not, so editing is an
operation, and it is the operation the margin performs. Each of these compiles to
one `replace()`, so each is one undo step.

## Rendering

**The margin.** A rail drawn over the reserved gutter band. The gutter is
`padding-right` on `.cm-content` rather than a grid track, so drawing into it
moves nothing and D42 holds. Notes align to their anchor's line; redraw is
`onSpansChanged`, as tags are (D45).

**The mark** is the drawn mark from MB with a different fill — filled rather than
ringed — and the theme's colour rather than a subject hue, because a comment is
not a subject. The commented range gets a rule in the same stack as tag rules,
dotted to distinguish it.

**Editing happens wherever the note is displayed** — in the rail on the desktop,
in the expanded box on the phone. A message becomes a text field in place and
committing calls `editComment`. There is no second CodeMirror; a comment body is
a few sentences, and a plain field is the honest size of the problem.

**This is the same complaint as reflow, in a different register.** Reflow is bad
because the text moves under the eye; relocating a construct in order to edit it
is bad because **the eye has to move to reach it**, and the cost is the same one —
you lose your place in what you were reading. A note that is read in the margin
and edited in the middle of the column is a note you must look away from twice
per correction.

Stated generally, because it is not about comments: **a construct is edited where
it is rendered.** That is a constraint on any answer to Q11, and it eliminates
the whole family of answers that reveal markup somewhere other than where the
rendered form sits.

**Narrow.** `gutterFits` already computes the fold; the folded state puts each
note beneath its paragraph, ruled rather than floated. Built.

**Mobile.** Settled by the Pixel 9 study: a marker with an open-all control.
Opened, it interleaves *with* its anchor, which is what plain interleaving loses.
**"Apart" was rejected** — a gloss separated from its text stops being a gloss.

**Resolved threads collapse to a count**, mark and all. This is the one place
`resolved` earns its keep for a single user.

## Degradation

| Situation | Behaviour |
|---|---|
| `comment-start` with no matching end | Runs to the end of its date, as an unterminated tag does |
| `comment-end` with no start | Ignored |
| Duplicate id in one file | First wins |
| **Body with no matching anchor** | **Kept, and shown as an unanchored note.** Never deleted — it is commentary, and commentary is content |
| Anchor with no body | The mark offers to remove itself |
| A blockquote with no comment marker | Left entirely alone; it is a quotation |
| An unparseable byline | The message is shown verbatim and is not editable in the rail |

## Q9, dissolved

Draft 1's argument holds and is adopted: **for an imported document the pristine
artifact is the original file, not the conversion.** A `.docx` rendered to
markdown is already lossy and derived; freezing it protects nothing.

Import stores the original untouched in `attachments/` and creates an annotatable
markdown copy. Annotate the copy freely; the original is what a citation points
at. The sidecar argument disappears with the premise, and **Q8 resolves to
inline**.

## Printing: an option, and not only for comments

The print path renders the selection from the buffer, which now excludes comment
bodies by construction — so today they do not print. That is not a default worth
defending, because **there are times when each answer is the right one**, and it
generalises past comments: every piece of apparatus Tephra adds to a document —
tags, bookmarks, comments — has the same question attached, and the answer is a
choice made at the moment of printing rather than one made once in the code.

For comments the choice is three-way, not two, and the third is the interesting
one:

| Mode | What the page looks like | When |
|---|---|---|
| **Without** | the passage alone | handing someone the text, not the discussion |
| **In the margin** | a narrower text column with the notes beside it | the Talmudic page — the arrangement the whole design is after |
| **Inline** | each note interleaved after the block it is anchored to | reading the discussion in order; the same arrangement mobile uses when notes are opened |

**Margin printing changes the page geometry radically** — the measure has to
narrow to make room, so it is not a stylesheet toggle but a second layout. Inline
printing costs almost nothing, because the arrangement already exists: it is what
the folded gutter and the mobile open-all state produce, and the print path can
render the same interleaving.

Tags and bookmarks get the same treatment on a smaller scale: rules under tagged
text and marks in the margin, on or off. The print dialog therefore needs to be
Tephra's own rather than the shell's, which is one more argument for the PDF
preview route M2.4 already took — the options belong beside the preview.

## Genuinely open

Nothing structural. The three-way print choice above is designed but unbuilt, and
so is document-wide printing (M3).
