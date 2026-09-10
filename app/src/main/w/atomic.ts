// Atomic file replacement. Autosave makes an interrupted write the ordinary
// risk rather than the exotic one (T2), so every write goes through here.
//
// Write to a temporary file in the SAME directory, fsync it, then rename over
// the target. Rename is atomic within a filesystem and not across one, which is
// why the temp file cannot live in /tmp.

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface WriteResult {
  /** SHA-256 of exactly the bytes written. The watcher uses it to recognise
   *  its own writes; see watcher.ts for why identity beats a time window. */
  readonly hash: string
  readonly bytes: number
}

/** Hash content the same way a write does, so the two are comparable. */
export function hashContent(content: string | Uint8Array): string {
  return typeof content === 'string'
    ? createHash('sha256').update(content, 'utf8').digest('hex')
    : createHash('sha256').update(content).digest('hex')
}

/**
 * Replace `path` with `content`, atomically.
 *
 * A reader either sees the whole previous file or the whole new one; there is
 * no moment at which it sees half. That is the property autosave depends on.
 */
export async function writeAtomic(
  path: string,
  content: string | Uint8Array,
): Promise<WriteResult> {
  await mkdir(dirname(path), { recursive: true })

  // Same directory, so the rename stays within one filesystem. The leading dot
  // and the random suffix mean a crashed write leaves something obviously
  // temporary rather than something that looks like a note.
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${randomSuffix()}`)

  const mode = await existingMode(path)
  // **Bytes as well as text** (R7): an attachment is a PNG, and a PNG put
  // through a UTF-8 encoder is a corrupt PNG. Everything else about the write —
  // the temp name, the mode, the fsync, the rename — is the same act.
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)

  let handle
  try {
    handle = await open(tmp, 'wx', mode ?? 0o644)
    await handle.writeFile(buffer)
    // fsync before the rename: without it the rename can land while the data is
    // still in the page cache, and a crash leaves an atomically-renamed empty
    // file — which is worse than a partial write, because it looks complete.
    await handle.sync()
  } finally {
    await handle?.close()
  }

  try {
    if (mode !== null) await chmod(tmp, mode) // a user's chmod survives our rewrite
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }

  // NOT fsyncing the containing directory. That is what would make the rename
  // itself survive power loss, and it costs a syscall on every autosave. The
  // threat model here is a renderer crash (document-api.md), against which the
  // file fsync above is sufficient — the process dies, the kernel does not.
  return { hash: hashContent(content), bytes: buffer.byteLength }
}

/** Read as UTF-8, or null if the file is not there. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Remove, tolerating absence. */
export async function remove(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
}

export function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

async function existingMode(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mode & 0o777
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

function randomSuffix(): string {
  return createHash('sha256')
    .update(`${process.pid}:${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 8)
}
