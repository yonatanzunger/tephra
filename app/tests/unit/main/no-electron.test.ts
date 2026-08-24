// The layering, asserted rather than remembered.
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
import { dirname, join } from 'node:path'

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
  'main/x/stream-document.ts',
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
