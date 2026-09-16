# History architecture — option 4 with M1, M2, M3

Resolves Q6. Read with `history-options.md`, which has the comparison this concludes.

## The shape

Four mechanisms, each with exactly one job, and no two of them are histories of the same thing.

| | Lives in | Holds | Lifetime | Job |
|---|---|---|---|---|
| **Undo stack** | Document, **in memory only** | `DocumentChange` records | the session | *undo what I just did* |
| **WAL** | `.tephra/wal/`, main process | changes since the last file write | seconds | the crash gap between memory and disk |
| **Files** | the notebook directory | the corpus | forever | the corpus *is* the files |
| **Repository** | `notebook/.git` | commits | forever | *what did this look like in March* |

**The undo stack stays on Document, exactly where D23 put it** — document-scoped, surviving window moves, with the editor's own history disabled. The only change from what we had is that it is **never written to disk.** That is the whole of option 4's difference, and it is smaller than it looked.

**The repository is local from v1 and gains a remote in v2a** (M1). `git init` in the notebook directory, `.gitignore` containing `.tephra/`.

## Why git specifically, and not a versioned store of our own

A content-addressed snapshot store would be far less code than git for a single-writer repository. Git wins anyway, on a requirement rather than on convenience: **it extends the exit to the history.** Abandoning Tephra then leaves a git repository — plain files *and* readable history, usable with every tool on earth. A bespoke store would leave the files intact and the history hostage, which fails R26 one level down from where R26 is usually applied.

It also makes v2a's sync a solved problem rather than a designed one, and Portal already validated the mobile side of that path.

## M2 — three timescales, and each needs two triggers

| Tier | Trigger | Bound |
|---|---|---|
| WAL append | every change, batched at ~50 ms | lose at most one keystroke |
| File write | quiescence (~1 s) **or every 5 s** | WAL never exceeds ~5 s of typing |
| **Commit** | long quiescence (~5 min) **or every 30 min, or session end** | history stays readable; unprotected window bounded |

**Every tier needs a quiescence trigger *and* a maximum interval**, and this is the correction that came out of working it through. Quiescence alone fails under exactly the condition this notebook is built for: writing continuously for an hour never reaches quiescence, so the file is never written and the WAL grows to hold the whole session. The maximum interval closes it at every level.

**Commits must never block typing.** Git operations run in the main process, asynchronously, off the critical path entirely.

The tiers compose without a gap: changes written to a file but not yet committed are recoverable because they are *in the file*.

## The three interaction points, resolved

**Autosave.** Handled by the tiers above. Autosave frequency and commit frequency are deliberately different numbers — making them the same is what sinks option 3.

**Remote merge (M3, v2a).** Clean local tree, fast-forward: emit the changes with origin `external`, and **map the volatile undo stack through them without admitting them**. Diverged: surface the picker (D12), and **truncate the undo stack afterwards** — mapping an undo through a user's conflict choice is not well-defined, and a wrong answer there is silent corruption of the kind T1 names.

**Hand-editing. No ceremony, which is the point.** The watcher fires, Document quiesces and reloads, the reload is an ordinary change with origin `external`, and the next commit tick records it like any other. A hand-edit made while Tephra was closed is simply uncommitted work in the repository. The only hard case is a hand-edit arriving while the buffer is dirty, which is the divergence path above.

## Layering

**History becomes its own X object**, and Document stops owning durable history entirely:

```ts
export interface History {
  commit(reason?: string): Promise<VersionId>
  versions(range?: { since?: Date; until?: Date }): Promise<readonly Version[]>
  /** The document's text as it was at that version. */
  read(version: VersionId, doc: DocumentId): Promise<string>
  /** Whole documents only — see below. */
  restore(version: VersionId, doc: DocumentId): Promise<void>
  status(): Promise<{ dirty: boolean; lastCommit: VersionId | null }>
}
```

**`restore` takes whole documents, not spans — a correction to an earlier sketch of mine.** Restoring *part* of an old version would need a span addressing text inside a version that was never loaded, so it carries no live `SessionGeneration` and cannot be a `DocumentPosition` at all. Making it work would require aligning two versions of a document, which is a real feature and a hard one. The honest v1 answer is that partial restore is `read` the old text, then paste the part you want — which is what a person does anyway, and needs no alignment machinery.

**A restore truncates the undo stack**, on the same rule as a divergence resolution: it is a large external change, and mapping an undo through it is not well defined. The recovery path if a restore was wrong is another restore, not ⌘Z.

Two objects, two jobs, two coordinates — and they are genuinely different things rather than one thing described twice:

- `Document.undo` / `redo` / `rewindTo(generation)` — **volatile, session-scoped, fine-grained.** D29's generalisation survives intact; it is simply scoped to the session.
- `History.restore(version)` — **durable, permanent, commit-grained.**

W supplies the git mechanics; X supplies the concept.

## What this retires

- **D28's 30-day journal retention.** The journal shrinks to a WAL measured in seconds. The destruction record moves to the repository, where it is durable, versioned and — from v2a — cross-device.
- **The homeless "rewindable history" backlog item.** It now has a mechanism, and it arrives in v1 rather than v3.
- **The ambiguity that caused this whole thread**: nothing is now both a durability mechanism and a history.

## Four costs, stated rather than discovered

**Undo does not survive a restart.** The defence is that this is VSCode + git, used daily without friction, where the post-restart recovery path is the history rather than ⌘Z.

**T10 gets worse, not better, and this deserves saying plainly.** Deleted text used to survive 30 days in a local journal. It now survives **forever, in the repository, and from v2a on the hub as well.** Purging genuinely-unwanted content becomes a history rewrite — expensive, and after v2a it means a force-push. This is inherent to having history at all rather than a flaw in this design, but the earlier framing of T10 as "a purge action clears the journal" is now wrong. **The mitigation is a documented purge procedure, not a button**, and it should be honest about what it costs.

**Binary growth.** Twenty years of pasted images in git history, never garbage-collected. Probably fine at personal-notebook scale; worth measuring before it is twenty years old, and LFS exists if it is not.

**A git implementation must be chosen** — see `git-library.md`. System `git` is ruled out; the choice is among bundled libraries.

## The v1 → v2a delta, which is now small

v1 ships the repository, commits, and restore. v2a adds a remote, push and pull, and the divergence picker. **Versioning is not new work at v2a** — only distribution is, which is precisely what M1 was for.
