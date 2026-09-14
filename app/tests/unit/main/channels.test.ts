// Every IPC channel is answered, and every answer is asked for.
//
// **The failure this exists for.** A channel is declared in `shared/ipc.ts`,
// asked for in `preload`, and answered in `main`. Nothing relates the three: a
// channel that is asked and not answered makes the renderer wait for ever, and a
// channel answered and not asked is dead code that reads as live. TypeScript
// cannot see either, because the three sides never refer to one another — only
// to the same string constant.
//
// **Written before the service extractions, for them.** `DocumentService` is
// being split into a service per channel group (D83), and the likeliest way that
// breaks something is a channel left behind: deleted from the switch in `ipc.ts`
// and never declared by the service that took it. The acceptance suites would
// catch it only if a scene happens to use that channel, and most do not. This
// catches it in `npm test`, by name.
//
// **Read from source text, deliberately.** Importing `main` here would import
// Electron; and the question is about what the code *says*, not what it does at
// runtime. The layering test beside this one works the same way, and it has
// earned it.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '../../../src')

/** Every .ts under a directory, recursively. */
async function sources(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...(await sources(join(dir, entry.name))))
    else if (/\.tsx?$/.test(entry.name)) out.push(join(dir, entry.name))
  }
  return out
}

const read = async (rel: string): Promise<string> => readFile(join(ROOT, rel), 'utf8')

/**
 * The keys of `CHANNEL`, taken from the object literal.
 *
 * Braces are counted rather than the closing one being matched, because the
 * object's doc comments contain braces of their own.
 */
async function declared(): Promise<Set<string>> {
  const text = await read('shared/ipc.ts')
  const body = text.split('export const CHANNEL = {')[1] ?? ''
  let depth = 1
  let end = body.length
  for (let at = 0; at < body.length; at += 1) {
    const ch = body[at]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = at
        break
      }
    }
  }
  return new Set(
    [...body.slice(0, end).matchAll(/^\s*(\w+):\s*['"]/gm)].map(m => m[1] as string),
  )
}

/** How many times each channel is named by a pattern, across these files. */
async function countedIn(files: readonly string[], pattern: RegExp): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const file of files) {
    for (const m of (await read(file)).matchAll(pattern)) {
      const key = m[1] as string
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

const keysOf = (counts: Map<string, number>): Set<string> => new Set(counts.keys())

/**
 * What answers a channel in main: a hand-written handler, a `ipcMain.on` for the
 * fire-and-forget ones, or a service's own declaration (D83).
 *
 * **`serveAsked` as well as `serve`**, and forgetting it is how this test first
 * earned its keep: the search service declared `searchOpen` with the variant
 * that is told which window asked, the pattern did not match it, and the test
 * reported a channel the renderer asks for and nothing answers. A false alarm —
 * and the *right* false alarm, because the alternative to a pattern that can
 * miss is no test at all. The honesty guard at the foot fired with it, which is
 * what it is for.
 */
const ANSWERS = /ipcMain\.(?:handle|on)\(\s*CHANNEL\.(\w+)|serve(?:Asked)?\(\s*CHANNEL\.(\w+)/g

/** What the renderer asks for: a reply, or a message with no reply. */
const ASKS = /ipcRenderer\.(?:invoke|send)\(\s*CHANNEL\.(\w+)/g

/** What the renderer waits to be told. */
const LISTENS = /ipcRenderer\.on\(\s*CHANNEL\.(\w+)/g

/** What main pushes without being asked. */
const PUSHES = /announce\(\s*CHANNEL\.(\w+)/g

async function answered(): Promise<Map<string, number>> {
  const files = await sources('main')
  // Two alternatives, so the key is in whichever group matched.
  const counts = new Map<string, number>()
  for (const file of files) {
    for (const m of (await read(file)).matchAll(ANSWERS)) {
      const key = (m[1] ?? m[2]) as string
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

test('EVERY CHANNEL THE RENDERER ASKS FOR IS ANSWERED', async () => {
  // The expensive failure: `ipcRenderer.invoke` on a channel nothing handles
  // never resolves, so the surface simply stops — no error, no log, a spinner
  // that spins for ever.
  const asks = keysOf(await countedIn(['preload/index.ts'], ASKS))
  const has = keysOf(await answered())
  assert.deepEqual(
    [...asks].filter(one => !has.has(one)).sort(),
    [],
    'the renderer would wait for ever',
  )
})

test('AND EVERY ANSWER IS ASKED FOR, or it is dead code reading as live', async () => {
  const asks = keysOf(await countedIn(['preload/index.ts'], ASKS))
  const has = keysOf(await answered())
  assert.deepEqual(
    [...has].filter(one => !asks.has(one)).sort(),
    [],
    'nothing reaches these; either the preload lost a door or main kept a handler',
  )
})

test('NO CHANNEL IS ANSWERED TWICE', async () => {
  // **The migration hazard specifically.** `claim()` refuses two services that
  // declare one channel, and Electron refuses a second handler for one channel —
  // but only when the app starts. During the extractions the likely mistake is a
  // service declaring a channel whose hand-written case in `ipc.ts` was not
  // deleted, and that is this, statically.
  const twice = [...(await answered())].filter(([, n]) => n > 1).map(([key]) => key)
  assert.deepEqual(twice.sort(), [], 'one channel, one answer (D83)')
})

test('EVERY CHANNEL IS EITHER ASKED FOR OR LISTENED TO', async () => {
  // A declaration nothing uses is a channel somebody meant to build, or one
  // whose last user went away and took the memory of it with them.
  const all = await declared()
  const asks = keysOf(await countedIn(['preload/index.ts'], ASKS))
  const hears = keysOf(await countedIn(['preload/index.ts'], LISTENS))
  assert.deepEqual(
    [...all].filter(one => !asks.has(one) && !hears.has(one)).sort(),
    [],
    'declared and unused',
  )
})

test('AND EVERYTHING MAIN PUSHES IS LISTENED FOR', async () => {
  // The other direction of the same gap: a push nobody hears is a message into
  // the void, and it looks exactly like a feature that works.
  const pushed = keysOf(await countedIn(await sources('main'), PUSHES))
  const hears = keysOf(await countedIn(['preload/index.ts'], LISTENS))
  assert.deepEqual(
    [...pushed].filter(one => !hears.has(one)).sort(),
    [],
    'pushed into the void',
  )
})

test('and the counting itself is honest', async () => {
  // **A test over source text is only as good as its patterns**, and a pattern
  // that matched nothing would make every claim above vacuously true. These
  // numbers are the ones observed when the file was written (2026-09-14, after
  // the comment channels began declaring themselves); they are a floor, not an
  // expectation, so ordinary growth does not fail them.
  const all = await declared()
  const has = await answered()
  const asks = keysOf(await countedIn(['preload/index.ts'], ASKS))
  assert.ok(all.size >= 91, `declared ${all.size}`)
  assert.ok(has.size >= 79, `answered ${has.size}`)
  assert.ok(asks.size >= 79, `asked ${asks.size}`)
})
