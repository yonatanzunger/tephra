# The wire format

> **Locked as the v1 draft, 2026-08-12.** Changes from here need a decision record, not an edit. Build-time obligations live in `implementation-notes.md`.
>
> **Amended by D44/D47** (marker verbs: comment anchors and thread blocks) and **D53** (the reference URI namespace, and `sections/_index.fileset.md` as the nav's top level).

A storable state adequate to the Document API (D18). Everything here exists because the API exposes a fact that must survive a restart; nothing here exists for its own sake.

**Governing discipline** (Portal D31, carried): *parse leniently, serialize precisely, round-trip untouched content byte-for-byte.* Hand-editing is a feature, so every rule below has a defined degradation.

## Directory layout

```
notebook/
  notebook.stream/2026/03/2026-03-14.md     day file
  notebook.stream/2026/03/2026-03-14.2.md   part 2, if that day was split
  tasks.todo/2026/03/2026-03-14.md          the distinguished task list, a day at a time
  blog-posts.todo.md                        an OVERALL list: no days, no walk (D55 as amended)
  notes/titration-curves.md                 branched documents, pinned lists
  sections/_index.fileset.md                the nav's top level: a fileset of filesets (D53)
  sections/house-deal.fileset.md            nav sections (D10)
  attachments/2026/03/2026-03-14-plot-a1b2c3.png
  config/themes/aldine.json                 authored themes; selection is machine-local (D41)
  .tephra/                                  journal, index, caches — MACHINE-LOCAL, NEVER SYNCED
```

> **`stream/` became `notebook.stream/` in MT1** (D59): **a multi-file document
> is a directory named by its kind**, so the same rule that reads
> `tasks.todo/` reads the stream, and `kindOf` walks up a path until a name
> declares a kind. The rename was a directory rename and nothing else — which
> the `migrated` acceptance scene exists to keep true.

Year/month nesting keeps any directory under ~31 entries; twenty years is roughly 5 000 day files. **`.tephra/` is excluded from sync by construction** — it holds the durability journal and any derived index, both machine-local and disposable (D7).

> **This layout describes the *versioned* notebook (D46).** A shreddable notebook holds the same format — same markdown, same frontmatter, same markers, same degradation table — but with the bytes encrypted at rest, opaque object names, and an encrypted index in place of the dated directory tree, because filenames would otherwise disclose which days have writing and when something was deleted. **The format does not fork; only the storage does.** See `shreddable-notebook.md`.

**Type is declared by filename suffix, mirrored in frontmatter** (D3). `.md`, `.todo.md`, `.fileset.md` — everything stays `.md` so external tools see markdown, the name declares the type so nothing is inferred from context, and the mirror in frontmatter survives a rename. **A multi-file document declares its kind in its directory name instead** (D59): `notebook.stream/`, `tasks.todo/`.

## Frontmatter

```yaml
---
tephra: 1
date: 2026-03-14      # stream files only
part: 2               # only when a day is split
kind: markdown        # markdown | todo | fileset | stream
---
```

**No origin fields** (D27). A branched document is not in the dated stream, and giving it a date to pretend otherwise is exactly the contortion this design keeps refusing. The relationship that matters is the **link left behind in the stream**, which points the useful direction — from where you were to where the material went. The reverse pointer is curious history.

**`date` is computed in a zone the person chose, never in the device's current one** (D38 as superseded by D63). It is the stream's ordering axis and is assigned automatically, so the zone it is computed in belongs to the notebook rather than to the machine: it is kept in `config/` and travels with the corpus, because a zone that differed between devices would file the same evening under two dates. The system's zone is *offered* when it disagrees and never applied on its own — what fails is a zone that changes itself, not one that is local. An unset notebook means UTC−8, which is what every corpus written before this said.

**And the date is the WRITING day, not the calendar day** (D62): it advances to the calendar date only once writing has stopped for long enough that somebody has plainly got up, so a passage typed at 00:30 files under the evening it was written in. Times are *displayed* locally; the filing date is the notebook's.

**Frontmatter is authoritative; the filename mirrors it.** If they disagree — a human renamed a file — frontmatter wins and the mismatch is offered for repair. Enumeration may use filenames as a hint, verified lazily, so the common path does not open 5 000 files.

**Unknown keys are preserved verbatim** on any rewrite.

## Markers: anchors and tags

The API needs anchors that travel with the text, and tags over freely-overlapping ranges (R12, D11, D20). Both are **HTML comments**, which are invisible in every markdown renderer, greppable, hand-typable, and self-describing to a reader fifteen years from now.

```
<!--tephra:mark titration idea-->
<!--tephra:tag-start house deal-->
<!--tephra:tag-end house deal-->
```

**Paired point markers are what make overlap work.** Nested delimiters cannot express a tag over lines 3–8 crossing one over 6–12; four independent points can. A bookmark is an unpaired marker and a tag is a named pair — one mechanism, as D20 anticipated.

**Same-subject spans may not overlap, and this removes the need for identifiers.** For a given subject, markers strictly alternate start/end, so pairing is unambiguous with no ids. Tagging a range that already carries the subject extends or merges the existing span, which is what the user means anyway — "everything tagged *house deal*" has never cared how many separate spans there are.

**Subject names** are free text without newlines or `-->`. They are **compared case-insensitively and whitespace-normalised, but stored as typed** — so *House Deal* and *house deal* are one subject and the capitalisation survives.

**A marker never begins a line, and is never appended to a delimiter line.**
This is a rule about where the bytes may sit, not about what they mean, and it
is forced by CommonMark rather than chosen: a comment beginning a paragraph's
first line turns the whole paragraph into an HTML block, so its formatting dies
in *every* renderer; and appending to a line whose meaning is its exact contents
— a code fence, a table row, a setext underline — stops that line being what it
was, which in the case of a closing fence means everything after it becomes
source code. So a marker asked for at a line start moves back to the end of the
line above, unless that line is a delimiter or there is no line above, in which
case it takes a line of its own. Both faults were found by doing it wrong: the
first by bookmarking a boldfaced phrase, the second by tagging the first line of
prose after a fenced block.

**Anchor names are unique within a file.** Across the corpus they may collide, and resolution then surfaces a picker rather than guessing (D11).

## The split rule

A day file splits when it exceeds **1 MB**, at the last paragraph boundary at or before the threshold; subsequent parts follow the same rule. Parts share a `date` and are ordered by `part`.

**1 MB is measured rather than guessed:** Spike A ran a 1.05 MB document at flat cost. Note that this threshold and the **window extent** are different knobs — the window may hold many day files, and it is the window extent, not the file size, that R1.1 depends on. Spike A bounds the window; the split threshold only bounds one file.

**The requirement is prefix-stability, which is stronger than determinism and is the property that actually matters.** The boundary of part *k* must depend only on the content before it, so that appending never moves an existing split. A threshold-at-a-paragraph-boundary rule has this property; a rule keyed to total size, or to when a save happened, does not. Without prefix-stability, appending to a day would reshuffle its files and manufacture divergence out of nothing.

**Adjacent parts coalesce into one date span above the storage layer** (D20), so a split is invisible to the API.

At roughly 100 KB a day, a 1 MB threshold means splitting will essentially never happen — which is its own hazard. **A path that fires once every few years is broken when it fires**, so it needs a test that forces it with a synthetic oversized day rather than waiting for one to occur.

## Attachments

Images are written as files and referenced by ordinary relative markdown links; no embedded payloads.

```
attachments/2026/03/2026-03-14-plot-a1b2c3.png
![Titration curve](../../../attachments/2026/03/2026-03-14-plot-a1b2c3.png)
```

Three levels up, because a day file sits at `notebook.stream/YYYY/MM/`. The short content hash prevents collisions and makes duplicate detection possible later. Ordinary links mean any renderer shows the image and the exit stays real.

**As built (R7).** The hash is the deduplication *and* the collision guard: the
same screenshot pasted twice writes the same path with the same bytes, and two
different pictures cannot share a name unless they are the same picture. The day
in the name is **the day it arrived**, whatever it was pasted into — a picture in
a note has no date of its own, and the day it turned up is the only honest one.
Three doors reach it: paste, drop, and a file picker.

**And the link is relative in the file while being absolute on screen.** The
renderer is served from `tephra://app`, so a relative `src` resolves against the
bundle, not the corpus — which is why every inline image in the app was broken
until the corpus was given a host of its own (`tephra://notebook/`, read-only and
rooted). Where a relative link resolves *from* is layout knowledge, so the
renderer asks main for it once per document rather than guessing.

## Task lists

**A task list is a text kind, and a day is a segment** (D55) — the same shape as
the stream, so it inherits the whole `SegmentedDocument` machinery rather than
forking anything. **Two shapes of one format** (D55 as amended): a `.todo`
*directory* is a daily list, carried and walked; a single `.todo.md` is an
overall list, which does not turn over daily and so has nothing to carry.

**An item is a record, and the file holds it as fields** (D85) — the way a docket
holds a matter, so the notebook has one dialect and not two:

```markdown
- [/] Approve Paola's proposal
  tags: #lima
  for: House Bootstrap / Initiate Remodel
  due: 2026-09-13
  owner: AV
  the number is in the email from Tuesday
  <!--tephra:item 7f3a1b2c 1756684800 1756771200-->
```

> **Identity in comments, data in fields, prose bare.**

**The checkbox stays a marker**, not a `status:` field: it is status in markdown's
own vocabulary, so the file reads as a checklist and changing one by hand is one
character. `[ ]` not started, `[/]` in progress, `[?]` blocked, `[x]` done, `[-]`
nevermind, `[>]` transferred to a docket.

**Field order is fixed** — `tags`, `for`, `due`, `owner`, `moved`, `reason` —
which is what makes writing an unchanged record a no-op in the bytes, so a due
date moving touches one line of the history rather than rewriting the item.

| field | what it says |
|---|---|
| `tags` | subjects, written as they are inline: `#lima #'Kia Repairs'` (T5, T6) |
| `for` | the context the sentence was written against — a docket's section and matter (MT8). Explanatory text, repaired by reconciliation, never edited by hand |
| `due` | `YYYY-MM-DD`, always absolute: a relative date is resolved the instant it is recognised (T16) |
| `owner` | who has this (D81) |
| `moved` | which docket it was transferred to, beside `[>]` (MH5) |
| `reason` | why it is blocked, and only while it is (T4) |

**The marker carries identity and two timestamps** — created, and last touched —
because those cannot be backfilled (`goal/scope.md`'s rule) and because an item
is copied forward verbatim on every carry, so one id appears in many days with
the status it had on each. **The newest instance is what the item IS.** It is on
its own line so that the sentence's line changes only when the sentence does.

**Notes are bare indented lines** (D56 as amended), parsed as prose and nothing
else: no tags, no dates, no nested items. A line whose key this format does not
know, or whose value does not parse, **is prose** — so a note reading *due:
whenever we get round to it* stays a note rather than being absorbed and lost.

### Two parsers, and only one has an inverse

> **structure → string → structure is the identity.** string → structure → string
> is not, and is not attempted.

The field form above is read and written by one pair that round-trips. The
**entry grammar** is the other reader: `#tag`, `DUE friday`, `OWNER Sam` typed
into a field — or into a file by hand — read into a record and never written back
that way. It is what those notations were always for, and it is why an old file
needs no migration beyond **reading it and writing it**.

## Sections

A section is a fileset: an ordered list of typed references, rendering as a perfectly ordinary markdown document (D10).

```markdown
---
tephra: 1
kind: fileset
title: House deal
---

- [Mortgage contact](tephra:mark/mortgage%20contact) — call before Thursday
- [Offer letter](../docs/offer.pdf)
- [The listing](https://example.com/…)
```

**Entry type is inferred from the link target**, so there is no type field to keep consistent. **The trailing text after the link is the summary** — human-authored, and the place regeneration must never clobber (R20). v1 uses only title and target; the summary has a home from day one because coverage cannot be backfilled.

### The reference URIs (D53)

One host per kind, and the kinds are the sidebar's (D51) — a curated row and a
built-in row are the same row, so a section has to be able to name what the
built-in sections name.

| Entry | Written as | Resolves by |
|---|---|---|
| bookmark | `tephra:mark/mortgage%20contact` | name, first in date order (D11) |
| subject | `tephra:tag/House%20Deal` | every range carrying it |
| day | `tephra:day/2026-08-24` | the date |
| section | `tephra:section/house-deal` | the fileset of that name |
| file | `../notes/titration.md` | a relative path |
| URL | `https://example.com/…` | the browser |
| other document | `../docs/offer.pdf` | OS intent |

**The two that are paths stay paths.** Only the things that resolve by identity
take the scheme, which is what keeps a section file useful in any other markdown
tool: three of the six kinds are ordinary links, and the other three read as
what they are even where they do not resolve.

The app itself is served from `tephra://app` — an authority form — and
references are path-only, so the two namespaces cannot collide.

### `_index.fileset.md` — the nav's top level

`sections/_index.fileset.md` is an ordinary fileset whose entries are mostly
`tephra:section/…` references, in the order the panel should show them. It is
one file to read with an explicit order in it, which is the argument D10 made
for membership over flags — and **it is also where a pin goes when nobody says
where**, which is why there is no separate default-section file (D53 amends D10).

The leading underscore is a collision guard, not a convention: a person may
reasonably name a section "index".

## `.tephra/` — machine-local state

Never synced, and — with one deliberate exception noted below — entirely disposable. Deleting it must cost nothing but a rebuild.

```
.tephra/
  version                     on-disk state version for this directory
  lock                        single-instance guard
  wal/<doc-id>.jsonl          changes since the last file write — SECONDS, not a history
  index/<dir>.json            the CORPUS index — a cache of a scan, per directory (D52)
  issues.json                 cached anomaly list from the degradation table
  attachments.manifest        what has been evicted versus what is actually gone
  ui-state.json               every open window's location and cursor, plus the
                              machine's theme, list arrangement and search width
```

**`index/` is not the search index.** It is D52's cache of what a scan of each
directory found — subjects, bookmarks, headings, links, task items — keyed by
file and stamped with size and mtime, so verifying it is one `stat` per file. The
*text* index that makes search stop scanning is v2 (D23) and has no home here
yet. The distinction matters because the two have opposite properties: this one
may be deleted at any time and costs only the time to look again.

**And it does that now, which it did not until MS1.** The sweep compared
`heldSegment`'s `undefined` against `null`, so every day file reported as *held
by the editor*, every sweep took the branch meant for unsaved edits, and a cache
entry was never written for a single day file — the store held `notes.json` and
nothing for the stream. Found because search's central claim is that narrowing
prevents reads.

**`ui-state.json` holds a SET of windows** (MC6), not one: somebody who left a
note open beside the stream left an arrangement, and reopening only the last
window throws the arrangement away. Machine-local settings sit beside it —
which theme, how the task list is arranged, how wide the search panel was
dragged (D30, D41).

**`lock` is not optional.** Two Tephra processes over one directory would fight over the journal and the fold, and the failure would be corruption rather than an error.

**`attachments.manifest` exists to keep a D5 distinction from collapsing.** Attachments are a cache and may be evicted (D5); text is a replica and may not. But an evicted attachment and a deleted one look identical on disk — a missing file — and that is exactly the replica/cache confusion D5 was written to prevent, reappearing one level down. The manifest is what makes "evicted, refetchable" distinguishable from "gone."

**`ui-state.json` has an unresolved requirement behind it.** R1.2 asks that scroll position, cursor and open view survive "app switches, crashes, device changes and sync." *Device changes* implies some of this should **sync**, which contradicts `.tephra/` being machine-local. Resuming on the phone where the Mac left off is a real and plausible reading; so is "never lose your place on this machine." **v1 keeps it machine-local**, since v1 has no sync — but if it is ever to sync, it needs a home in the synced tree, and that is a coverage decision rather than a mechanism (the backfill rule). Left open deliberately.

## The WAL

`.tephra/wal/<doc-id>.jsonl` holds serialised `DocumentChange` records — appended on every change, replayed after a crash, folded into the text files and truncated once they are written. Machine-local, never synced.

**It is measured in seconds, and that is the whole of its job** (D32). It covers the gap between memory and disk, nothing more. Being that short-lived is what makes it safe: it cannot become a second history, so it can never disagree with one.

**What was destroyed lives in the repository instead.** The git history is durable, versioned, and from v2a cross-device — strictly better than a local retention window, and it is what retired D28's 30-day journal along with the ambiguity of a mechanism that was both a durability device and a history.

**What bounds rewind is the session, not a retention period.** `rewindTo` (D29) reaches any generation in the in-memory undo stack, which begins at process start; older states are reached through `History.restore` at commit granularity. Undo therefore does not survive a restart — accepted deliberately (D32), on the grounds that this is VSCode plus git, used daily without friction, where the post-restart recovery path is the history rather than ⌘Z.

**One consequence that must be stated, not discovered: deleting text from Tephra does not delete it from the repository.** It survives there permanently, and from v2a on the hub as well, so purging genuinely-unwanted content is a history rewrite rather than a deletion. **The mitigation is a documented purge procedure, not a button** — [purge-procedure.md](purge-procedure.md) — and it is honest about costing a force-push after v2a. Because v1 has no remote, the exposure is bounded to one machine and the procedure is owed **before the first push, not before the first commit** (T10, D36).

## Degradation — the hand-editing contract

Every one of these is **reported, never silent**, and none of them loses content.

| Situation | Behaviour |
|---|---|
| `tag-start` with no matching end | The tag runs to the end of its **date**, not the document. Bounded blast radius |
| `tag-end` with no start | Ignored |
| Duplicate anchor name in one file | First wins |
| Filename and frontmatter date disagree | Frontmatter wins; repair offered |
| Frontmatter missing but filename is a date | Date inferred from the filename; adding frontmatter offered |
| **Malformed YAML** | Treated as absent — and **the file is never rewritten.** Never overwrite what you could not parse |
| Unknown frontmatter keys | Preserved verbatim |
| CRLF, missing trailing newline | Accepted on read; normalised only on lines actually edited |
| A section entry that resolves to nothing | Shown, dimmed, marked *not found* — **never hidden**. The corpus is hand-edited and synced, so a dangling reference is ordinary; hiding it makes an edit look like data loss, and the entry is the only record of what was meant (D53) |
| A section naming a section that is already open above it | Rendered as a plain entry rather than expanded again; depth is capped at three (D53) |

## Two things that will bite if left implicit

**Markers inside code blocks must not be interpreted.** This is a physics notebook; it will contain fenced code, and code about Tephra will contain Tephra markers. So the parser must be **markdown-aware, not regex-based** — and so must v1's scan-based search and enumeration, which was previously described as "grep for markers." A fence-aware scan is barely more expensive; a regex scan is wrong in a way that only shows up once, embarrassingly.

**A rewrite must preserve everything it did not change, byte for byte.** Writes are whole-file atomic replacements, which makes it tempting to serialise from a parsed model. Serialising from a model silently reformats — YAML key order, list markers, wrapping — and turns every save into a diff. The write path must splice edited regions into the original bytes.

## What the API asked for, and where each fact lives

| API fact | Format home |
|---|---|
| `dateAt` / date spans | `date` + `part` in frontmatter |
| Anchors | `<!--tephra:mark …-->` |
| Tags, overlapping | paired `tag-start` / `tag-end` |
| Headings | ordinary markdown |
| `DocumentMeta.kind` | filename suffix + `kind` |
| Branch origin | *nothing* — the link in the stream carries it (D27) |
| Section entries (D10) | markdown links; type from target; `tephra:` URIs for what resolves by identity (D53) |
| The nav's order (D10) | `sections/_index.fileset.md`, in file order (D53) |
| Fileset summaries (R20) | trailing text after each link |
| Images | relative links to `attachments/` |

## The line-address question, answered

D24 left `(date, line, column)` to be revisited **if the format turned out to want line addresses for merge**. It does not: markers are inline and travel with the text, and no position is ever persisted, so reconciliation operates on text and never on addresses. **The revisit condition is not met; UTF-16 offsets stand.**

## Open

- **Marker verbosity.** `<!--tephra:tag-start house deal-->` is self-describing and long. It is rendered as a widget away from the cursor (D16), so it is rarely seen — but raw mode is a first-class surface, and this is a judgement about how it feels to look at.
- ~~**Where format problems surface.**~~ **Settled.** A count in the titlebar —
  *"4 notes"* — absent entirely when there is nothing to say, opening a panel
  headed *"How these files were read"*. Three choices came out of the one-line
  requirement:

  **It is not a warning.** Every anomaly in the table has already been handled
  safely by the time it is reported: the tag was bounded to its day, the first
  anchor won, the unreadable frontmatter was left untouched. So the surface uses
  the vocabulary of a note — no red, no triangle, no badge demanding to be
  cleared — and says so out loud: *"Nothing here is broken. Each of these is a
  decision the format made on your behalf, recorded so you can change it if you
  would rather."*

  **It is absent when empty.** A notebook that greets its owner with a warning
  strip every morning teaches them to stop reading warnings.

  **It is derived, never stored.** Anomalies are recomputed from the current
  text, so repairing a file by hand makes the entry disappear on the next read
  with nothing to invalidate. `.tephra/issues.json` remains reserved for a
  cached corpus-wide sweep; nothing needs one yet, and computing one would mean
  opening twenty years of files to populate a list nobody asked to see.

  Each entry names the date (clickable, which navigates), the line, and the path
  — because repairing one of these is something you do in another editor, and
  R26's exit depends on that being true.
