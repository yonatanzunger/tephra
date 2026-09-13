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
/** What the window will show for *today*, which is what activation writes. */
const TODAY = DAY
/**
 * And two weeks out, which is what activation writes for a matter that has a
 * fortnight's run-up: *activate* means **the earliest step is due now**, not
 * *the start date is today*. Those differ exactly when a step runs backward.
 */
const IN_A_FORTNIGHT = new Date(Date.parse(`${DAY}T12:00:00Z`) + 14 * 86_400_000)
  .toISOString().slice(0, 10)
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
const said = await launch('docket', root, { shot })
const r = report(said)
// **A scene that did not finish is not a scene that passed.** `appError` is the
// last thing every scene says, so its absence means the window stopped early and
// every check below is measuring nothing.
if (r.appError === undefined) {
  console.log(' FAIL  the scene ran to the end\n        no appError line: it threw or timed out partway')
  // **Say what came back instead.** *Nothing was reported* is not a diagnosis,
  // and the window's own output is the only evidence there is.
  console.log(said.trim() === '' ? '        (the window said nothing at all)' : said)
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
check(
  'THE FOUR SHAPES: adding a matter begins by asking what sort of thing it is',
  // Two axes — once against repeatedly, and *you do it* against *it happens to
  // you* — and the second is what makes a talk and a repair feel unalike while
  // being structurally identical.
  JSON.stringify(r.shapesOffered) === JSON.stringify([
    'One-off task', 'Recurring task', 'One-off event', 'Recurring event',
  ]),
  JSON.stringify(r.shapesOffered),
)
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
  'a step reads as something a person says out loud',
  Array.isArray(r.runup) && r.runup.includes('2 weeks before'),
  JSON.stringify(r.runup),
)
check(
  'and a note and a step under one matter do not eat each other',
  // Four: the step its shape seeded, plus the three the scene adds.
  r.bothUnderOne?.note === 1 && r.bothUnderOne?.runups >= 1,
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
  'THE MODE LEADS on an existing matter too, with the same four words',
  // The row used to show an interval and a radio group and leave somebody to
  // work out that together they meant *this comes round after I do it*.
  JSON.stringify(r.modesOnRow) === JSON.stringify([
    'One-off task', 'Recurring task', 'One-off event', 'Recurring event',
  ]),
  JSON.stringify(r.modesOnRow),
)
check(
  'and the schedule asks its questions together, behind the sentence',
  // Mode, date and interval were three controls on the resting row; the column
  // already read as a sentence encoding all three, so it became the way in.
  r.scheduleAsksTogether?.mode === true && r.scheduleAsksTogether?.when >= 1,
  JSON.stringify(r.scheduleAsksTogether),
)
check(
  'and no menu duplicates the drag, which did the same thing better',
  // *move to…* was the loudest mark on a row otherwise made of quiet ones,
  // for a gesture the grip already covers.
  r.noMoveMenu === true,
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
check('and its steps', r.keptItsRunUp >= 1, `steps=${r.keptItsRunUp}`)
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
  'and it asks what SORT of thing it is, never which section',
  // The section came from the button that was pressed; the shape is the one
  // question left, and it is the one that cannot be inferred.
  r.addHereAsksNothing === 1,
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

// ── 6. steps, chained, and activation (MH3a) ────────────────────────────────
console.log('\n— a docket that produces work —')
check(
  'a matter with no date is INACTIVE, and says so',
  r.backlogged === 'no date yet',
  JSON.stringify(r.backlogged),
)
check(
  'THE ONE BUTTON: an inactive matter offers to be started',
  r.activateOffered === 'activate',
  JSON.stringify(r.activateOffered),
)
check(
  'THE SILENT KEY: a blank schedule with Enter adds the step, at T+0',
  // It returned silently on an empty `when`, so Enter did nothing and said
  // nothing — reported from use as a broken key rather than a missing field.
  Array.isArray(r.firstStep)
    && r.firstStep.some(one => one.what === 'find a suitable shop' && one.when === 'right away'),
  JSON.stringify(r.firstStep),
)
check(
  'THE SEQUENCE: a successful add opens the next step, cleared and focused',
  // Work comes in sequences, so typing one should not cost the whole gesture
  // per step. What made this confusing the first time was the exit being
  // called *done*, which reads as *cancel* beside an *add*.
  r.rowWaitsForTheNext?.open === true
    && r.rowWaitsForTheNext?.cleared === ''
    && JSON.stringify(r.rowWaitsForTheNext?.exit) === '["add","cancel"]',
  JSON.stringify(r.rowWaitsForTheNext),
)
check('and Escape is the way out of it', r.escapeClosesIt === true)
check(
  'a step at T+0 reads as *right away*, which is the backlog default',
  // By name: a matter is born with the step its shape seeded, so this one is
  // not alone in the list any more.
  Array.isArray(r.firstStep)
    && r.firstStep.some(one => one.what === 'find a suitable shop' && one.when === 'right away'),
  JSON.stringify(r.firstStep),
)
check(
  'THE CHAIN: a dependent step names the step it waits on, not its id',
  Array.isArray(r.chained)
    && r.chained.some(one =>
      one.what === 'have the car fixed' && /^after #\d+$/.test(String(one.when))),
  JSON.stringify(r.chained),
)
check(
  'AN UNREADABLE SCHEDULE KEEPS THE TYPING, and says what is wrong',
  // Reported from use as *it just seems to drop the item*: the row closed
  // before the verb came back, so a bad `when` took the words out with it.
  r.badWhenKeptTheWords?.open === true
    && r.badWhenKeptTheWords?.text === 'a step that must survive'
    && /not a schedule/.test(String(r.badWhenKeptTheWords?.said)),
  JSON.stringify(r.badWhenKeptTheWords),
)
check(
  'and the complaint names the forms that ARE readable',
  /right away/.test(String(r.badWhenKeptTheWords?.said)),
  String(r.badWhenKeptTheWords?.said),
)
check(
  'correcting it in place then adds the step',
  Array.isArray(r.thenCorrected)
    && r.thenCorrected.some(one => one.what === 'a step that must survive'),
  JSON.stringify(r.thenCorrected),
)
check(
  'THE INDEX IS SHOWN, since `after 1` refers to it',
  Array.isArray(r.indicesShown)
    && r.indicesShown.length > 0
    && r.indicesShown.every((one, at) => one === String(at + 1)),
  JSON.stringify(r.indicesShown),
)
check(
  'THEN resolves to the step above it, and reads back by its number',
  Array.isArray(r.afterThen) && r.afterThen.some(one => /^after #\d+$/.test(String(one))),
  JSON.stringify(r.afterThen),
)
check(
  'and AFTER 1 resolves to the first step, by the number on the screen',
  Array.isArray(r.afterIndex)
    && r.afterIndex.some(one => /^after #\d+ · and this waits on the first$/.test(String(one))),
  JSON.stringify(r.afterIndex),
)
check(
  'the control that adds a step reads as an action, not as a count',
  // It said `1 step`, which is information — and information already on the
  // screen, since the steps are listed right below it.
  r.stepAddReads === '+ step',
  JSON.stringify(r.stepAddReads),
)
check(
  'a step is one of TWO kinds now, the third having become the matter\'s own',
  JSON.stringify(r.kindOffered) === JSON.stringify(['Do a task', 'Raise a reminder']),
  JSON.stringify(r.kindOffered),
)
check(
  'A RECURRING TASK says in the column that it runs from being done',
  r.keepUp?.when === 'every 90 days after it is done',
  JSON.stringify(r.keepUp),
)
check(
  'and its recurrence is the matter\'s two fields, not a step of machinery',
  r.keepUp?.steps === 1,
  JSON.stringify(r.keepUp),
)
check(
  'and one step is marked as the one that starts the next instance (Qa)',
  r.keepUp?.clock === 1,
  JSON.stringify(r.keepUp),
)
check(
  'the caret starts in *what*, the field that always needs typing',
  /docket-field wide/.test(String(r.caretStartsInWhat)),
  String(r.caretStartsInWhat),
)
check(
  'THE TYPO: a step\'s text is clickable, not a label',
  r.stepTextIsClickable === 'BUTTON',
  String(r.stepTextIsClickable),
)
check(
  'and correcting it changes the words in place',
  Array.isArray(r.typoFixed) && r.typoFixed.includes('a step that did survive'),
  JSON.stringify(r.typoFixed),
)
const stepNamed = (steps, what) =>
  (Array.isArray(steps) ? steps : []).find(one => one.what === what)

check(
  'THE STEPS FOLD AWAY, so a one-step matter can be one line',
  // Every matter is born with a step — explicitly, so that nothing downstream
  // has to infer one — and shown, that step reads as an echo of the matter's
  // own name.
  r.folded === true && r.unfolded === true,
  `folded=${r.folded} unfolded=${r.unfolded}`,
)
check(
  'and the disclosure is big enough to read as a direction',
  // It was a 9px glyph, smaller than the number beside it: *I can barely see
  // it, much less tell what it is.* Drawn now, at a size this asserts.
  r.markSize?.across >= 6 && r.markSize?.along >= 8,
  JSON.stringify(r.markSize),
)
check(
  'NO TICK ON A DOCKET: completion is kept, and set from the task list',
  // A docket describes work; the task list is where work is done. The state has
  // to exist — a dependency reads it and suspending preserves it — but setting
  // it from the description was a control on the wrong surface.
  stepNamed(r.ticked, 'find a suitable shop')?.done === true,
  JSON.stringify(r.ticked),
)
check(
  'and the surface offers no way to set it',
  r.noTickOffered === true,
)
check(
  'AN OPEN DOCKET HEARS a write it did not make',
  // It redrew only after its own verbs, so another window — or generation at
  // midnight — would change the file underneath and leave it showing
  // yesterday's answer with nothing to say so. Recorded as a known gap in D76
  // and fixed before generation, which is what would have hit it.
  r.surfaceHeard === true,
  String(r.surfaceHeard),
)
check(
  'ACTIVATING dates it so the EARLIEST step is due now, and offers the inverse',
  // This matter has a `-2w` step by now, so the honest answer is a fortnight
  // out: starting a fortnight's run-up today is what activating it means.
  r.activated?.when === IN_A_FORTNIGHT && r.activated?.offers === 'suspend',
  `${JSON.stringify(r.activated)} — expected ${IN_A_FORTNIGHT}, today is ${TODAY}`,
)
check(
  'and SUSPENDING clears the date while keeping what was done',
  r.suspended?.when === 'no date yet'
    && stepNamed(r.suspended?.steps, 'find a suitable shop')?.done === true,
  JSON.stringify(r.suspended),
)

check(
  'the schedule field asks one word, and nothing sits between the two boxes',
  r.rowAsks?.when === null || r.rowAsks?.when === 'when',
  JSON.stringify(r.rowAsks),
)

// ── 7. reconciliation (MH3a, MH3b) ──────────────────────────────────────────
console.log('\n— a docket that produces work, and keeps it in step —')
check(
  // **Asked of the list, not of what a pass returned.** Activating a matter now
  // reconciles as part of the act (MH4), so by the time anything calls the pass
  // explicitly the work is done and it reports nothing — correctly. What this
  // claim was ever about is whether the step is on the list.
  'THE POINT OF THE PHASE: a started matter puts its step on the task list',
  Array.isArray(r.onTheList) && r.onTheList.length === 1,
  `on the list: ${JSON.stringify(r.onTheList)}`,
)
check(
  'and running again makes nothing, which is what stops a month away from',
  'yielding thirty of them'.length > 0 && r.generatedAgain === 0,
  `second pass made ${r.generatedAgain}`,
)
check(
  'and takes nothing away either, a settled notebook being a quiet one',
  r.withdrewNothing === 0,
  `second pass withdrew ${r.withdrewNothing}`,
)
check(
  'IT WITHDRAWS: suspending clears the date, and the pass takes the task back',
  Array.isArray(r.afterSuspend) && r.afterSuspend.length === 0,
  `left on the list: ${JSON.stringify(r.afterSuspend)}`,
)
check(
  'and starting it again produces one afresh — not none, and not two',
  Array.isArray(r.afreshOnList) && r.afreshOnList.length === 1,
  `on the list: ${JSON.stringify(r.afreshOnList)}`,
)

// ── 8. legibility ───────────────────────────────────────────────────────────
check(
  'EVERY CLASS THE SURFACE STYLES has a rule to style it',
  // A wholesale rewrite of one CSS region silently took four rules with it.
  // One was caught by eye; the others were controls that look passable at
  // browser defaults, which is exactly what makes them easy to miss.
  Array.isArray(r.styled) && r.styled.length === 0,
  `no rule written for: ${JSON.stringify(r.styled)}`,
)
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
  (text.match(/<!--tephra:matter [0-9a-z]{8} \d+ 0-->/g) ?? []).length === 6,
  (text.match(/<!--tephra:matter.*-->/g) ?? []).join(' | '),
)
check('the note as prose, bracketed by the machinery rather than interrupting it',
  /^Quoted 480 for the part, plus labour\.$/m.test(text))
check(
  'the step on disk, with the id that `after` can point at',
  /^- -2w task: book the boiler service <!--tephra:step [0-9a-z]{8}-->$/m.test(text),
  (text.match(/^- .*$/gm) ?? []).join(' | '),
)
check(
  'and the chain, by id, with the finished one stamped',
  /^- \+0d task: find a suitable shop <!--tephra:step ([0-9a-z]{8}) \d+-->$/m.test(text)
    && /^- after [0-9a-z]{8} task: have the car fixed <!--tephra:step [0-9a-z]{8}-->$/m.test(text),
  (text.match(/^- .*$/gm) ?? []).join(' | '),
)
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
  'and the recurrence as the three fields it now is (D76, amended)',
  /^start: 2026-10-01$/m.test(text) && /^every: 90d$/m.test(text),
  (text.match(/^(start|every|after):.*$/gm) ?? []).join(' | '),
)
check(
  'a matter that keeps its own time names the step that advances it',
  /^after: [0-9a-z]{8}$/m.test(text),
  (text.match(/^after:.*$/gm) ?? []).join(' | '),
)
check(
  'and no machinery step survives anywhere in the file',
  !/reschedule/.test(text),
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
