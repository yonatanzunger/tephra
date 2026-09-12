// MH4: reorientation — the day's selection, and the strip wherever you are.
//
// **What the suites beneath cannot see.** The document tests prove the mark is
// kept on the day and does not carry; none of them can say that the section
// exists, that it is the topmost thing on the list, or — the claim H9 actually
// makes — that choosing an item does not MOVE it. *A selection, never a
// relocation* is a sentence about two places at once, and only a running window
// can be asked whether a row is in both.
//
// The claims, one per section:
//   1. the day's selection is a section, topmost, and its own region
//   2. a chosen item is in BOTH places, which is what "never a relocation" means
//   3. the order is the order you chose, not the order the list is in
//   4. unchoosing takes it back, and the section leaves when it empties

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electron = './node_modules/.bin/electron'
const DAY = new Date(Date.now() - 8 * 60 * 60_000).toISOString().slice(0, 10)
const [YEAR, MONTH] = DAY.split('-')

async function notebook() {
  const root = await mkdtemp(join(tmpdir(), 'tephra-mh4-'))
  await mkdir(join(root, 'notebook.stream', YEAR, MONTH), { recursive: true })
  await writeFile(
    join(root, 'notebook.stream', YEAR, MONTH, `${DAY}.md`),
    `---\ndate: ${DAY}\n---\n\nThe boiler is making that noise again.\n`,
  )
  await mkdir(join(root, 'tasks.todo', YEAR, MONTH), { recursive: true })
  await writeFile(
    join(root, 'tasks.todo', YEAR, MONTH, `${DAY}.md`),
    `---\ntephra: 1\ndate: ${DAY}\nkind: todo\n---\n` +
      '- [ ] ring the bank #admin <!--tephra:item bbbb1111 1756600000 1756600000-->\n' +
      '- [ ] draft the copy #tephra <!--tephra:item bbbb2222 1756600001 1756600001-->\n' +
      '- [ ] post the form #admin <!--tephra:item bbbb3333 1756600002 1756600002-->\n',
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

console.log("— the day's selection —")
const root = await notebook()
const shot = process.env.TEPHRA_MH4_SHOT ?? join(tmpdir(), 'tephra-mh4.png')
const said = await launch('today', root, { shot })
const r = report(said)
if (r.appError === undefined) {
  console.log(' FAIL  the scene ran to the end\n        no appError line: it threw or timed out partway')
  console.log(said.trim() === '' ? '        (the window said nothing at all)' : said)
  process.exit(1)
}

check('nothing is chosen to begin with, and an empty section takes no room',
  r.todayBefore === 0, `sections before: ${r.todayBefore}`)
check('the gesture is on the menu, where deliberate acts live',
  Array.isArray(r.menuSaid) && r.menuSaid.some(one => /^Not today$/.test(one.trim())),
  JSON.stringify(r.menuSaid))
check('THE POINT: choosing gives the day a section of its own',
  r.section === 1 && /Today/.test(r.heading ?? ''), `${r.section} · ${JSON.stringify(r.heading)}`)
check('and it is the TOPMOST thing on the list', r.topmost === true, String(r.topmost))
check(
  'A SELECTION, NEVER A RELOCATION (H9): the rows are in BOTH places',
  // The claim no document test can make. Choosing must not take an item out of
  // the list it lives in — an earlier era's *today* list meant either syncing
  // two lists by hand or losing the tagging.
  Array.isArray(r.inToday) && r.inToday.length === 2
    && Array.isArray(r.wholeList) && r.wholeList.length === 3,
  `today ${JSON.stringify(r.inToday)} · list ${JSON.stringify(r.wholeList)}`,
)
check(
  'and the order is the order you CHOSE, not the order the list is in',
  // Chosen back-to-front on purpose, so the two orders cannot coincide.
  Array.isArray(r.inToday) && /form/.test(r.inToday[0] ?? '') && /bank/.test(r.inToday[1] ?? ''),
  JSON.stringify(r.inToday),
)
check('unchoosing takes it back off, and the section goes with the last one',
  r.todayAfter === 0, `sections after: ${r.todayAfter}`)
check('EVERY CLASS THE SURFACE STYLES has a rule to style it',
  Array.isArray(r.styled) && r.styled.length === 0, `no rule written for: ${JSON.stringify(r.styled)}`)
check('and nothing went wrong', r.appError === 'none', String(r.appError))

// ── the motion itself ───────────────────────────────────────────────────────
console.log('\n— reorient, end to end —')
const e = report(await launch('reorient', await notebook(), { shot: shot.replace('.png', '-flow.png') }))
if (e.appError === undefined) {
  console.log(' FAIL  the reorient scene ran to the end')
  console.log(e === undefined ? '(nothing)' : JSON.stringify(e))
  process.exit(1)
}

check(
  'THERE IS A WAY IN, and it is the walk\u2019s place saying the broader thing',
  e.entrance === 'reorient' && e.offered === 'true',
  `${JSON.stringify(e.entrance)} \u00b7 offered ${e.offered}`,
)
check(
  'AND ONE THAT WORKS FROM ANYWHERE: the menu brings the list forward and begins',
  e.menuItemFound === true && /coming/i.test(e.movement1 ?? ''),
  `menu ${e.menuItemFound} \u00b7 ${JSON.stringify(e.movement1)}`,
)
check(
  'MOVEMENT 1 READS, and asks nothing of the rows yet',
  // The order is the argument (H11): what is coming is context for what is
  // live. A movement that also offered marks would be two questions at once.
  e.noMarksYet?.drop === 0 && e.noMarksYet?.pick === 0,
  JSON.stringify(e.noMarksYet),
)
check(
  'MOVEMENT 2 IS THE WALK, unchanged: drop marks and nothing else',
  /live/i.test(e.movement2 ?? '') && e.walkMarks?.drop > 0 && e.walkMarks?.pick === 0,
  `${JSON.stringify(e.movement2)} \u00b7 ${JSON.stringify(e.walkMarks)}`,
)
check(
  'MOVEMENT 3 CHOOSES, and the drop marks are gone by then',
  // One control per movement. Two at once is a form, and this is not one.
  /today/i.test(e.movement3 ?? '') && e.chooseMarks?.pick > 0 && e.chooseMarks?.drop === 0,
  `${JSON.stringify(e.movement3)} \u00b7 ${JSON.stringify(e.chooseMarks)}`,
)
check(
  'and the finish says what it is about to leave behind',
  Array.isArray(e.doneSays) && e.doneSays.some(one => /Done, 1 for today/.test(one)),
  JSON.stringify(e.doneSays),
)
check(
  'THE PASS LEAVES AN ARTIFACT, which is what separates it from the walk',
  // The walk's product was attention and nothing else. Reorient ends with the
  // day's selection, and it outlives the pass.
  Array.isArray(e.kept) && e.kept.length === 1 && e.movementAfter === 0,
  `kept ${JSON.stringify(e.kept)} \u00b7 bars after ${e.movementAfter}`,
)
check(
  'and the chosen row is still in the list below it (H9)',
  Array.isArray(e.stillBelow) && e.stillBelow.length === 3,
  JSON.stringify(e.stillBelow),
)
check(
  'and the day is marked reviewed, so the offer stops asking',
  e.walkedNow === 'reorient again',
  JSON.stringify(e.walkedNow),
)
check('and nothing went wrong through the whole motion', e.appError === 'none', String(e.appError))

console.log(`\nshot: ${shot}`)
console.log(`${spent.map(s => `${s.scene} ${(s.ms / 1000).toFixed(1)}s`).join('  ')}`)
const failed = checks.filter(c => !c.ok)
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length === 0 ? 0 : 1)
