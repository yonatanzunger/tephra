# Features and version assignment

Everything discussed so far, in one list, with a proposed stage. Stages are **v1** (single-device Mac, the stream, excellent editing), **v2a** (sync alone), **v2b** (Android), **v3+** (deliberate decisions later, see `feature-backlog.md`).

**"Format only" is a real stage.** Several items must have their *syntax* fixed in v1 even though the feature arrives later, because the corpus accumulates in the meantime and data cannot be backfilled (`goal/scope.md`). Fixing a syntax is nearly free; retrofitting one is not.

**◆ marks a genuinely arguable assignment** — the ones worth settling deliberately rather than accepting.

**Audited 2026-09-10, when v1 completed.** The `Stage` column says where a thing
was *assigned*; **✓ means it is built and running.** A row assigned v1 without a
✓ is a discrepancy and should be read as one — there are three, and each says
why. Several assignments moved on evidence rather than on plan, and those say so
in place rather than being quietly corrected.

## Format

| Feature | Ref | Stage |
|---|---|---|
| Directory of plain files; type declared by name | D3, D6 | ✓ v1 — and a *directory* named by its kind for multi-file documents (D59) |
| Single logical document; day-file split rule | D8 | ✓ v1 |
| Automatic dating | R8 | ✓ v1 — and the filing day waits for you to stop typing (D62) |
| Per-file metadata in frontmatter | — | ✓ v1 |
| Subject-tag syntax (inline markup, no offsets) | R12, D11 | ✓ v1 |
| *(no origin fields — the link left in the stream carries it)* | D27 | — |
| Bookmark anchor syntax (inline) | R9 | ✓ v1 |
| Section/fileset index format | R20 | ✓ v1 (nav needs it) |
| Image paste writes a file and inserts a link | R7 | ✓ v1 |
| Equation syntax (TeX) | R7 | ✓ v1 |
| Table syntax | R7 | ✓ v1 |
| Attachment naming: day, name and content hash | R7 | ✓ v1 — the hash deduplicates and guards collisions at once |
| Task-item line: text, status, tags, due, notes, identity | D55, D56 | ✓ v1 — **moved from v3+**, see Lists |

## Editing surface

| Feature | Ref | Stage |
|---|---|---|
| Windowed editor over the document, per-region write-back | D8, D23 | ✓ v1 — **required**, not deferred: a month of writing is 2.4× the largest corpus the editor has been tested against |
| ~~Vim mode, as a switchable setting~~ | ~~R1.4, D15~~ | **removed, D67** — shipped in M0, never once wanted in months of use, deleted rather than left as a switch nobody switched |
| **The** keymap — one, and its inventory | D67 | ✓ v1 for the inventory (`keymap.md`); **its design is in the backlog** |
| Raw markdown editing | R1.4 | ✓ v1 |
| Rendered reading view | R1.4 | ✓ v1 |
| Rendered editing — inline constructs | R1.4 | backlog (◆ settled 2026-09-09: the plain version went months without complaint) |
| Rendered editing — tables | R1.4 | v3+ |
| Rendered editing — equations | R1.4 | v3+ |
| Inline image rendering | R7 | ✓ v1 — **and it had never once worked before R7**: the widget drew an `<img>` with no route to the corpus to point it at |
| Typography and visual system, tunable | R1.3 | ✓ v1 for tunable; **what "excellent" wants next is in the backlog** |
| State preservation: scroll, cursor, in-flight text | R1.2 | ✓ v1 |
| Autosave | R1.2 | ✓ v1 |

## Navigation

| Feature | Ref | Stage |
|---|---|---|
| Left nav panel of sections, each an expando | D10 | ✓ v1 |
| Default section = pins | D10 | ✓ v1 — **dissolved into the top-level list** (D53), rather than a distinguished section |
| Jump to target: bookmark, file, URL, external doc via OS | D10 | ✓ v1 |
| Open in current window or new window | D10 | ✓ v1 — and a window's arrangement is restored, not just the last one (MC6) |
| Jump to a date | R9 | ✓ v1 |
| Step through every occurrence of a row's subject | D51 | ✓ v1 — with the places marked down the scroll track |
| A window may show a **query** rather than a document | ML3, D66 | ✓ v1 — the link directory is a location; search is a panel, and the difference is whether following a row means you are done with the list |

## Retrieval

| Feature | Ref | Stage |
|---|---|---|
| Literal substring search over the corpus | R10 | ✓ v1 (◆ settled) — a phrase, taken literally, by scan |
| Filtered view by tag | R13 | ✓ v1 — `#wombats` is a **scope**, and means *inside* the tagged text |
| Filtered view by date range | R13 | ✓ v1 (same mechanism) |
| Combined tag-and-date query | D9 | ✓ **v1, moved from v2** — it fell out of the notation for free: `foo #wombats 2026-03` |
| Two renderings of one query | D66 | ✓ v1 — ⌘F walks one document, ⌘⇧F lists every place in a panel |
| A directory of every link in the corpus | R10a | ✓ v1 (ML) |
| Editable filtered views | R13 | **descoped, not deferred** (D9 as amended) — the composite document is the only thing that question was about, and the pane and the walk answered what it was invented for |
| Regex search | R10 | v2+ — one more leaf that never gains an index bound, which the design says out loud (D65) |
| Real search: ranking, stemming, structure | R10 | v3+ — **ranking arrives with the index**, since a scan cannot rank-stream |
| Text index | D7, D23 | **v2** — scanning is instant at 10 MB and is not at 50 MB, which is year two. D65's split is what makes it an addition rather than a rewrite |
| Corpus index (a cache of a scan) | D52 | ✓ v1 — **not the text index above.** It answers what the sidebar asks about the whole corpus and is thrown away freely |

## Range operations

| Feature | Ref | Stage |
|---|---|---|
| Select a range — the core interaction primitive | R11–R14 | ✓ v1 |
| Tag a range with a subject | R12 | ✓ v1 (◆ settled) |
| Bookmark a point | R9 | ✓ v1 |
| Print a range | R11 | ✓ v1 (Q4 evidence) |
| Branch a range into its own file, linked from its origin | R14 | ✓ v1 (D13) |
| Find a branched file independently of its origin | R14 | ✓ **v1, arrived with search** — it needed tags and search, and both are here |
| Comment on a range, shown in the reserved margin | R27 | ✓ v1 |
| The margin reserved in every theme, comments or not | R27 | ✓ MV |
| Import clipboard text to annotate | R28 | ✓ v1 — the original is kept untouched and a copy is annotated (D47) |
| Import `.docx` to annotate | R28 | ◆ **v1 as assigned, NOT built.** A discrepancy: nothing converts docx. The clipboard path covers pasting *from* Word, which may be why it never came up |
| Import `.pdf` to annotate | R28 | v2 — extraction is its own problem |

## Storage and sync

| Feature | Ref | Stage |
|---|---|---|
| Real, visible local directories | D5 | ✓ v1 |
| Atomic writes (write-temp-then-rename) | — | ✓ v1 — and bytes as well as text, since R7 |
| WAL: changes since last file write | D32 | ✓ v1 |
| Three write tiers, each with quiescence **and** max-interval triggers | D32 | ✓ v1 |
| One writer per notebook, asked rather than inferred | D64 | ✓ v1 — a held lock is a question, and losing one stops the loser dead |
| Network hub as source of truth | D5 | v2a |
| Continuous asynchronous background push | D5 | v2a |
| Offline accumulation, push on reconnect | R25 | v2a |
| Divergence surfaced to the user with a picker | D12 | v2a |
| Attachment cache with eviction | D5 | v2b (the phone forces it) |
| Local git repository — commits, restore | D32 | ✓ **v1.** Versioning is local from day one, so v2a adds distribution rather than history |
| Rewindable history | D32 | ✓ **v1** — falls out of the repository, rather than being a v3 feature with no mechanism |

## Mobile

| Feature | Ref | Stage |
|---|---|---|
| Android: read, navigate, search | R24 | v2b |
| Android: write and edit well | R24 | v2b |
| Android: fast capture (append without ceremony) | R24 | v2b |

## Lists

**This whole section was assigned v3+ and was built in v1.** R15–R17 and R16a
were superseded by `goal/todo.md` (T1–T16) after a closer reading of the
twenty-year record, and the list turned out to be the thing most wanted from
daily use — so it was built across MT1–MT7 and has been in use for months. The
old assignment is left visible rather than silently corrected, because *why* it
moved is the useful part: a feature can be reassigned by use faster than by
argument.

| Feature | Ref | Stage |
|---|---|---|
| TODO as a *kind*, seen only through its own UX | T1, D55 | ✓ **v1, moved from v3+** |
| One line carries everything an item is | D56 | ✓ v1 — text, status, tags, due date, notes, identity, ctime and mtime |
| Order by urgency, not merely storing due dates | T9 (was R16) | ✓ v1 |
| Last-touched timestamps | T2, D56 | ✓ v1 — in the item's own marker |
| The daily walk as a *priming* ritual | T11 (was R16a's forced review) | ✓ v1 (MT5a) — Done/Drop staged, applied or reverted |
| Groupings: by time, or by tag | T5, T8 (was R17) | ✓ v1 (MT4a), and the choice is sticky |
| Notes on an item | — | ✓ v1 — indented continuation lines, costing no vertical space when absent |
| The backlog drawer, and scrubbing to a past day | T14, T7 | ✓ v1 (MT6) |
| More than one list; a distinguished one | T15, D55 as amended | ✓ v1 (MT7) — `foo.todo.md` overall lists beside the daily `tasks.todo` |
| The resolved tail under a tag | T8 | ✓ built, **suppressed from use 2026-09-10** — read as more list rather than as context; one flag, and everything behind it stands |
| The soft cap on the working view | T12 | backlog — the requirement with the least evidence behind it, still waiting for some |
| Backlog resurfacing | Q3a | **deferred, and says so** — the design has no answer yet |
| Pinned lists | R18 | ✓ v1 (a markdown file in a section) |
| Events calendar | R19 | ✓ v1 (a pinned markdown file — no feature, per the requirement) |

## Filesets as document collections

The index format and the nav role arrive in v1; the *collection experience* is separate and later.

| Feature | Ref | Stage |
|---|---|---|
| Autogenerated, human-editable, never-clobbered summaries | R20 | v3+ |
| Open en masse | R21 | v3+ |
| URL snapshot into the bundle | R22 | v3+ |
| Browser extension | R23 | v3+ |
| Drag and drop into a fileset | — | v3+ |

## OS integration

| Feature | Ref | Stage |
|---|---|---|
| Printing | R11 | ✓ v1 (Q4 evidence) — a selection, a document, or a range of days |
| Image paste | R7 | ✓ v1 (Q4 evidence) — and drop, and a file picker |
| Open-with / OS intent for external documents | R21 | ✓ v1 |
| Opening a file outside the notebook, read-only | R28, MC6 | ✓ v1 — with import as the gesture that brings it in |
| docx and other export | — | v3+ |
