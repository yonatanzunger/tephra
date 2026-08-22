# Features and version assignment

Everything discussed so far, in one list, with a proposed stage. Stages are **v1** (single-device Mac, the stream, excellent editing), **v2a** (sync alone), **v2b** (Android), **v3+** (deliberate decisions later, see `feature-backlog.md`).

**"Format only" is a real stage.** Several items must have their *syntax* fixed in v1 even though the feature arrives later, because the corpus accumulates in the meantime and data cannot be backfilled (`goal/scope.md`). Fixing a syntax is nearly free; retrofitting one is not.

**◆ marks a genuinely arguable assignment** — the ones worth settling deliberately rather than accepting.

## Format

| Feature | Ref | Stage |
|---|---|---|
| Directory of plain files; type declared by name | D3, D6 | v1 |
| Single logical document; day-file split rule | D8 | v1 |
| Automatic dating | R8 | v1 |
| Per-file metadata in frontmatter | — | v1 |
| Subject-tag syntax (inline markup, no offsets) | R12, D11 | v1 — format only if tagging slips |
| *(no origin fields — the link left in the stream carries it)* | D27 | — |
| Bookmark anchor syntax (inline) | R9 | v1 — format only if bookmarking slips |
| Section/fileset index format | R20 | v1 (nav needs it) |
| Image paste writes a file and inserts a link | R7 | v1 |
| Equation syntax (TeX) | R7 | v1 |
| Table syntax | R7 | v1 |
| TODO fields incl. last-touched | R15 | v3+ (arrives with the type — D6) |

## Editing surface

| Feature | Ref | Stage |
|---|---|---|
| Windowed editor over the document, per-region write-back | D8, D23 | v1 — **required**, not deferred: a month of writing is 2.4× the largest corpus the editor has been tested against |
| Vim mode, as a switchable setting | R1.4, D15 | v1 |
| Non-vim keymap, deliberately designed rather than inherited | D15 | v1 — it is what mobile always runs |
| Raw markdown editing | R1.4 | v1 |
| Rendered reading view | R1.4 | v1 |
| Rendered editing — inline constructs | R1.4 | ◆ v1 or v2 |
| Rendered editing — tables | R1.4 | v3+ |
| Rendered editing — equations | R1.4 | v3+ |
| Inline image rendering | R7 | v1 |
| Typography and visual system, tunable | R1.3 | v1 |
| State preservation: scroll, cursor, in-flight text | R1.2 | v1 |
| Autosave | R1.2 | v1 |

## Navigation

| Feature | Ref | Stage |
|---|---|---|
| Left nav panel of sections, each an expando | D10 | v1 |
| Default section = pins, always exists, at the top | D10 | v1 |
| Jump to target: bookmark, file, URL, external doc via OS | D10 | v1 |
| Open in current window or new window | D10 | v1 |
| Jump to a date | R9 | v1 |

## Retrieval

| Feature | Ref | Stage |
|---|---|---|
| Literal substring search over the corpus | R10 | ◆ v1 |
| Filtered view by tag | R13 | ◆ v1 |
| Filtered view by date range | R13 | v1 (same mechanism) |
| Combined tag-and-date query | D9 | v2 |
| Editable filtered views | R13 | v3+ |
| Real search: ranking, stemming, structure | R10 | v3+ |
| Derived index | D7, D23 | **v2** — scanning is instant at 10 MB and is not at 50 MB, which is year two |

## Range operations

| Feature | Ref | Stage |
|---|---|---|
| Select a range — the core interaction primitive | R11–R14 | v1 |
| Tag a range with a subject | R12 | ◆ v1 |
| Bookmark a point | R9 | v1 |
| Print a range | R11 | v1 (Q4 evidence) |
| Branch a range into its own file, linked from its origin | R14 | v1 (D13) |
| Find a branched file independently of its origin | R14 | v2 (needs tags and search) |
| Comment on a range, shown in the reserved margin | R27 | v1 |
| The margin reserved in every theme, comments or not | R27 | MV — cannot wait |
| Import clipboard text to annotate | R28 | v1 |
| Import `.docx` to annotate | R28 | ◆ v1 |
| Import `.pdf` to annotate | R28 | v2 — extraction is its own problem |

## Storage and sync

| Feature | Ref | Stage |
|---|---|---|
| Real, visible local directories | D5 | v1 |
| Atomic writes (write-temp-then-rename) | — | v1 |
| WAL: changes since last file write | D32 | v1 |
| Three write tiers, each with quiescence **and** max-interval triggers | D32 | v1 |
| Network hub as source of truth | D5 | v2a |
| Continuous asynchronous background push | D5 | v2a |
| Offline accumulation, push on reconnect | R25 | v2a |
| Divergence surfaced to the user with a picker | D12 | v2a |
| Attachment cache with eviction | D5 | v2b (the phone forces it) |
| Local git repository — commits, restore | D32 | **v1.** M1: versioning is local from day one, so v2a adds distribution rather than history |
| Rewindable history | D32 | **v1** — falls out of the repository, rather than being a v3 feature with no mechanism |

## Mobile

| Feature | Ref | Stage |
|---|---|---|
| Android: read, navigate, search | R24 | v2b |
| Android: write and edit well | R24 | v2b |
| Android: fast capture (append without ceremony) | R24 | v2b |

## Lists

| Feature | Ref | Stage |
|---|---|---|
| TODO type and UX | R15 | v3+ |
| Urgency ranking | R16 | v3+ (with the type) |
| Last-touched timestamps | R15 | v3+ (with the type; migration is the first review — D6) |
| Forced review mechanism | R16a | v3+ |
| TODO groupings | R17 | v3+ |
| Pinned lists | R18 | v1 (a markdown file in the default section) |
| Events calendar | R19 | v1 (a pinned markdown file — no feature) |

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
| Printing | R11 | v1 (Q4 evidence) |
| Image paste | R7 | v1 (Q4 evidence) |
| Open-with / OS intent for external documents | R21 | v1 |
| docx and other export | — | v3+ |
