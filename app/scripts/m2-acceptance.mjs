// M2: a range becomes something you can act on.
//
// M0 asked whether the app could write a file and find it again; M1 asked
// whether anything could be lost. This asks what the milestone actually claims:
// **that selecting a passage and doing something to it works, in the running
// app, and lands correctly in the file.**
//
// It exists because `npm test` could not have caught this milestone's worst
// three bugs. A segment cache race, growth handing the editor raw bytes, and a
// span mislabelled by a fallthrough default were all invisible to the unit and
// integration suites and all obvious the moment a real window was open. Every
// assertion here is made against the files on disk or against what the running
// renderer reported seeing.
//
// The claims, one per section:
//   1. tagging is reversible to the byte, and overlapping tags land exactly
//   2. a comment's body reaches the file and never the buffer
//   3. branching moves the text and leaves a link that resolves
//   4. importing keeps the original and annotates a copy
//   5. printing produces a real PDF from the selection
//   6. deleting a mark removes what it stood for
//   7. the geometry agrees with itself: a point maps back to its position,
//      and the append position is on screen when the app has settled

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electron = './node_modules/.bin/electron'

/**
 * Today, in the reference zone — the same rule the app files by (D38).
 *
 * **Not a hard-coded date.** The first version pinned one, and the acceptance
 * began failing the moment the clock passed midnight: the app opened a day the
 * harness had never seeded, the import landed there, and the checks read
 * yesterday's file and found nothing. A test that only passes on the day it was
 * written is a test that will be deleted rather than debugged.
 */
const DAY = new Date(Date.now() - 8 * 60 * 60_000).toISOString().slice(0, 10)
const [YEAR, MONTH] = DAY.split('-')
const dayPath = root => join(root, 'notebook.stream', YEAR, MONTH, `${DAY}.md`)

/** A fresh notebook holding one day, so scenes cannot contaminate each other. */
async function notebook(body) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-m2-'))
  await mkdir(join(root, 'notebook.stream', YEAR, MONTH), { recursive: true })
  await writeFile(dayPath(root), `---\ndate: ${DAY}\n---\n\n${body}`)
  return root
}

/**
 * Several days, so there is a day seam — and therefore a block widget — in the
 * buffer. Every bug in the geometry family lived under one.
 */
async function week(bodies) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-m2-'))
  const days = bodies.length
  for (let back = 0; back < days; back++) {
    const at = new Date(Date.parse(`${DAY}T12:00:00Z`) - back * 86_400_000)
    const key = at.toISOString().slice(0, 10)
    const [y, m] = key.split('-')
    await mkdir(join(root, 'notebook.stream', y, m), { recursive: true })
    await writeFile(join(root, 'notebook.stream', y, m, `${key}.md`), `---\ndate: ${key}\n---\n\n${bodies[back]}`)
  }
  return root
}

/**
 * How long each scene took, so a suite that has got slow can say where.
 *
 * **A harness that cannot report its own cost gets slower by accident.** These
 * runs are minutes of real Electron and the time is nearly all deliberate
 * waiting; without a number per scene, the only signal is that the whole thing
 * feels slow, which is not enough to act on.
 */
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

// ── 1. tagging ──────────────────────────────────────────────────────────────
console.log('— tagging —')
{
  const body =
    '**Intrinsic S** is a property of the participant, not of any\nrelationship. ' +
    'This distinguishes the mechanism from the hold-up\nproblem of Klein, Crawford and Alchian.\n'
  const root = await notebook(body)
  const before = await readFile(dayPath(root), 'utf8')
  const r = report(await launch('tag', root))

  check('a subject was applied through the menu', r.tagged === true)
  check('and the span carries it', Array.isArray(r.tagNames) && r.tagNames[0] === 'House Deal')
  check(
    'the mark renders, and the syntax does not',
    r.marks === 1 && r.rules >= 1 && r.rawSyntaxVisible === false,
    `marks=${r.marks} rules=${r.rules} raw=${r.rawSyntaxVisible}`,
  )
  check('bold beside a marker survives', r.boldSurvives === true)
  check('untagging restores the file byte for byte', (await readFile(dayPath(root), 'utf8')) === before)
}

{
  const root = await notebook(
    'Every market participant has a finite shock limit S(t): the largest sudden\nloss it can absorb.\n',
  )
  const r = report(await launch('twotags', root))
  const file = await readFile(dayPath(root), 'utf8')
  check('two overlapping subjects both applied', r.firstTagged === true && r.secondTagged === true)
  // The reported bug: the second selection was made against a buffer that now
  // carried a handle, so its markers landed a marker's width early.
  check(
    'and each covers exactly what was selected',
    /tag-start Foo-->participant has a <!--tephra:tag-start Bar-->finite<!--tephra:tag-end Foo--> shock limit<!--tephra:tag-end Bar-->/.test(
      file,
    ),
    file.split('\n')[4]?.slice(0, 150) ?? '',
  )
}

// ── 2. comments ─────────────────────────────────────────────────────────────
console.log('\n— comments —')
{
  const root = await notebook(
    'Define the shock limit as the largest sudden loss a participant can absorb,\n' +
      'given time to respond, without incurring subsequent costs far exceeding what\n' +
      'a well-capitalised participant would pay to smooth the same loss.\n\n' +
      'The benchmark is deliberately loose.\n',
  )
  const r = report(await launch('comment', root))
  const file = await readFile(dayPath(root), 'utf8')

  check('the note opened in the margin, with no dialog', r.promptShown === false && r.composerOpen === true)
  check('a thread reached the file', /<!--tephra:comment-start /.test(file) && /^> \*\*/m.test(file))
  check('the reply is in the same thread', (file.match(/<!--tephra:comment [a-z0-9]+-->/g) ?? []).length === 2)
  check('the body never reached the buffer', r.bodyInBuffer === false && r.rawInBuffer === false)
  check('the margin drew it, anchored', r.notesInMargin === 1 && r.markInText === 1 && r.ruleUnderRange === 1)
  check('reacting does not move the controls', r.actionsStayedPut === true)
}

// ── 3. branching ────────────────────────────────────────────────────────────
console.log('\n— branching —')
{
  const root = await notebook(
    'A thought to keep in place.\n\nA longer argument, worth its own file because it has outgrown\n' +
      'the day it was written on.\n\nA closing thought.\n',
  )
  const r = report(await launch('branch', root))
  const day = await readFile(dayPath(root), 'utf8')
  const note = await readFile(join(root, 'notes', 'titration-curves.md'), 'utf8').catch(() => '')

  check('the text moved to its own file', /worth its own file/.test(note))
  check('with a title and no date (D27)', /title: Titration curves/.test(note) && !/^date:/m.test(note))
  check('the day keeps a link where the text was', /\[Titration curves\]\(\.\.\/\.\.\/\.\.\/notes\//.test(day))
  check('the text is gone from the day — moved, not copied', !/worth its own file/.test(day))
  check('and the link renders as its words', r.linkRendered === 1)
}

// ── 4. importing ────────────────────────────────────────────────────────────
console.log('\n— importing —')
{
  const root = await notebook('Today I was reading about contract theory.\n')
  const r = report(await launch('import', root))
  const day = await readFile(dayPath(root), 'utf8')

  check('something arrived from the clipboard', typeof r.inBuffer === 'string' && r.inBuffer.length > 0)
  check('with a provenance line', /\*Imported \d{4}-\d{2}-\d{2} from \[the clipboard\]/.test(day))
  check(
    'the original was kept',
    new RegExp(`attachments/${YEAR}/${MONTH}/${DAY}-clipboard-[0-9a-f]{6}\\.(txt|html)`).test(day),
  )
  check('and the link renders', r.linkRendered >= 1)
}

// ── 5. printing ─────────────────────────────────────────────────────────────
console.log('\n— printing —')
{
  const root = await notebook(
    'Some earlier prose that is not being printed.\n\n## The Shock Limit\n\n' +
      'Define **S(t)** as the largest sudden loss, given $\\tau$ to respond.\n\n' +
      '| regime | absorbs |\n|---|---|\n| thin | little |\n',
  )
  const r = report(await launch('print', root, { shotDelay: 20_000 }))
  const pdf = await stat(join(root, '.tephra', 'print.pdf')).catch(() => null)

  check('the selection began after the concealed hashes', r.selectionStartsAt === 'The Sh')
  check('a PDF was produced', pdf !== null && pdf.size > 1000, pdf ? `${pdf.size} bytes` : 'no file')
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

// ── 6. removing a mark ──────────────────────────────────────────────────────
console.log('\n— removing —')
{
  const root = await notebook(
    'Every market <!--tephra:tag-start Foo-->participant has a finite<!--tephra:tag-end Foo--> shock limit.\n',
  )
  const r = report(await launch('unmark', root))
  const file = await readFile(dayPath(root), 'utf8')

  check('the mark was there to delete', r.handleFound >= 0 && r.handlesBefore === 1)
  check('deleting it removed the whole tag', r.tagSpansAfter === 0 && !/tephra:tag/.test(file))
  check('and what it drew went with it', r.extentsAfter === 0 && r.handlesAfter === 0)
  check('the prose is untouched', /Every market participant has a finite shock limit\./.test(file))
}

// ── 7. geometry ─────────────────────────────────────────────────────────────
//
// Not a feature — a property. Three bugs in this milestone were a screen point
// resolving to a position a line away from the one it was drawn at, and each
// was found by hand, in the running app, after it had shipped a bad selection.
// Both halves are asserted here so the fourth is found by the harness.
console.log('\n— geometry —')
{
  const filler = n =>
    Array.from({ length: 12 }, (_, i) => `Paragraph ${i} of day ${n}, long enough to wrap at any sane measure and then some.`).join('\n\n')
  const root = await week([
    `Today, at the end.\n\n${filler(0)}\n`,
    `A day called yesterday.\n\n${filler(1)}\n`,
    `And <!--tephra:tag-start Foo-->one with a mark<!--tephra:tag-end Foo--> in it.\n\n${filler(2)}\n`,
  ])
  const r = report(await launch('geometry', root, { timeoutMs: 90_000, shotDelay: 30_000 }))

  check('more than one day is loaded, so there is a seam', r.daysLoaded >= 2, `days=${r.daysLoaded}`)
  check('enough positions were measurable to mean anything', r.probed >= 100, `probed=${r.probed}`)
  check(
    'every point maps back to the position it was drawn at',
    r.roundTripWorst === 0,
    `worst=${r.roundTripWorst} ${JSON.stringify(r.roundTripFailures ?? [])}`,
  )
  check('and the append position is on screen', r.caretVisible === true && r.caretAtEnd === true,
    `visible=${r.caretVisible} atEnd=${r.caretAtEnd}`)
  check('with an earlier day above it', r.earlierDayAbove === true)
}

if (process.env.TEPHRA_TIMING !== undefined) {
  const total = spent.reduce((n, one) => n + one.ms, 0)
  console.log(`\n\u2014 where the time went: ${(total / 1000).toFixed(1)}s across ${spent.length} launches \u2014`)
  for (const one of [...spent].sort((a, b) => b.ms - a.ms)) {
    console.log(`  ${String((one.ms / 1000).toFixed(1)).padStart(6)}s  ${one.scene}`)
  }
}

const failed = checks.filter(c => !c.ok)
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length === 0 ? 0 : 1)
