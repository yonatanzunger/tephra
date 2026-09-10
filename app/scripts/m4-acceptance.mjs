// M4: you can find what you wrote.
//
// **The claim of the milestone, checked in a running window**: type a phrase,
// land on it, walk backwards through the corpus, turn round and come back.
//
// It exists because the two suites beneath it cannot see this one. The engine's
// tests prove that a scan finds a line and a cursor pulls one hit at a time; the
// parser's prove that `foo #wombats` is a phrase and a scope. Neither can say
// that ⌘F is wired to any of it, that the match is *selected* rather than merely
// scrolled to, or that walking back and forward again returns you to where you
// began — which is the thing that makes a find usable rather than merely
// correct.
//
// The claims, one per section:
//   1. ⌘F opens a bar, Enter lands on the newest match, and the match is selected
//   2. Find Earlier walks back through the days, and Find Later comes back
//   3. a phrase nobody wrote says so, and moves nothing
//   4. ⌘⇧F shows every place at once, and a row goes there

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electron = './node_modules/.bin/electron'

/** Today in the reference zone (D38) — never a hard-coded date; see m2. */
const DAY = new Date(Date.now() - 8 * 60 * 60_000).toISOString().slice(0, 10)

/**
 * Several days, each holding the word once, so that walking has somewhere to go.
 *
 * **The newest day is today**, because that is where the app opens and where a
 * walk backwards has to start from.
 */
async function week(bodies) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-m4-'))
  for (let back = 0; back < bodies.length; back++) {
    const at = new Date(Date.parse(`${DAY}T12:00:00Z`) - back * 86_400_000)
    const key = at.toISOString().slice(0, 10)
    const [y, m] = key.split('-')
    await mkdir(join(root, 'notebook.stream', y, m), { recursive: true })
    await writeFile(join(root, 'notebook.stream', y, m, `${key}.md`), `---\ndate: ${key}\n---\n\n${bodies[back]}`)
  }
  return root
}

const spent = []

function launch(scene, root, { timeoutMs = 60_000, shotDelay = 16_000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      TEPHRA_VERIFY_MODE: '1',
      TEPHRA_VERIFY: scene,
      TEPHRA_ROOT: root,
      TEPHRA_SHOT_DELAY: String(shotDelay),
    }
    delete env.ELECTRON_RUN_AS_NODE
    const began = Date.now()
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
      spent.push({ scene, ms: Date.now() - began })
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

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`)
}

// ── 1..3. finding ───────────────────────────────────────────────────────────
console.log('— finding —')
{
  // Newest first: today mentions the surveyor, and so do the two days before it.
  const root = await week([
    'Rang the surveyor again about the boundary, and the surveyor said Thursday.\n',
    'Nothing much today.\n',
    'The surveyor came back with a number.\n',
    'Booked the surveyor for Thursday.\n',
  ])
  const r = report(await launch('find', root, { shotDelay: 20_000 }))

  check('the menu item exists and fired', r.menuItemFound === true)
  check('and a find bar came up', r.barShown === true)
  check(
    'Enter landed on the word, selected',
    r.firstFound === 'surveyor',
    `found=${JSON.stringify(r.firstFound)} at=${r.firstAt}`,
  )
  check('Find Earlier walked backwards in time', r.steppedEarlier === true && r.movedBack === true,
    `second=${JSON.stringify(r.secondFound)}`)
  check('and found the word there too', r.secondFound === 'surveyor')
  check('Find Later came back to where it started', r.steppedLater === true && r.cameBack === true,
    `first=${r.firstAt} third=${r.thirdAt}`)
  check(
    'the match it landed on is marked in the text',
    r.markedNow === 1 && r.markedAll >= 1,
    `now=${r.markedNow} all=${r.markedAll}`,
  )
  check('and the others on the page are marked too', r.markedAll >= 2, `all=${r.markedAll}`)
  check('the bar counts the matches, and says which one this is',
    /^1 \/ \d+…?$/.test(String(r.tally)), String(r.tally))
  check('stepping past the oldest wraps round to the newest',
    String(r.saidWhenWrapped).startsWith('\u21bb'), `${r.saidWhenWrapped} after ${r.stepsToWrap} steps`)
  check('and the tally says it is back at the first',
    /^\u21bb 1 \/ \d+…?$/.test(String(r.saidWhenWrapped)), String(r.saidWhenWrapped))
  check('and the loop closes on the newest match', r.wrapIsFirst === true,
    `${r.wrappedTo} vs ${r.firstAt}`)
  check('a phrase nobody wrote says so', r.saidWhenNothing === 'nothing', String(r.saidWhenNothing))
  check('and moves nothing when it does', r.caretUnmoved === true)
  check('Escape closes the bar', r.closed === true)
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

// ── 4. searching the whole notebook ─────────────────────────────────────────
console.log('\n— searching —')
{
  const root = await week([
    // Two mentions in ONE line on the newest day: one row, two marks.
    'Rang the surveyor again, and the surveyor said Thursday.\n',
    'Nothing much today.\n',
    'The surveyor came back with a number.\n',
    'Booked the surveyor for Thursday.\n',
  ])
  const r = report(await launch('search', root, { shotDelay: 24_000, timeoutMs: 75_000 }))

  check('the menu item exists and fired', r.menuItemFound === true)
  check('and the pane came up, named', r.paneShown === true && r.titleWhenEmpty === 'Search',
    String(r.titleWhenEmpty))
  check('a row per line, across days', r.rows === 3, `rows=${r.rows}`)
  check(
    'each showing the words that answered',
    r.marked === 4 && r.firstMark === 'surveyor',
    `marked=${r.marked} first=${JSON.stringify(r.firstMark)}`,
  )
  check('two matches in one line are one row, and say so', r.grouped === 1, `grouped=${r.grouped}`)
  check('and where it came from', r.sources === 3, `sources=${r.sources}`)
  check('the count says how many', /^3( found)?$/.test(String(r.counted)), String(r.counted))
  check('the title says what is being looked for', r.titleWhenSearching === 'Search: surveyor',
    String(r.titleWhenSearching))
  check('clicking a row goes to the passage', r.wentThere === true, String(r.titleAfterGoing))
  check('and back returns to the results', r.back === true && r.resultsAgain === 3,
    `back=${r.back} rows=${r.resultsAgain}`)
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

console.log(`\n${spent.map(s => `${s.scene} ${(s.ms / 1000).toFixed(1)}s`).join('  ')}`)
const failed = checks.filter(c => !c.ok)
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length === 0 ? 0 : 1)
