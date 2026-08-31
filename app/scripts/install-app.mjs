// Put the built app in /Applications.
//
// The last step of `npm run package`, which prints the `cp -R` to run and then
// leaves you to run it. This is that line, plus the two things doing it by hand
// gets wrong.
//
// **It replaces rather than merges.** `cp -R` over an existing bundle copies
// INTO it, leaving whatever the old version had and the new one does not —
// stale resources inside a signed bundle, which is both a mystery to debug and
// a broken signature. The old one goes first.
//
// **And it refuses while Tephra is running.** Replacing a running bundle mostly
// works, because the running process holds its inode — until it lazily loads a
// resource that is no longer where it was, and dies somewhere unrelated. Quit
// first; `--force` is there for when you know better.

import { cp, rm, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const name = `${pkg.productName}.app`
const built = join(root, 'dist', `${pkg.productName}-darwin-${process.arch}`, name)
const installed = join('/Applications', name)
const force = process.argv.includes('--force')

/**
 * Is the app open?
 *
 * **`ps`, not `pgrep`, and that is not a style preference.** `pgrep` run as a
 * child of node could not see node's own parent in a sandboxed shell, so the
 * check silently answered "not running" for a process that was — and a safety
 * check that cannot fail is worse than none, because it is trusted. `ps -Ao
 * comm=` lists the same table and is not subject to it.
 *
 * The basename, compared exactly: `ps` reports a full path, and a match on the
 * whole line would count any process whose PATH happens to contain "Tephra" —
 * this build's own npm script among them.
 */
const running = (() => {
  try {
    const table = execFileSync('ps', ['-Ao', 'comm='], { stdio: 'pipe' }).toString()
    return table
      .split('\n')
      .map(line => line.trim().split('/').pop())
      .includes(pkg.productName)
  } catch {
    return false // no process table is not a reason to refuse to install
  }
})()

if (running && !force) {
  console.error(
    `${pkg.productName} is running. Quit it first, or pass --force if you are sure.\n` +
      'Replacing a running bundle works until the app reaches for a resource that moved.',
  )
  process.exit(1)
}

try {
  await stat(built)
} catch {
  console.error(`No build at ${built}\nRun \`npm run package\` first.`)
  process.exit(1)
}

await rm(installed, { recursive: true, force: true })
await cp(built, installed, { recursive: true, verbatimSymlinks: true })

// The bundle was signed at package time; a copy can invalidate that, so the
// verdict is what decides whether this worked — the failure mode is an app that
// exits silently with no crash report (see the note in package.mjs).
try {
  execFileSync('codesign', ['--verify', '--deep', installed], { stdio: 'pipe' })
  console.log(`Installed ${installed} — signature verifies`)
} catch (err) {
  console.error(`Installed ${installed}, but SIGNATURE PROBLEM: ${String(err)}`)
  process.exit(1)
}
