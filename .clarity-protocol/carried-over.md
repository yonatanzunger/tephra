# What carries over from Portal

Portal (`../portal`) has complete goal, solution and architecture documents plus **53 recorded decisions**, reached over several sessions. It is paused, not abandoned. This is the inventory of what survives the pivot, so that work is reused rather than rediscovered — and so that nothing is reused *without checking whether its premise still holds*, which is the failure mode Portal's own notes flag as most common.

**How to use this:** don't read Portal's documents wholesale. Come here when a question arises that sounds like one Portal already answered, then read that specific decision.

## Carries almost entirely

| What | Where | Note |
|---|---|---|
| **The notebook design** | `portal/.clarity-protocol/solution/integration-notebook.md` | Day files, transparent bundle, append-union merge, inline bookmarks, side lists, YAML frontmatter for per-day metadata. Written to implementation depth. **Its §7 (moving ranges between notebooks) is obsolete** — subjects-as-tags deletes that requirement. |
| **The FileSet design** | `solution/integration-fileset.md`, D47 | Matches R20–R23 almost exactly: references not containment, one human-editable `note` never clobbered by regeneration, snapshots as ordinary content, grouping as batched open. The reasoning about *why* snapshots aren't FileSet-private state is worth re-reading. |
| **Format discipline** | D31 | Parse leniently, serialize precisely, round-trip untouched lines byte-for-byte. Non-negotiable for anything hand-editable, which here is everything. |
| **The merge ladder and the universal picker** | D11, D52 | Only if reconciliation is needed at all (Q2). D52's insight is general: *viewing and choosing are independent, and only viewing can fail* — so a picker over opaque versions works everywhere and needs no default. |
| **Append-union ordering** | D51 | Only if storage is git-shaped. The reasoning is reusable regardless: an arbitrary-but-visible rule should be *illegible* so no false theory forms around it. |
| **Design lessons** | `portal/.clarity-protocol/notes.md` | ~45 entries, most not project-specific. The condensed set is in this project's `notes.md`. |

## Carries only if storage is git-shaped (Q2)

> **The condition resolved for the local half (D32, 2026-09):** v1's versioning
> *is* git, through `Repository` with a `GitRepository` implementation, so the
> read/write/list semantics and autosave-on-quiescence below are in use. What is
> still conditional is the **sync** half — the five sync states, the merge ladder,
> and whether the hub is git-shaped at all — which is what Q2 still asks.

The git filesystem (`solution/software-architecture.md` §2): read/write/list semantics, autosave on quiescence, the five sync states, rewind as a non-destructive new commit, D53's machine-local stores. **And T5's validated spike work** — authenticated clone/commit/push from Swift on macOS and Kotlin on Android through UniFFI, with cross-compilation proven. That was expensive and it is done. Its one unresolved hole is **TLS trust on Android** (a vendored OpenSSL has no trust anchors; Android's store uses legacy MD5 hashed filenames, so no `SSL_CERT_DIR` approach can ever work).

## Does not carry

Spaces and `SpaceController`; launch manifests and the `open`/`close`/`reopen` verbs; the project registry, lifecycle and dashboard; the summoned panel and global hotkey; most of the integration architecture (D3, D26, D39, D48) — this is one app over one folder, not a shell hosting six typed plugins. **Domain operations** (D13) were already suspected unnecessary before the pivot and are now clearly so.

## Carries in a changed role

**The widget contract** (D49, `solution/widget-contract.md`) was written for Portal's panel hosting integration widgets. If this app has a plugin surface at all it is much smaller — but three findings there are about *any* app that edits files a background process also touches, and they will recur:

- **Model construction must be separate from view construction.** A widget that opens its file in `makeBody` re-reads constantly and loses edit state on reparenting — which is R1.2 ("no state is ever at risk") failing at the framework level.
- **Watch directories, never file descriptors.** An fd-based watcher dies *silently* when a file is atomically replaced by `rename(2)`, which is how git and most well-behaved writers update files. It stops firing without erroring.
- **Quiesce before any external mutation of the tree** — flush and release, mutate, reload. Skipping the first phase silently clobbers unsaved edits.

**D50 (widget nesting deferred)** matters mainly for its method: the deferral was safe because the enabling structure already existed, and the instruction that made it real was *don't build for it in the meantime*.
