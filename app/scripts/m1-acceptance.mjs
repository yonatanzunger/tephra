// M1: the corpus becomes safe.
//
// M0 asked whether the app could write a file and find it again. This asks the
// harder question — **whether anything can be lost.** Four real launches, a
// deliberate crash, and every assertion made against the files and the git
// repository on disk rather than against the app's own account of itself.
//
// The claims, one per section:
//   1. a crash between keystroke and file write loses nothing
//   2. text overwritten later is still recoverable from an earlier version
//   3. a day past 1 MB splits, and reads back as one day
//   4. the repository is one a standard `git` can read

import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'tephra-m1-'))
const electron = './node_modules/.bin/electron'

function launch(scene, { abrupt = false, timeoutMs = 45_000, env: extra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      TEPHRA_VERIFY_MODE: '1',
      TEPHRA_VERIFY: scene,
      TEPHRA_ROOT: root,
      ...(abrupt ? { TEPHRA_EXIT: 'abrupt' } : {}),
      ...extra,
    }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, ['.'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`scene ${scene} timed out\n${out}`))
    }, timeoutMs)
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (out += d))
    child.on('exit', () => {
      clearTimeout(timer)
      resolve(out)
    })
  })
}

const report = out =>
  Object.fromEntries(
    out
      .split('\n')
      .filter(l => l.startsWith('VERIFY ') && l.includes(': '))
      .map(l => {
        const rest = l.slice('VERIFY '.length)
        const at = rest.indexOf(': ')
        try {
          return [rest.slice(0, at), JSON.parse(rest.slice(at + 2))]
        } catch {
          return [rest.slice(0, at), rest.slice(at + 2)]
        }
      }),
  )

const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`)
}

const dayFiles = async () => {
  const found = []
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.md')) found.push(path)
    }
  }
  await walk(join(root, 'stream'))
  return found.sort()
}

console.log(`notebook: ${root}\n`)

// ── 1. a crash loses nothing ────────────────────────────────────────────────
console.log('— the crash —')
// The file tier is held open for the duration, so "it had not written yet" is
// a fact rather than a race. It was a race, and it lost twice under load.
const crashed = report(await launch('crash', { abrupt: true, env: { TEPHRA_QUIESCE_MS: '60000' } }))
check('typed something before dying', crashed.typed === true)

const filesAfterCrash = await dayFiles()
const textAfterCrash = filesAfterCrash.length
  ? await readFile(filesAfterCrash[0], 'utf8')
  : ''
check(
  'the file tier had NOT yet written it — so the log is what is being tested',
  !textAfterCrash.includes('SURVIVES-THE-CRASH'),
  // Report what was FOUND, not what was hoped for. This note claimed the text
  // was absent without checking, so two earlier failures printed a reassuring
  // sentence beside a red line and told nobody anything.
  filesAfterCrash.length === 0
    ? 'no day file at all'
    : textAfterCrash.includes('SURVIVES-THE-CRASH')
      ? 'the file tier HAD written it — the race was lost'
      : 'day file exists, without the text',
)
const log = await readFile(join(root, '.tephra', 'wal', 'stream.jsonl'), 'utf8').catch(() => '')
check('the write-ahead log holds the edit', log.includes('SURVIVES-THE-CRASH'))

const recovered = await launch('summary')
check(
  'reopening recovers it',
  recovered.includes('recovered 1 unsaved edit'),
  recovered.split('\n').find(l => l.includes('recovered')) ?? '',
)
const afterRecovery = await readFile((await dayFiles())[0], 'utf8')
check('and it is on disk afterwards', afterRecovery.includes('SURVIVES-THE-CRASH'))
check(
  'exactly once, not duplicated by the replay',
  afterRecovery.split('SURVIVES-THE-CRASH').length - 1 === 1,
)

// ── 2. an earlier version is recoverable ────────────────────────────────────
console.log('\n— the history —')
check('a version was recorded on quit', git('log', '--oneline').split('\n').length >= 1)
const before = git('rev-parse', 'HEAD')

await launch('edit-again')
const nowOnDisk = await readFile((await dayFiles())[0], 'utf8')
check('the newer text replaced the older', nowOnDisk.includes('REPLACED-ENTIRELY'))
check('and the older text is gone from the file', !nowOnDisk.includes('SURVIVES-THE-CRASH'))

const dayPath = (await dayFiles())[0].slice(root.length + 1)
const historic = git('show', `${before}:${dayPath}`)
check(
  'THE POINT: the older text is still readable from the earlier version',
  historic.includes('SURVIVES-THE-CRASH'),
)

// ── 3. a day past 1 MB splits and reads back as one ─────────────────────────
console.log('\n— the split —')
const today = dayPath.split('/').pop().replace('.md', '')
const [y, m] = today.split('-')
let big = ''
let i = 0
while (big.length <= 1_050_000) big += `Paragraph ${i++}. ${'word '.repeat(40)}\n\n`
await mkdir(join(root, 'stream', y, m), { recursive: true })
await writeFile(join(root, 'stream', y, m, `${today}.md`), `---\ndate: ${today}\n---\n\n${big}`)

// TYPE into it. A day is only ever written when it is dirty — we never rewrite
// a file we did not change (format-spec) — so an oversized day that arrived
// from outside stays one file until it is next edited. That is the real path a
// day takes across the threshold, and the one worth asserting.
await launch('write')
const split = report(await launch('summary'))
const parts = (await dayFiles()).filter(f => f.includes(today))
check('the day was split into parts', parts.length > 1, parts.map(p => p.split('/').pop()).join(', '))
check(
  'part 2 declares itself',
  parts.length > 1 && (await readFile(parts.find(p => p.includes('.2.')), 'utf8')).includes('part: 2'),
)
check(
  'and the app reads it back as ONE day of the right size',
  Math.abs((split.summary?.length ?? 0) - big.length) < 200,
  `read ${split.summary?.length ?? 0} of ${big.length}`,
)

// ── 4. the repository is a real one ─────────────────────────────────────────
console.log('\n— the exit —')
git('fsck', '--strict')
check('git fsck --strict is clean', true)
check('the working tree is clean', git('status', '--porcelain') === '')
check('a stranger can read the log', git('log', '--oneline').length > 0, git('log', '--oneline').split('\n')[0])
check(
  'the machine-local directory was never committed',
  !git('ls-files').includes('.tephra/'),
)
check('but the notebook was', git('ls-files').includes('stream/'))

const failed = checks.filter(c => !c.ok)
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`)
if (failed.length > 0) process.exit(1)
