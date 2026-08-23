// `Repository`, implemented on git (D32, D34).
//
// Everything git-shaped lives behind this file. Above it there are versions,
// reasons and paths; here there are commits, messages and object ids, and the
// translation happens at the boundary rather than leaking upward.
//
// **The store is the notebook directory itself**, not something beside it. That
// is the whole argument for choosing git: abandoning Tephra leaves plain files
// *and* readable history, usable with every tool on earth (D32). A history only
// this app could read would fail R26 one level below where R26 is usually
// applied — which is also why `git fsck` and `git log` are asserted in the
// tests rather than assumed.

import git from 'isomorphic-git'
import fs from 'node:fs'
import { isMachinery, type RelPath } from './layout.ts'
import type { Repository, VersionTarget } from './repository.ts'
import type { VersionId } from '../../shared/document-api.ts'
import type { Version } from '../../shared/history-api.ts'

const AUTHOR = { name: 'Tephra', email: 'tephra@localhost' } as const
const DEFAULT_BRANCH = 'main'

export class GitRepository implements Repository {
  readonly #dir: string

  private constructor(dir: string) {
    this.#dir = dir
  }

  /**
   * Open the store at `root`, creating it if absent.
   *
   * An existing repository is adopted as-is and never re-initialised — the
   * owner may well have run `git init` here themselves, or be keeping the
   * notebook in a repository that predates Tephra, and clobbering that would
   * destroy exactly the history this feature exists to protect.
   */
  static async open(root: string): Promise<GitRepository> {
    const repo = new GitRepository(root)
    if (!fs.existsSync(`${root}/.git`)) {
      await git.init({ fs, dir: root, defaultBranch: DEFAULT_BRANCH })
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
  async save(reason: string): Promise<VersionId | null> {
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

    const oid = await git.commit({ fs, dir: this.#dir, author: AUTHOR, message: reason })
    return oid as VersionId
  }

  async latest(): Promise<VersionId | null> {
    try {
      return (await git.resolveRef({ fs, dir: this.#dir, ref: 'HEAD' })) as VersionId
    } catch {
      return null // nothing saved yet, which is a state and not a fault
    }
  }

  async versions(from: VersionTarget = 'latest', limit = 50): Promise<readonly Version[]> {
    try {
      return toVersions(await git.log({ fs, dir: this.#dir, ref: refFor(from), depth: limit }))
    } catch {
      // An empty store has no ref to walk. That is what every notebook looks
      // like before its first save.
      return []
    }
  }

  async versionsTouching(
    file: RelPath,
    from: VersionTarget = 'latest',
    limit = 50,
  ): Promise<readonly Version[]> {
    try {
      return toVersions(
        await git.log({
          fs,
          dir: this.#dir,
          ref: refFor(from),
          depth: limit,
          filepath: file,
          force: true,
        }),
      )
    } catch {
      return []
    }
  }

  async contentAt(version: VersionId, file: RelPath): Promise<string | null> {
    try {
      const { blob } = await git.readBlob({ fs, dir: this.#dir, oid: version, filepath: file })
      return new TextDecoder().decode(blob)
    } catch {
      return null
    }
  }

  /**
   * `'latest'` resolves to the branch rather than to HEAD, which is what makes
   * it useful: a machine that has just received a notebook wants the tip of the
   * line, and after a move to some earlier version HEAD is exactly the wrong
   * answer.
   */
  async moveTo(target: VersionTarget): Promise<void> {
    await git.checkout({ fs, dir: this.#dir, ref: refFor(target), force: true })
  }
}

/**
 * `'latest'` means the branch, not HEAD — which is what makes it right after a
 * `moveTo` to some earlier version, when HEAD is exactly the wrong answer.
 */
function refFor(target: VersionTarget): string {
  return target === 'latest' ? DEFAULT_BRANCH : target
}

type LogEntry = Awaited<ReturnType<typeof git.log>>[number]

/** git's vocabulary into the app's, in one place. */
function toVersions(entries: readonly LogEntry[]): readonly Version[] {
  return entries.map(entry => ({
    id: entry.oid as VersionId,
    at: new Date(entry.commit.author.timestamp * 1000),
    reason: entry.commit.message.trim() === '' ? null : entry.commit.message.trim(),
  }))
}
