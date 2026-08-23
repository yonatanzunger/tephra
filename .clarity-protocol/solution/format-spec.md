# The wire format

> **Locked as the v1 draft, 2026-08-12.** Changes from here need a decision record, not an edit. Build-time obligations live in `implementation-notes.md`.

A storable state adequate to the Document API (D18). Everything here exists because the API exposes a fact that must survive a restart; nothing here exists for its own sake.

**Governing discipline** (Portal D31, carried): *parse leniently, serialize precisely, round-trip untouched content byte-for-byte.* Hand-editing is a feature, so every rule below has a defined degradation.

## Directory layout

```
notebook/
  stream/2026/03/2026-03-14.md          day file
  stream/2026/03/2026-03-14.2.md        part 2, if that day was split
  notes/titration-curves.md             branched documents, pinned lists
  sections/house-deal.fileset.md        nav sections (D10)
  attachments/2026/03/2026-03-14-plot-a1b2c3.png
  .tephra/                              journal, index, caches — MACHINE-LOCAL, NEVER SYNCED
```

Year/month nesting keeps any directory under ~31 entries; twenty years is roughly 5 000 day files. **`.tephra/` is excluded from sync by construction** — it holds the durability journal and any derived index, both machine-local and disposable (D7).

> **This layout describes the *versioned* notebook (D44).** A shreddable notebook holds the same format — same markdown, same frontmatter, same markers, same degradation table — but with the bytes encrypted at rest, opaque object names, and an encrypted index in place of the dated directory tree, because filenames would otherwise disclose which days have writing and when something was deleted. **The format does not fork; only the storage does.** See `shreddable-notebook.md`.

**Type is declared by filename suffix, mirrored in frontmatter** (D3). `.md`, `.todo.md`, `.fileset.md` — everything stays `.md` so external tools see markdown, the name declares the type so nothing is inferred from context, and the mirror in frontmatter survives a rename.

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

**`date` is computed in a fixed UTC−8, never in the device's local zone** (D38). It is the stream's ordering axis and is assigned automatically, so the zone it is computed in is part of the format rather than a runtime setting — local time would file the same passage differently on different devices and after any flight. Times are *displayed* locally; only the filing date is fixed. The day therefore rolls at 00:00 PST, which is 01:00 local during PDT.

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

Three levels up, because a day file sits at `stream/YYYY/MM/`. The short content hash prevents collisions and makes duplicate detection possible later. Ordinary links mean any renderer shows the image and the exit stays real.

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

**Entry type is inferred from the link target**, so there is no type field to keep consistent: a `tephra:mark/…` URI is a bookmark, a relative path is a file, an `http(s)` URL opens in the browser, and a non-markdown file goes to the OS. **The trailing text after the link is the summary** — human-authored, and the place regeneration must never clobber (R20). v1 uses only title and target; the summary has a home from day one because coverage cannot be backfilled.

## `.tephra/` — machine-local state

Never synced, and — with one deliberate exception noted below — entirely disposable. Deleting it must cost nothing but a rebuild.

```
.tephra/
  version                     on-disk state version for this directory
  lock                        single-instance guard
  wal/<doc-id>.jsonl          changes since the last file write — SECONDS, not a history
  index/                      derived search index (v2)
  issues.json                 cached anomaly list from the degradation table
  attachments.manifest        what has been evicted versus what is actually gone
  ui-state.json               open document, window extent, scroll, cursor, vim on/off
```

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
| Section entries (D10) | markdown links; type from target |
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
