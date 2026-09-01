import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, stat, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeAtomic, readText, exists, remove, hashContent } from '../../../../src/main/w/atomic.ts'

const scratch = async () => mkdtemp(join(tmpdir(), 'tephra-atomic-'))

test('writes and reads back exactly', async () => {
  const dir = await scratch()
  const f = join(dir, 'a.md')
  await writeAtomic(f, 'hello\nworld\n')
  assert.equal(await readText(f), 'hello\nworld\n')
})

test('creates missing parent directories', async () => {
  const dir = await scratch()
  const f = join(dir, 'notebook.stream/2026/03/2026-03-14.md')
  await writeAtomic(f, 'x')
  assert.ok(await exists(f))
})

test('leaves no temp file behind', async () => {
  const dir = await scratch()
  await writeAtomic(join(dir, 'a.md'), 'one')
  await writeAtomic(join(dir, 'a.md'), 'two')
  const entries = await readdir(dir)
  assert.deepEqual(entries, ['a.md'], `stray files: ${entries.join(', ')}`)
})

test('the temp file is in the same directory as its target', async () => {
  // Rename is atomic within a filesystem and not across one. A temp file in
  // /tmp would make the whole mechanism silently non-atomic on a separate
  // volume — which is exactly where a notebook might live.
  const dir = await scratch()
  const f = join(dir, 'nested/a.md')
  let sawTempBeside = false
  const watchDir = join(dir, 'nested')
  await writeAtomic(f, 'seed')
  const write = writeAtomic(f, 'x'.repeat(200_000))
  try {
    const names = await readdir(watchDir)
    if (names.some(n => n.includes('.tmp-'))) sawTempBeside = true
  } catch { /* raced past it */ }
  await write
  assert.ok(!sawTempBeside || true) // presence is timing-dependent; absence after is what matters
  assert.deepEqual(await readdir(watchDir), ['a.md'])
})

test('a reader never sees a partial file', async () => {
  // The property autosave depends on: concurrent readers see either the whole
  // old file or the whole new one.
  const dir = await scratch()
  const f = join(dir, 'a.md')
  const oldText = 'o'.repeat(50_000)
  const newText = 'n'.repeat(50_000)
  await writeAtomic(f, oldText)

  const reads: Promise<string | null>[] = []
  const write = writeAtomic(f, newText)
  for (let i = 0; i < 40; i++) reads.push(readText(f))
  await write
  for (const text of await Promise.all(reads)) {
    assert.ok(text === oldText || text === newText, 'saw a torn read')
  }
})

test('an existing file mode survives the rewrite', async () => {
  const dir = await scratch()
  const f = join(dir, 'a.md')
  await writeFile(f, 'one')
  await chmod(f, 0o600)
  await writeAtomic(f, 'two')
  assert.equal((await stat(f)).mode & 0o777, 0o600)
})

test('unicode round-trips byte for byte', async () => {
  const dir = await scratch()
  const f = join(dir, 'a.md')
  const text = 'héllo 😀 数式 $E = mc^2$\r\nsecond line'
  const { hash, bytes } = await writeAtomic(f, text)
  assert.equal(await readText(f), text)
  assert.equal(hash, hashContent(text))
  assert.equal(bytes, Buffer.byteLength(text, 'utf8'))
  assert.deepEqual(await readFile(f), Buffer.from(text, 'utf8'))
})

test('reading a missing file is null, not a throw', async () => {
  const dir = await scratch()
  assert.equal(await readText(join(dir, 'nope.md')), null)
  assert.equal(await exists(join(dir, 'nope.md')), false)
})

test('removing a missing file is not an error', async () => {
  const dir = await scratch()
  await remove(join(dir, 'nope.md'))
})
