# An API for agents — notes toward one

> **Notes, not a design.** Written 2026-09-16, immediately after converting
> `lima/miraflores-todo.md` into twelve matters by hand, while what was missing
> was still concrete. The project entry is in `../milestones.md`; this is the
> material it will be designed from.

## The requirement, stated as a test

**A model must be able to operate the notebook without reading the codebase.**
That is the user's own framing and it is a good test, because today's conversion
failed it: writing one docket file by hand took reading six source files —
`shared/kinds/docket.ts` for the matter grammar, the step grammar, the four
modes and the interval units; the writer to learn field order; `shared/dates.ts`
to check offsets.

**There are two ways to pass the test, and only one of them holds.** Document
the file format *for models*, or make the file format **unnecessary**. A document
describing the format is a second copy of the grammar, and this project has
watched two copies of one fact drift quietly four times in one milestone (the
comment byline's reasoning says it plainly: *one representation of every fact*).
So: the door offers **operations**, the app owns the serialisation, and a model
never writes a matter block at all.

## What the file path actually cost, itemised

Worth keeping, because each line is a thing the operation path already solves:

- **Fourteen step ids minted by hand.** Needed because `after <id>` is
  matter-local and resolved against ids I could not know before writing.
- **`after` targets validated by a throwaway script.** Reading a file back takes
  the token *verbatim*: a reference to a step that does not exist parses
  happily, stores, and then **never comes due, silently**. The code says so in a
  comment; nothing enforces it at the boundary.
- **Field order copied off the writer**, so the app's first rewrite would not
  produce a diff that was purely cosmetic.
- **A parse-and-simulate harness written from scratch** to answer *what would
  this generate today* before letting it near a real notebook.

## What the first import found, within the hour

**The file was valid and the app could not see it** (note 67). Twelve matters
and sixty-two steps parsed, rendered, and generated nothing, because the
reconciler addresses by id and an unmarked block has no id until Tephra writes
it. The grammar promised that write and only the *verbs* performed it, each
adopting the one block it touched. Adoption is a reconciliation clause now.

**Two lessons for the door, both of them sharper than anything above.**

1. **A file written by an agent is not the same as a file written by a verb**,
   even when the bytes are identical, because the state that makes a record
   *addressable* is assigned on the way in. A door offering operations has this
   for free; a door that accepts files needs an adoption pass behind it, and
   must say so.
2. **The test could not have been written through the app.** Suites and scenes
   both act through Tephra, so neither can produce a file Tephra did not write.
   The integration fixture now takes a **seed** — files placed in the notebook
   before it is opened — which is the honest stand-in for *edited while closed*
   and is the shape every future test of agent-written files will want.

## The finding that reframes the project

**The operations already exist.** The renderer reaches **thirty-three** docket
operations and **twenty-four** list operations, plus nav, search and comments —
every one of them named, validated, and going through the services that own the
lock and the WAL. Today's conversion needed `add`, `addSection`, `addStep`,
`setStart`, `setMode`, `setOwner` and `editStep`. All seven exist.

And the sharpest example: `addStep(matter, when, text, kind)` takes `when` as
**text**, and resolves it with the step list in hand — so through that operation
*`then`* and *`after 3`* are legal, an index becomes an id, and **a reference
that resolves to nothing is refused rather than stored.** The one thing I spent
the most care on by hand is the thing the operation already does better.

So this is not *build an API*. It is **project the existing API through a second
door**, which is exactly the shape D83 left behind: a service declares which
door it answers, and `told(serveAsked(...))` already distinguishes two of them.
This is a third.

## The surface, as a first cut

| Reading | | Writing | |
|---|---|---|---|
| `today()` | the date the notebook is on (D62) | `docket.add / addSection / place` | a matter, where it goes is said and never guessed |
| `search(query)` | the v1 query grammar, unchanged | `docket.addStep / editStep / setStepWhen` | steps, with `then` and indices resolved |
| `read(ref)` | a document by `tephra:` reference or id | `docket.setStart / setEvery / setMode / setOwner / suspend` | the schedule fields, mode-checked |
| `dockets() / matters(id)` | **structured**, not the raw file | `todo.add / setStatus / setOwner / setDue / setFor` | list items as records (D85) |
| `tasks(list, day)` | items with their fields | `document.create(kind, title)` | unnamed lands in `drafts/` (D90) |
| `horizon(window)` | everything bearing down | `comment.add / reply` | the conversation shape, if that is built |

Nothing in the left column is new. Nothing in the right column is new either —
what is new is that a caller outside the renderer can reach them.

## Six rules the door needs, each from something that happened

1. **Propose, then apply.** A write returns the diff it *would* make and what it
   *would* generate; nothing lands until a person says so. I hand-rolled this
   today and it is the only reason writing to a real notebook was defensible —
   it is the affordance, not a courtesy. Today it also produced the number that
   mattered: *fifteen new items on today's list*.
2. **Provenance is a parameter.** Every write carries who made it, and it lands
   in the file. Today's import is unmarked, and the only reason that is
   tolerable is that the file was small enough to remember. D79's provenance on
   a generated step is the precedent; the snippets question is the failure.
3. **Amend by id, not only append.** The real work today was **reconciliation**:
   the source file silently refined four steps that already existed, un-blocked
   a fifth, and duplicated two more. An append-only door would have produced a
   docket with everything twice, and would have looked like it worked.
4. **Refuse what cannot be made valid, and name the field.** Dangling `after`,
   an unknown mode, a step on a matter that is not there. The file boundary is
   lenient by design (R26) and that leniency is right for a *person* editing in
   vim; a machine caller should get the strict boundary instead.
5. **One writer.** The door is served by the running app, so writes take the
   same lock and the same WAL. When the app is not running the door is not open
   — and the fallback is what today did: quit first, write the file, reopen.
6. **Reads are scoped, and the corpus is not a bulk export.** This is the
   disclosure question D69 never had to ask. Reading a range or a docket is a
   scoped request; *read everything* is the shape to refuse.

## Making it self-describing

The requirement is that a model arrive knowing nothing. What it needs:

- **Operation schemas with the enumerations in them** — the four modes, the step
  kinds, the status glyphs, the field names of a list item.
- **The vocabularies that are not types**: the offset grammar (`+0d`, `-14d`,
  `after <step> +90d`, `then`), the interval grammar (`90d`, `1y`, `1m on 15`),
  the reference scheme (`tephra:todo/<id>`, `tephra:section/<name>`).
- **One `describe()`**, returning the whole contract in one call, so a model's
  first question is never *where is this written down*.

**And it must be derived, not written.** A hand-maintained guide for models is a
second copy of the format — the exact failure this file opened with. The modes
are already a table in code (`MODES`), the field names are already a parse
switch, the offset grammar is already a regex with a comment: the manifest
should be generated from those, and the prose kept to what cannot be.

## What a schema cannot carry, and today proved it

The format was the easy half. These are the judgements that made the conversion
good rather than mechanical, and they belong in the guide as worked examples:

- **Fifty-two tasks became twelve matters, not fifty-two.** A docket holds what
  you reason about as a group; the opposite failure is D72's *one trip becoming
  five sibling matters that must be edited together*.
- **A deadline is a `start` with the run-up hung off it in negative offsets.**
  *File by the 25th, not the 29th* is a step at `-5d` on a matter starting the
  30th. Nothing in the schema suggests this; it is the whole trick.
- **No `start` is the throttle.** Three sections of the source were gated on
  dates nobody has yet, so those matters got no start: the plan is recorded, the
  chains are intact, and nothing generates. That is what made importing fifty-two
  tasks safe rather than an avalanche, and it is why the answer to *how do I
  import a big plan* is a property of the schedule rather than a rate limit.
- **Chains live inside a matter**, because `after` is matter-local. The critical
  path decides the grouping, not the source document's headings.
- **A field where it is singular, prose where it is not.** Owners became
  `owner: Paola` on matters with one, and stayed in the step text where two
  people share the work — because the alternative is a name in a field that is
  true of half the steps.
- **Read before writing.** The interesting question was never *what does this
  file say*; it was *what does the docket already say about it*.

## Waiting on

**Which operations use actually demands**, which is what more conversions like
today's will say. The surface above is a guess made from one exercise, and the
cheapest way to be wrong is to build all fifty-seven doors before knowing that
six of them carry the traffic.
