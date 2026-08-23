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
   * `git add -A && git commit`. Nothing cleverer.
   *
   * **`add({filepath: '.'})` hashes as it walks**, so the index's stat cache
   * never enters into it and this library's racy-timestamp window — a
   * same-length edit inside the same filesystem second — simply does not apply.
   * An earlier version compared content hashes by hand and took a list of paths
   * to look at, which was an elaborate way of doing what `add` already does.
   *
   * Deletions need the second step. Like `git add .`, `add` stages additions
   * and modifications but leaves a removed file in the index; `git add -A` is
   * add plus that, and so is this.
   *
   * MEASURED on a synthetic twenty-year corpus, 7 300 files and 715 MB:
   * `add` 2.4 s cold and 1.4 s warm, the `statusMatrix` after it 0.19 s. At a
   * five-minute cadence that is affordable, and today's corpus makes it
   * milliseconds. Re-measure before anything makes it run more often.
   */
  async commitAll(message: string): Promise<string | null> {
    await git.add({ fs, dir: this.#dir, filepath: '.' })

    const matrix = await git.statusMatrix({ fs, dir: this.#dir })
    let changed = false
    for (const [filepath, head, workdir, stage] of matrix) {
      if (isMachinery(filepath as RelPath)) continue
      if (workdir === 0 && stage !== 0) {
        await git.remove({ fs, dir: this.#dir, filepath })
        changed = true
      } else if (head !== stage) {
        changed = true
      }
    }
    if (!changed) return null
    return git.commit({ fs, dir: this.#dir, author: AUTHOR, message })
  }

  async logFor(filepath: RelPath, limit = 50): Promise<readonly CommitInfo[]> {
    try {
      const entries = await git.log({ fs, dir: this.#dir, depth: limit, filepath, force: true })
      return entries.map(e => ({
        oid: e.oid,
        message: e.commit.message.trim(),
        at: e.commit.author.timestamp,
      }))
    } catch {
      return []
    }
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

}
