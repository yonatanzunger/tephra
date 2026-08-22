// The notebook's git repository (D32, D34).
//
// W-layer: this knows about files and object ids and nothing about days,
// segments or spans. What a commit *means* is X's business; this is the
// mechanism.
//
// **The repository is the notebook directory itself**, not a store beside it.
// That is the whole point: abandoning Tephra leaves a git repository — plain
// files *and* readable history, usable with every tool on earth (D32). A
// history only this app can read would fail R26 one level below where R26 is
// usually applied.
//
// ONE PERFORMANCE RULE, straight from D34: whole-tree status is O(files) and is
// never used on the hot path. The app knows which files it wrote and the
// watcher reports the ones it did not, so an ordinary commit stages a handful
// of known paths. A full scan happens exactly once, at startup, to catch what
// changed while the app was closed — where seconds are acceptable.

import git from 'isomorphic-git'
import fs from 'node:fs'
import { isMachinery, type RelPath } from './layout.ts'

const AUTHOR = { name: 'Tephra', email: 'tephra@localhost' } as const

export interface CommitInfo {
  readonly oid: string
  readonly message: string
  /** Epoch seconds, as git records it. */
  readonly at: number
}

export class Repository {
  readonly #dir: string

  private constructor(dir: string) {
    this.#dir = dir
  }

  /**
   * Open the repository at `root`, creating it if absent.
   *
   * An existing repository is adopted as-is and never re-initialised — the
   * owner may well have run `git init` here themselves, or be keeping the
   * notebook in a repository that predates Tephra, and clobbering that would
   * destroy exactly the history this feature exists to protect.
   */
  static async open(root: string): Promise<Repository> {
    const repo = new Repository(root)
    if (!fs.existsSync(`${root}/.git`)) {
      await git.init({ fs, dir: root, defaultBranch: 'main' })
    }
    return repo
  }

  get dir(): string {
    return this.#dir
  }

  /**
   * Stage the named paths and commit. Returns the new oid, or **null when there
   * was nothing to commit** — which is the common case on a quiet timer and
   * must not be an error.
   *
   * Paths that no longer exist are removed from the index rather than added, so
   * a deleted day is recorded as a deletion instead of failing the commit.
   */
  async commit(paths: readonly RelPath[], message: string): Promise<string | null> {
    const staged = await this.#stage(paths)
    if (staged === 0) return null
    return git.commit({ fs, dir: this.#dir, author: AUTHOR, message })
  }

  /**
   * The startup reconciliation: everything that changed while the app was not
   * running, in one pass. This is the O(files) scan D34 allows exactly here.
   */
  async commitOutstanding(message: string): Promise<string | null> {
    const matrix = await git.statusMatrix({ fs, dir: this.#dir })
    let any = false
    for (const [filepath, head, workdir, stage] of matrix) {
      if (head === workdir && workdir === stage) continue // unchanged
      if (isMachinery(filepath as RelPath)) continue
      any = true
      if (workdir === 0) await git.remove({ fs, dir: this.#dir, filepath })
      else await git.add({ fs, dir: this.#dir, filepath })
    }
    if (!any) return null
    return git.commit({ fs, dir: this.#dir, author: AUTHOR, message })
  }

  async log(limit = 50): Promise<readonly CommitInfo[]> {
    try {
      const entries = await git.log({ fs, dir: this.#dir, depth: limit })
      return entries.map(e => ({
        oid: e.oid,
        message: e.commit.message.trim(),
        at: e.commit.author.timestamp,
      }))
    } catch {
      // An empty repository has no HEAD to walk, which is a state and not a
      // fault: it is what every notebook looks like before its first commit.
      return []
    }
  }

  /** A file's contents at a commit, or null if it did not exist there. */
  async readAt(oid: string, filepath: RelPath): Promise<string | null> {
    try {
      const { blob } = await git.readBlob({ fs, dir: this.#dir, oid, filepath })
      return new TextDecoder().decode(blob)
    } catch {
      return null
    }
  }

  // ── internals ────────────────────────────────────────────────

  /**
   * Stage the paths that actually differ, and report how many there were.
   *
   * The count is what stops a quiet notebook accruing an empty commit every
   * half hour forever until the log is useless for its one job. Asking each
   * path's status BEFORE staging is what makes that answerable: once a file is
   * added it reads as "added" whether or not its contents changed, so the
   * question has to be asked while the answer is still available.
   *
   * Per-path status, never `statusMatrix`, on this path — that is the O(files)
   * scan D34 confines to startup.
   */
  async #stage(paths: readonly RelPath[]): Promise<number> {
    let changed = 0
    for (const rel of new Set(paths)) {
      // `.tephra/` is machine-local and disposable (D7), and `.git/` is the
      // repository's own machinery. Both are excluded elsewhere as well —
      // .gitignore for one, the watcher for the other — and belt-and-braces is
      // cheap when the failures are "committed the WAL" and "committed the
      // repository into itself".
      if (isMachinery(rel)) continue
      try {
        const state = await git.status({ fs, dir: this.#dir, filepath: rel })
        if (state === 'unmodified' || state === 'ignored' || state === 'absent') continue
        if (fs.existsSync(`${this.#dir}/${rel}`)) {
          await git.add({ fs, dir: this.#dir, filepath: rel })
        } else {
          await git.remove({ fs, dir: this.#dir, filepath: rel })
        }
        changed++
      } catch {
        // A path that cannot be staged must not take the commit down with it —
        // the other files in this batch are still worth saving.
      }
    }
    return changed
  }
}
