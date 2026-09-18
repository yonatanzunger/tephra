// MH2: the horizon exists, and it draws on both its sources.
//
// **The claim of the phase, checked in a running window.** The unit and
// integration suites prove the *query* — that a suspended matter drops off, that
// a generated step is on the list and not here, that a completion-driven
// recurrence shows one instance and not a guessed sequence. None of them can say
// that the **place** exists: that ⌘3 opens a window on it, that the frame,
// sidebar and title bar are unchanged around a location that is not a document,
// that rows read as sentences rather than as notation, or that the strip above
// the task list now holds a matter as well as a task.
//
// It also checks the one thing the design names as this phase's own hazard: *the
// horizon fills, stops being read, and blindness returns through the front
// door.* A monthly bill puts a row a month into a long window, and something has
// to be able to shorten it.
//
// The claims, one per section:
//   1. it is a place (D74) — a location that is not a document, with a title
//   2. both sources, in one date-ordered list, from the start
//   3. a reminder finally has somewhere to go (H6), and says which occurrence
//   4. the window is the reader's, because the noise risk is real
//   5. the compact strip gained the second source (H8, narrowed until MH4)
//   6. it is legible: reading face, reading size, every class actually styled

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electron = './node_modules/.bin/electron'

/** Today in the reference zone (D38) — never a hard-coded date; see m2. */
const DAY = new Date(Date.now() - 8 * 60 * 60_000).toISOString().slice(0, 10)
const [YEAR, MONTH] = DAY.split('-')
const from = days =>
  new Date(Date.parse(`${DAY}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** A notebook with a day in it and no dockets: the scene makes what it needs. */
async function notebook() {
  const root = await mkdtemp(join(tmpdir(), 'tephra-mh2-'))
  await mkdir(join(root, 'notebook.stream', YEAR, MONTH), { recursive: true })
  await writeFile(
    join(root, 'notebook.stream', YEAR, MONTH, `${DAY}.md`),
    `---\ndate: ${DAY}\n---\n\nThe boiler is making that noise again.\n`,
  )
  return root
}

const spent = []

function launch(scene, root, { timeoutMs = 240_000, shotDelay = 20_000, shot } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      TEPHRA_VERIFY_MODE: '1',
      TEPHRA_VERIFY: scene,
      TEPHRA_ROOT: root,
      TEPHRA_SHOT_DELAY: String(shotDelay),
      ...(shot === undefined ? {} : { TEPHRA_SHOT: shot }),
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

console.log('— the horizon —')
const root = await notebook()
const shot = process.env.TEPHRA_MH2_SHOT ?? join(tmpdir(), 'tephra-mh2.png')
const said = await launch('horizon', root, { shot })
const r = report(said)
// **A scene that did not finish is not a scene that passed** (mh1's lesson).
if (r.appError === undefined) {
  console.log(' FAIL  the scene ran to the end\n        no appError line: it threw or timed out partway')
  console.log(said.trim() === '' ? '        (the window said nothing at all)' : said)
  process.exit(1)
}

// ── 1. it is a place ────────────────────────────────────────────────────────
check(
  // **Amended by MH4.** D74 made the full horizon a location with a ⌘-number of
  // its own, on the test *does following an entry mean you are done with the
  // list?* A different question turned out to win: what you are doing and what
  // is coming are two halves of ONE question, and a person consulting both was
  // keeping two windows open to do what one should.
  'IT IS HALF OF THE WORKING VIEW: the list and the horizon, in one place',
  r.surface === true && r.bothHalves?.list > 0 && r.bothHalves?.horizon > 0,
  `${JSON.stringify(r.bothHalves)} \u00b7 surface ${r.surface}`,
)
check('and nothing went wrong getting there', r.appError === 'none', String(r.appError))

// ── 2. both sources, in one list ────────────────────────────────────────────
console.log('\n— both sources, from the start —')
const rows = Array.isArray(r.rows) ? r.rows : []
check(
  'THE POINT OF THE PHASE: a dated matter and a dated task are in ONE list',
  rows.some(one => one.kind === 'due') && rows.some(one => one.kind !== 'due'),
  JSON.stringify(rows.map(one => `${one.kind}: ${one.what}`)),
)
check(
  'and it is date-ordered, which is the restored spreadsheet',
  Array.isArray(r.days) && r.days.length > 1,
  JSON.stringify(r.days),
)
// ── an event that lasts (D92) ───────────────────────────────────────────────
check(
  // Reported from use, and the evidence was the notebook itself: seven of ten
  // matters on a real events docket had written the range into their own titles
  // — *Santa Monica 9-17 → 9-22* — because there was nowhere else to put it.
  'AN EVENT HAS AN EXTENT: the end date is stored as a field',
  r.spanStored === r.spanAsked?.until,
  `asked ${JSON.stringify(r.spanAsked)} · stored ${r.spanStored}`,
)
check(
  'and an end before the start is refused rather than stored',
  r.backwardsRefused === true,
)
check(
  // The behaviour the field buys: a sweep that asked about the first day only
  // dropped a trip on its second morning, which is when you most need to see it.
  'IT IS STILL ON THE HORIZON the day after it began, and not marked past',
  Array.isArray(r.spanRow) && r.spanRow.length === 1 && r.spanRow[0].past === false,
  JSON.stringify(r.spanRow),
)
check(
  // *Visually prominent*, asked for in those words: the range is the row's
  // headline fact, so it is in the date column in the date's own ink.
  'and the range is in the date column, both ends, at the date\'s own weight',
  Array.isArray(r.spanRow) && / → /.test(String(r.spanRow[0]?.on)) &&
    Number(r.spanRow[0]?.weight) >= 600,
  `${JSON.stringify(r.spanRow[0]?.on)} at weight ${r.spanRow[0]?.weight}`,
)

check(
  'A ROW IS THE SHORT LINE: no link markup, no tag, no due date',
  // Reported from use: a Google Docs URL sprawling across three lines of a
  // surface meant to be glanced at, with the tag and the date beside it.
  rows.every(one => !/DUE \d{4}|https?:|\[|#career/.test(one.what ?? '')),
  JSON.stringify(rows.map(one => one.what)),
)
check(
  'and the words themselves survive it',
  rows.some(one => one.what === "Review Steve's bio draft"),
  JSON.stringify(rows.map(one => one.what)),
)
check(
  'and a step waiting on another appears once its antecedent is dated',
  rows.some(one => one.what === 'have the car fixed'),
  JSON.stringify(rows.map(one => one.what)),
)

// ── 3. a reminder has somewhere to go ───────────────────────────────────────
console.log('\n— awareness with no task (H6) —')
check(
  'A REMINDER FINALLY LANDS: a status step is a row, which MH3a left inert',
  rows.some(one => one.kind === 'coming up' && one.what === 'work out what the plan is'),
  JSON.stringify(rows.filter(one => one.kind === 'coming up').map(one => one.what)),
)
check(
  'and it says WHICH OCCURRENCE it belongs to, an unlabelled pair being worse',
  rows.find(one => one.what === 'work out what the plan is')?.instance != null,
  JSON.stringify(rows.find(one => one.what === 'work out what the plan is')),
)
check(
  'and does NOT repeat the matter’s name when the row already says it',
  rows.filter(one => one.matter !== null).every(one => one.matter !== one.what),
  JSON.stringify(rows.map(one => [one.what, one.matter])),
)

// ── 4. the window is the reader's ───────────────────────────────────────────
console.log('\n— the noise risk, which this design names as its own —')
check(
  'HOW FAR AHEAD IS A CHOICE, because a monthly bill fills a long window',
  Array.isArray(r.spans) && r.spans.length === 3,
  JSON.stringify(r.spans),
)
check(
  'and choosing a shorter one actually shortens it',
  r.narrowed?.narrow < r.narrowed?.wide,
  JSON.stringify(r.narrowed),
)

// ── 5. the compact strip ────────────────────────────────────────────────────
console.log('\n— one view, both halves (H8; MH4 amends D74) —')
check(
  'and it shows the short line, it having least room of anywhere',
  (r.strip ?? []).every(one => !/https?:|\[|#career/.test(one.what ?? '')),
  JSON.stringify((r.strip ?? []).map(one => one.what)),
)
check(
  'IT HOLDS BOTH SOURCES: a matter shows beside a dated task',
  Array.isArray(r.strip) && r.strip.some(one => one.docket) && r.strip.some(one => !one.docket),
  JSON.stringify(r.strip),
)
check(
  'and it is one region with one meaning, sorted by date and not by source',
  // **Interleaved, which is the claim.** A strip that grouped its two sources
  // would be the shape MT5a rejected — a region meaning two things depending on
  // what put something there — and grouping is exactly how that would show. So
  // the test is that the flags are NOT partitioned, rather than that some list
  // of words is in order: "in 3 days" sorts before "today" alphabetically, and
  // asserting that proved only that the checker could be fooled.
  // **The claim is DATE order, so test date order.** An earlier cut tested that
  // the two sources interleave, which they only do when the fixture happens to
  // alternate — a true claim about this data rather than about the rule, and it
  // broke the moment the data changed. What must hold is that every row's day is
  // on or after the one before it, whatever made them.
  // **And a range sorts by the day it starts** (D92), which is why this reads
  // the half of the cell before the arrow: *16 Sep → 22 Sep* is not a date and
  // `Date.parse` says NaN, which failed the order test for a row that was in
  // perfect order. The claim is unchanged; what changed is that a cell can now
  // hold two dates.
  (() => {
    const days = (r.strip ?? [])
      .map(one => Date.parse(`${String(one.when).split(' → ')[0]} 2026`))
    return days.length > 2 && days.every((d, at) => at === 0 || d >= days[at - 1])
  })(),
  JSON.stringify((r.strip ?? []).map(one => [one.when, one.docket])),
)

// ── 6. legibility ───────────────────────────────────────────────────────────
console.log('\n— legibility —')
check(
  'EVERY CLASS THE SURFACE STYLES has a rule to style it',
  Array.isArray(r.styled) && r.styled.length === 0,
  `no rule written for: ${JSON.stringify(r.styled)}`,
)
check(
  'and a row is set in the notebook’s reading face, not a UI font (D41, H3)',
  typeof r.reading?.family === 'string' && !/DM Sans|system-ui/.test(r.reading.family),
  JSON.stringify(r.reading),
)

console.log(`\nshot: ${shot}`)
console.log(`${spent.map(s => `${s.scene} ${(s.ms / 1000).toFixed(1)}s`).join('  ')}`)
const failed = checks.filter(c => !c.ok)
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`)
void from
process.exit(failed.length === 0 ? 0 : 1)
