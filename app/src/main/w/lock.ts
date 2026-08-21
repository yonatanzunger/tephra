// Single-instance guard. Not optional (format-spec): two Tephra processes over
// one directory would fight over the WAL and the fold, and the failure mode is
// corruption rather than an error.
//
// The hard part is not taking the lock, it is releasing one that was never
// released. A crash leaves a lock file behind, and a guard that then refuses to
// start forever is worse than no guard — the user's response would be to delete
// the file, which teaches them to delete it whenever it is inconvenient.

import { readFile, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { isNotFound } from './atomic.ts'

export interface LockHolder {
  readonly pid: number
  readonly host: string
  /** ISO 8601. Diagnostic — pid liveness is what actually decides staleness. */
  readonly since: string
}

export class LockHeldError extends Error {
  readonly holder: LockHolder
  constructor(holder: LockHolder) {
    super(
      `notebook is already open by pid ${holder.pid} on ${holder.host} since ${holder.since}`,
    )
    this.name = 'LockHeldError'
    this.holder = holder
  }
}

export class NotebookLock {
  readonly #path: string
  #held = false

  constructor(path: string) {
    this.#path = path
  }

  get held(): boolean {
    return this.#held
  }

  /** Throws LockHeldError if another live process holds it. */
  async acquire(): Promise<void> {
    const mine: LockHolder = { pid: process.pid, host: hostname(), since: new Date().toISOString() }

    try {
      await writeFile(this.#path, JSON.stringify(mine, null, 2) + '\n', { flag: 'wx' })
      this.#held = true
      return
    } catch (err) {
      if (!isExists(err)) throw err
    }

    const holder = await this.#read()

    // Unreadable or corrupt: treat as stale rather than as an impassable wall.
    // A lock file we cannot parse carries no information, and refusing to open
    // the notebook because of it would be refusing on no evidence.
    if (holder === null || !alive(holder)) {
      await unlink(this.#path).catch(() => {})
      await writeFile(this.#path, JSON.stringify(mine, null, 2) + '\n', { flag: 'w' })
      this.#held = true
      return
    }

    throw new LockHeldError(holder)
  }

  async release(): Promise<void> {
    if (!this.#held) return
    // Only remove a lock that is still ours: if it was stolen as stale while we
    // were alive, removing it would strip the new holder of its guard.
    const holder = await this.#read()
    if (holder?.pid === process.pid && holder.host === hostname()) {
      await unlink(this.#path).catch(() => {})
    }
    this.#held = false
  }

  async #read(): Promise<LockHolder | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, 'utf8'))
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as LockHolder).pid !== 'number' ||
        typeof (parsed as LockHolder).host !== 'string'
      ) {
        return null
      }
      return parsed as LockHolder
    } catch (err) {
      if (isNotFound(err)) return null
      return null // unparseable is the same as absent, deliberately
    }
  }
}

/**
 * A lock from another machine cannot be tested for liveness, so it is honoured.
 * `.tephra/` is never synced, so this should be unreachable — and if it happens,
 * the honest response is to refuse rather than to guess about a process we
 * cannot see.
 *
 * Pid reuse after a reboot could in principle make a stale lock look alive. The
 * host check catches the cross-machine case; the residual risk is a reboot plus
 * a collision on the same pid, which costs one manual deletion.
 */
function alive(holder: LockHolder): boolean {
  if (holder.host !== hostname()) return true
  try {
    process.kill(holder.pid, 0)
    return true
  } catch (err) {
    // EPERM means it exists and is not ours — alive. ESRCH means it is gone.
    return (err as { code?: string }).code === 'EPERM'
  }
}

function isExists(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'EEXIST'
}
