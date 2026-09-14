// The layering, asserted rather than remembered.
//
// Two rules live here. The first is that the service stays Electron-free, which
// is what lets the integration suites drive it under plain node. The second is
// the invariant stack (D54): a layer may use the one below it and no lower, and
// the floor under X's documents is `x/documents/`.
//
// Both are the same kind of rule — invisible while it holds, and broken by an
// import added for a perfectly good local reason. A comment saying so did not
// prevent the third breakage of the first rule, so both are tests.
//
// `DocumentService` orchestrates X and W and is deliberately free of Electron,
// which is what lets three integration suites drive it under plain node. That
// property has now been broken three times, by three different imports, each
// added for a good local reason:
//
//   1. `app.isPackaged` at module scope, which threw before the app could log.
//   2. `import { shell }` for opening a link, which broke all three suites.
//   3. `import { verifyEnv }` for a timing knob — verify-mode imports `app`.
//
// Every one was found by a test failing several layers away from the cause, and
// every fix was the same: the service says what it needs and the Electron layer
// supplies it. A comment saying so did not prevent the third, so this is a test.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readdir } from 'node:fs/promises'

const here = dirname(fileURLToPath(import.meta.url))
const src = (rel: string): string => join(here, '../../../src', rel)

/**
 * Files that must run under plain node.
 *
 * Not "everything in main" — `index.ts`, `ipc.ts`, `menu.ts` and `print.ts` ARE
 * the Electron layer and importing it is their job. These are the ones with
 * tests that construct them directly.
 */
const NODE_ONLY = [
  'main/document-service.ts',
  'main/x/documents/kinds/stream.ts',
  'main/x/segment.ts',
  'main/x/comments.ts',
  'main/x/markers.ts',
  'main/x/prose.ts',
  'main/w/notebook.ts',
  'main/w/git-repository.ts',
  'main/w/wal.ts',
]

for (const rel of NODE_ONLY) {
  test(`${rel} does not import electron`, async () => {
    const text = await readFile(src(rel), 'utf8')
    const offenders = [...text.matchAll(/^\s*import[^\n]*from\s*'([^']+)'/gm)]
      .map(m => m[1] as string)
      .filter(from => from === 'electron' || from.startsWith('electron/'))
    assert.deepEqual(
      offenders,
      [],
      `${rel} imports Electron. Whatever it needs should be passed in by the ` +
        `layer that already has it — see the header of this file.`,
    )
  })
}

test('and it does not reach it second-hand either', async () => {
  // The third breakage was indirect: `verify-mode.ts` imports `app`, so
  // importing `verifyEnv` imported Electron without the word appearing.
  const text = await readFile(src('main/document-service.ts'), 'utf8')
  assert.equal(text.includes("from './verify-mode.ts'"), false, 'verify-mode imports Electron')
})

// ── the invariant stack (D54) ─────────────────────────────────────────────

const ROOT = join(here, '../../../src')

/** Every .ts/.tsx under a directory, as paths relative to `src`. */
async function sources(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await sources(join(dir, entry.name), rel)))
    else if (/\.tsx?$/.test(entry.name)) out.push(rel)
  }
  return out
}

/** What a file imports, as written — specifiers, not resolved paths. */
async function importsOf(root: string, rel: string): Promise<readonly string[]> {
  const text = await readFile(join(ROOT, root, rel), 'utf8')
  return [...text.matchAll(/from\s*'([^']+)'/g)].map(m => m[1] as string)
}

/**
 * **The floor is `x/documents/`.**
 *
 * Everything above it says what it wants in documents and lets the Corpus find
 * the file (D54). The rule is worth a test because breaking it is so easy and
 * so quiet: one `notebook.read` in a feature works perfectly, and the price —
 * a write that no open document knows about — is paid somewhere else entirely.
 *
 * `w/layout.ts` is deliberately not on this list. It is path vocabulary with no
 * I/O in it, and a document is NAMED by its path, so the names are shared.
 */
const STORAGE = ['w/notebook.ts', 'w/index-store.ts', 'w/git-repository.ts', 'node:fs']

/**
 * Files that read the machine rather than the notebook.
 *
 * **The rule is about notebook content**, and the price it names — a write no
 * open document knows about — cannot be paid by a file that is not in the
 * corpus and never could be. `/etc/localtime` is an operating system setting;
 * there is no document to ask the Corpus for. Exempted by name so that adding
 * to this list is a decision somebody makes on purpose.
 */
const NOT_THE_NOTEBOOK = ['system-zone.ts']

/**
 * Where the app is assembled, and so the one place allowed to make a Notebook.
 *
 * **`core-service.ts` is the floor's doorway** (D83): it makes the `Corpus` and
 * the `CorpusIndex` — peers, both built over the notebook — and hands every
 * layer above it a way to reach documents without ever naming a file.
 * `document-service.ts` is still here because it is still being split; it leaves
 * this list when the last of it has moved into a service.
 */
const COMPOSITION = ['index.ts', 'core-service.ts', 'document-service.ts', 'print.ts']

test('only the floor touches storage', async () => {
  const offenders: string[] = []
  for (const rel of await sources('main')) {
    if (COMPOSITION.includes(rel) || NOT_THE_NOTEBOOK.includes(rel)) continue
    if (rel.startsWith('w/') || rel.startsWith('x/documents/')) continue
    for (const from of await importsOf('main', rel)) {
      const target = from.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '')
      if (STORAGE.some(s => target === s || target.startsWith(`${s}/`))) {
        offenders.push(`${rel} imports ${from}`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'above the floor, ask the Corpus for a document rather than the notebook for a file',
  )
})

test('and the floor does not reach back up', async () => {
  // The other direction of the same rule. A document that imports the service
  // is a cycle, and a cycle is how a layer stops being a layer.
  const floor = join(ROOT, 'main/x/documents')
  const offenders: string[] = []
  for (const rel of await sources('main/x/documents')) {
    for (const from of await importsOf('main/x/documents', rel)) {
      if (!from.startsWith('.')) continue
      const target = resolve(dirname(join(floor, rel)), from)
      // Sideways within X is fine — the format modules are the floor's own.
      if (!target.startsWith(join(ROOT, 'main/')) || target.startsWith(join(ROOT, 'main/x/'))) continue
      if (target.startsWith(join(ROOT, 'main/w/'))) continue
      offenders.push(`${rel} imports ${from}`)
    }
  }
  assert.deepEqual(offenders, [], 'the floor is under everything and holds nothing up')
})

test('shared belongs to both processes, so it imports neither', async () => {
  const offenders: string[] = []
  for (const rel of await sources('shared')) {
    for (const from of await importsOf('shared', rel)) {
      if (/(^|\/)(main|renderer)\//.test(from)) offenders.push(`${rel} imports ${from}`)
    }
  }
  assert.deepEqual(offenders, [], 'shared is the vocabulary, not a user of either side')
})

test('the renderer reaches main through IPC, never through an import', async () => {
  // Z holds no files and no notebook (D37). An import from main would compile,
  // then fail at runtime in a way that names a module rather than a boundary.
  const offenders: string[] = []
  for (const rel of await sources('renderer')) {
    for (const from of await importsOf('renderer', rel)) {
      if (/(^|\/)main\//.test(from)) offenders.push(`${rel} imports ${from}`)
    }
  }
  assert.deepEqual(offenders, [], 'the renderer talks to main over the wire')
})

/**
 * `Document` is a DOM global, and Electron's types pull the DOM into main.
 *
 * So a file that uses `Document` without importing OURS compiles perfectly and
 * means something else entirely — the browser's, whose `createElement` the
 * error message then complains about, several layers from the cause. It cost an
 * afternoon once (D54).
 */
test('nothing in main uses the ambient DOM Document', async () => {
  const offenders: string[] = []
  for (const rel of await sources('main')) {
    const text = await readFile(join(ROOT, 'main', rel), 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const imported = [...code.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from/g)]
      .flatMap(m => (m[1] as string).split(','))
      .map(name => name.replace(/^\s*type\s+/, '').trim())
    const body = code.replace(/import[\s\S]*?from\s*'[^']+'/g, '')
    if (/\bDocument\b/.test(body) && !imported.includes('Document')) {
      offenders.push(rel)
    }
  }
  assert.deepEqual(offenders, [], 'import Document from shared/document-api.ts, or say which one you mean')
})

/**
 * **A surface owns its editor, and nothing else may reach into it.**
 *
 * `bind.ts` and everything beside it under `kinds/markdown/` are not a shared
 * editing facility that the app happens to use — they ARE the markdown surface,
 * which is one of several ways a document could be shown (D54). The moment
 * something outside imports `@codemirror/view`, the app has a second opinion
 * about how documents are edited, and the kind axis stops being a lookup.
 *
 * The markdown PARSER is exempt on purpose: `@lezer/markdown` is how this app
 * reads markdown, and printing and importing read markdown without editing it.
 * What is fenced off is the editor, not the format.
 */
test('only the markdown surface holds the editor', async () => {
  const EDITOR = ['@codemirror/view', '@codemirror/state', '@codemirror/commands']
  const inside = 'renderer/src/editor/kinds/markdown/'
  const offenders: string[] = []
  for (const root of ['renderer', 'main', 'shared']) {
    for (const rel of await sources(root)) {
      if (`${root}/${rel}`.startsWith(inside)) continue
      for (const from of await importsOf(root, rel)) {
        if (EDITOR.includes(from)) offenders.push(`${root}/${rel} imports ${from}`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'the editor belongs to the markdown surface; ask it through SurfaceProps instead',
  )
})

/**
 * **Every write that is a DOCUMENT goes through one** (D54, MC7).
 *
 * The audit MC7 called for, kept rather than done once. A file written around
 * the document layer is undone by the buffer of anything holding that document
 * open — silently, on the next write tier, which is the failure a restore
 * exists to prevent wearing different clothes.
 *
 * Three kinds of caller are allowed to write files, and each is allowed for a
 * reason rather than by exception:
 *
 *  - `w/` IS the file system, and writing is what it is for.
 *  - `x/documents/` is a document writing ITSELF — `writeDirty`, `removeSegment`
 *    and the Corpus's creator are the document layer, not a way around it.
 *  - MACHINERY: `.tephra/` holds the WAL, the index cache and `ui-state.json`,
 *    which are how this machine runs the app rather than documents in the
 *    corpus. They are excluded from git for the same reason.
 *
 * `branch` used to be a fourth: it wrote its new note straight to disk, and was
 * the last write in the app that went around a document. It is the Corpus's
 * creator now.
 */
test('nothing writes a document behind the document layer', async () => {
  const WRITES = /\b(notebook|store)\.(write|remove)\s*\(/
  const offenders: string[] = []
  for (const rel of await sources('main')) {
    if (rel.startsWith('w/') || rel.startsWith('x/documents/')) continue
    const text = await readFile(join(ROOT, 'main', rel), 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const line of code.split('\n')) {
      if (!WRITES.test(line)) continue
      // Machinery is named by the constant it writes to, so the exemption is
      // visible at the call site rather than kept in a list here.
      if (line.includes('LOCAL.')) continue
      offenders.push(`${rel}: ${line.trim()}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'ask the Corpus for the document and write through it — see this test\'s comment',
  )
})
