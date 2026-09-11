// MH1: a docket is a document you can think with.
//
// **The claim of the phase, checked in a running window.** MH1 exists to serve
// one thing — a household planning conversation, two people at a table, one of
// them not driving the keyboard — and the roadmap is explicit that what it tests
// is *whether this is a good surface to think with alongside another person*,
// not whether it helps anybody remember. Nothing generates yet; nothing reminds.
//
// It exists because the suites beneath it cannot see this. The grammar's tests
// prove a block round-trips and that the thirtieth of February is refused; the
// service's prove a verb rewrites one block and leaves its neighbours
// byte-identical. Neither can say that the *gesture* exists — that `New Docket…`
// asks for a name, that a date typed the way a person types one lands in the
// file, that a note shows without being hunted for, or that a recurrence reads
// as words rather than as notation. Every one of those was a defect found from
// use, after the tests were green.
//
// The claims, one per section:
//   1. the gesture exists and ASKS — the first cut made `untitled.docket.md`
//      silently, which is what use reported first
//   2. a matter takes a date, a range, or nothing, and *nothing* says so in words
//   3. a recurrence is anchored, because the anchor cannot be reconstructed later
//   4. a note and a run-up live under one matter, both visible without a click
//      — and a matter is moved by dragging its grip, or by ↑/↓ on a focused one
//   5. it is legible: reading face, reading size, one language across the row

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electron = './node_modules/.bin/electron'

/** Today in the reference zone (D38) — never a hard-coded date; see m2. */
const DAY = new Date(Date.now() - 8 * 60 * 60_000).toISOString().slice(0, 10)
const [YEAR, MONTH] = DAY.split('-')

/**
 * A notebook with a day in it and no dockets at all.
 *
 * **Empty of dockets on purpose**: the gesture under test is the one that makes
 * the first one, and a fixture that ships a docket would never exercise it.
 */
async function notebook() {
  const root = await mkdtemp(join(tmpdir(), 'tephra-mh1-'))
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

console.log('— making one, and working it —')
const root = await notebook()
const shot = process.env.TEPHRA_MH1_SHOT ?? join(tmpdir(), 'tephra-mh1.png')
const r = report(await launch('docket', root, { shot }))
// **A scene that did not finish is not a scene that passed.** `appError` is the
// last thing every scene says, so its absence means the window stopped early and
// every check below is measuring nothing.
if (r.appError === undefined) {
  console.log(' FAIL  the scene ran to the end\n        no appError line: it threw or timed out partway')
  process.exit(1)
}

// ── 1. the gesture ──────────────────────────────────────────────────────────
check('the menu item exists and fired', r.menuItemFound === true)
check(
  'and it ASKS for a name rather than inventing one',
  r.asked === true,
  'the first cut wrote untitled.docket.md with no prompt; reported from use',
)
check('the name given is the one on the window', r.title === 'The house', String(r.title))
check('a docket surface opened, not the markdown editor', r.surface === true)
check('and the sidebar found the file and calls it by name', r.inSidebar === true)

// ── 2. matters, dated and not ───────────────────────────────────────────────
// Sampled right after the FIRST one goes in, so one is the whole claim here;
// `rowsAtEnd` is the count once all three are on.
check('a matter added from the surface appears on it', r.rows === 1, `rows=${r.rows}`)
check(
  'named as it was typed',
  Array.isArray(r.names) && r.names.includes('Service the boiler'),
  JSON.stringify(r.names),
)
check(
  'a date typed the way a person types one is kept',
  Array.isArray(r.whens) && r.whens.includes('2026-10-14'),
  JSON.stringify(r.whens),
)
check(
  'a field you type a sentence into has room around the text',
  // The first cut had 2.4px of padding on a 15px face and the descenders very
  // nearly touched the rule; reported from use. Held to a floor rather than an
  // exact number, so the type scale can still move.
  r.fieldBox?.padTop >= 4.5 && r.fieldBox?.height >= r.fieldBox?.size + 12,
  JSON.stringify(r.fieldBox),
)
check(
  'and NOT DECIDED YET is a state that says so in words',
  Array.isArray(r.undated) && r.undated.includes('no date yet'),
  JSON.stringify(r.undated),
)

check('and each further one joins it rather than replacing it', r.rowsAtEnd === 3, `rows=${r.rowsAtEnd}`)

// ── 3. recurrence, anchored ─────────────────────────────────────────────────
check(
  'a recurrence reads back in WORDS, like the run-up beside it',
  Array.isArray(r.recurrence) && r.recurrence.includes('every 90 days from 2026-10-01'),
  JSON.stringify(r.recurrence),
)
// The round-trip form on disk is checked against the file itself, below.

// ── 4. a note, and a run-up beside it ───────────────────────────────────────
check('a note is offered on every matter', r.noteOffered === true && r.noteField === true,
  `offered=${r.noteOffered} field=${r.noteField}`)
check(
  'two sentences go in as two lines, because Enter writes the second one',
  Array.isArray(r.note) && r.note.length === 2 && String(r.note[1]).includes('480'),
  JSON.stringify(r.note),
)
check(
  'THE POINT: and it is SHOWN, not hidden behind a click',
  r.noteShownWithoutAsking === true,
  'the quote from the plumber is what the conversation needs in front of both people',
)
check(
  'a run-up reads as something a person says out loud',
  Array.isArray(r.runup) && r.runup.includes('2 weeks before'),
  JSON.stringify(r.runup),
)
check(
  'and a note and a run-up under one matter do not eat each other',
  r.bothUnderOne?.note === 1 && r.bothUnderOne?.runups === 1,
  JSON.stringify(r.bothUnderOne),
)

// ── 5. sections ─────────────────────────────────────────────────────────────
console.log('\n— dividing it up —')
check('adding a section is offered beside adding a matter', r.sectionOffered === true)
check(
  'and the ones added are the ones shown, in the order given',
  Array.isArray(r.sections) && r.sections.join(' | ') === 'Periodic maintenance | Major projects',
  JSON.stringify(r.sections),
)
check(
  'an empty section says what it is rather than looking broken',
  r.emptySaidSo >= 1,
  `empty notices: ${r.emptySaidSo}`,
)
check(
  'the move control says what it DOES, not where the row already is',
  r.whereOffered === true && r.whereSays === 'move to…',
  `offered=${r.whereOffered} reads=${JSON.stringify(r.whereSays)}`,
)
check(
  'THE POINT: matters gather under the heading they were put under',
  JSON.stringify(r.grouped) === JSON.stringify([
    { name: '', matters: ['The oven is broken'] },
    { name: 'Periodic maintenance', matters: ['Service the boiler', 'Change the air filters'] },
    { name: 'Major projects', matters: [] },
  ]),
  JSON.stringify(r.grouped),
)
check('and a moved matter brings its note with it', r.keptItsNote === 2, `lines=${r.keptItsNote}`)
check('and its run-up', r.keptItsRunUp === 1, `run-ups=${r.keptItsRunUp}`)
check('every row carries a grip to move it by', r.gripOffered === true)
check(
  'visible without hovering, because the report was not knowing rows MOVE',
  r.gripSeen?.shown === true && r.gripSeen?.faint === true,
  JSON.stringify(r.gripSeen),
)
check(
  'and it is DRAWN, after a font substituted two dots for six',
  r.gripSeen?.drawn === true && r.gripSeen?.width >= 8 && r.gripSeen?.height >= 12,
  JSON.stringify(r.gripSeen),
)
check(
  'THE ONE THAT WAS BROKEN: pressing the grip actually lifts the row',
  // Reported twice from use: the cursor changed and nothing happened. It was
  // HTML5 drag-and-drop — first on a `<button>`, which is not a drag source at
  // all, then on a span the engine still would not lift. No check here could
  // see it, because exercising that gesture from a scene means dispatching
  // `dragstart` by hand, which asserts the handlers and skips the only open
  // question. The gesture is pointer events now, so THIS is the real thing: a
  // pointerdown went down on the grip and a row came up.
  r['lifted:1:air filters'] === 1,
  `rows lifted by a press: ${r['lifted:1:air filters']}`,
)
check(
  'THE POINT: dragging one onto the top half of another lands it above',
  JSON.stringify(r.dragged) === JSON.stringify([
    ['The oven is broken'], ['Change the air filters', 'Service the boiler'], [],
  ]),
  JSON.stringify(r.dragged),
)
check(
  'and onto the bottom half lands it below — one gesture, either direction',
  JSON.stringify(r.draggedBack) === JSON.stringify([
    ['The oven is broken'], ['Service the boiler', 'Change the air filters'], [],
  ]),
  JSON.stringify(r.draggedBack),
)
check(
  'INTO A SECTION by dragging onto its heading, which is the hard-to-find one',
  JSON.stringify(r.draggedIntoSection) === JSON.stringify([
    { name: '', matters: [] },
    {
      name: 'Periodic maintenance',
      matters: ['Service the boiler', 'Change the air filters', 'The oven is broken'],
    },
    { name: 'Major projects', matters: [] },
  ]),
  JSON.stringify(r.draggedIntoSection),
)
check('the grip takes keyboard focus', r.gripTakesFocus === true)
check(
  'and ↑ on a focused grip still moves it, which is what the arrows were for',
  JSON.stringify(r.byKeyboard) === JSON.stringify([
    [], ['Service the boiler', 'The oven is broken', 'Change the air filters'], [],
  ]),
  JSON.stringify(r.byKeyboard),
)
check(
  'UNGROUPING KEEPS EVERYTHING: the heading goes, the matters stay',
  r.afterUngroup?.sections?.length === 1 && r.afterUngroup?.matters === 3,
  JSON.stringify(r.afterUngroup),
)
check(
  'THE GESTURE: each group has its own add button, at its foot',
  r.addHereOffered === true,
)
check(
  'and it asks nothing about where, because the button already said',
  r.addHereAsksNothing === 0,
  `pickers in the add row: ${r.addHereAsksNothing}`,
)
check(
  'a matter added from a section lands in that section',
  JSON.stringify(r.addedHere) === JSON.stringify([
    { name: '', matters: ['The oven is broken'] },
    {
      name: 'Periodic maintenance',
      matters: ['Change the air filters', 'Service the boiler', 'Bleed the radiators'],
    },
  ]),
  JSON.stringify(r.addedHere),
)
check(
  'and a section is renamed in place, keeping what is in it',
  Array.isArray(r.renamed) && r.renamed.join(' | ') === 'Periodic maintenance',
  JSON.stringify(r.renamed),
)

// ── 6. legibility ───────────────────────────────────────────────────────────
check(
  'the name is set in the notebook reading face at reading size (H3)',
  typeof r.type?.size === 'number' && r.type.size >= 15,
  JSON.stringify(r.type),
)
check('and nothing errored on the way', r.appError === 'none', String(r.appError))

// ── what is on disk ─────────────────────────────────────────────────────────
console.log('\n— the file —')
const dir = join(root, 'dockets')
const files = await readdir(dir).catch(() => [])
check('one docket file, in the one place dockets live', files.length === 1, files.join(', '))
const text = files.length === 1 ? await readFile(join(dir, files[0]), 'utf8') : ''
check('named from the name given', files[0] === 'the-house.docket.md', files[0] ?? 'none')
check('declaring its kind, so it opens as one next time', /^kind: docket$/m.test(text))
check(
  'every matter carrying the four fields that cannot be backfilled',
  (text.match(/<!--tephra:matter [0-9a-z]{8} \d+ 0-->/g) ?? []).length === 4,
  (text.match(/<!--tephra:matter.*-->/g) ?? []).join(' | '),
)
check('the note as prose, bracketed by the machinery rather than interrupting it',
  /^Quoted 480 for the part, plus labour\.$/m.test(text))
check('the run-up as a trigger, ready for MH3 to fire', /^- -2w task: book the boiler service$/m.test(text))
check('the section as an ordinary markdown heading', /^## Periodic maintenance$/m.test(text))
check(
  'with its matters nested under it, so the outline is true markdown',
  /^### Service the boiler$/m.test(text) && /^### Change the air filters$/m.test(text),
  (text.match(/^#{2,6} .*$/gm) ?? []).join(' | '),
)
check(
  'and the ungrouped one promoted back to the top level',
  /^## The oven is broken$/m.test(text),
)
check('no section heading left for the one that was ungrouped', !/Major projects/.test(text))
check(
  'and the recurrence in the round-trip form, which the parser reads back',
  /^when: every 90d from 2026-10-01$/m.test(text),
)

for (const key of Object.keys(r).filter(k => k.startsWith('aiming:') || k.startsWith('said:'))) {
  console.log(`        ${key}: ${JSON.stringify(r[key])}`)
}

console.log(`\nshot: ${shot}`)
console.log(`${spent.map(s => `${s.scene} ${(s.ms / 1000).toFixed(1)}s`).join('  ')}`)
const failed = checks.filter(c => !c.ok)
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`)
if (failed.length > 0) console.log(`\n${text}`)
process.exit(failed.length === 0 ? 0 : 1)
