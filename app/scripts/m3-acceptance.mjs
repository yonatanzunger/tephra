// M3: getting around, and getting out.
//
// M2 asked what you can do to a passage. This asks the navigation questions —
// where you are, how you get somewhere else, and how the material leaves the
// app — and it begins with the one that wears a printing hat: **Cmd+P, which
// for a stream cannot mean "all of it".**
//
// As with m2, every assertion is made against the files on disk or against what
// the running renderer reported seeing.
//
// The claims, one per section:
//   1. Cmd+P asks which days, and produces a PDF of the ones written in

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electron = './node_modules/.bin/electron'

/** Today in the reference zone, the same rule the app files by (D38). */
const DAY = new Date(Date.now() - 8 * 60 * 60_000).toISOString().slice(0, 10)

/**
 * A notebook of consecutive days, newest first in the list.
 *
 * Several days because the thing being tested is a RANGE: one day would pass
 * with the date arithmetic wrong in either direction.
 */
async function week(bodies) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-m3-'))
  for (let back = 0; back < bodies.length; back++) {
    const at = new Date(Date.parse(`${DAY}T12:00:00Z`) - back * 86_400_000)
    const key = at.toISOString().slice(0, 10)
    const [y, m] = key.split('-')
    await mkdir(join(root, 'stream', y, m), { recursive: true })
    await writeFile(join(root, 'stream', y, m, `${key}.md`), `---\ntephra: 1\ndate: ${key}\n---\n\n${bodies[back]}`)
  }
  return root
}

function launch(scene, root, { timeoutMs = 90_000, shotDelay = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      TEPHRA_VERIFY_MODE: '1',
      TEPHRA_VERIFY: scene,
      TEPHRA_ROOT: root,
      TEPHRA_SHOT_DELAY: String(shotDelay),
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

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`)
}

// ── 1. printing the document ────────────────────────────────────────────────
console.log('— printing —')
{
  const root = await week([
    'Today, which is the last day of the range.\n',
    'Yesterday, with a <!--tephra:tag-start Subject-->tagged phrase<!--tephra:tag-end Subject--> in it.\n' +
      '\n<!--tephra:comment-start k3f9-->A sentence somebody remarked on<!--tephra:comment-end k3f9-->.\n' +
      '\n> **Yonatan** 2026-08-25T14:02 <!--tephra:comment k3f9-->\n> Worth checking this.\n',
    '\n\n', // opened, never written in — must not become a page of nothing
    'Three days ago, the earliest thing written.\n',
  ])
  const out = await launch('printdoc', root)
  const r = report(out)
  const pdf = await stat(join(root, '.tephra', 'print.pdf')).catch(() => null)
  const paged = /VERIFY-MAIN pagedPages=(\d+)/.exec(out)?.[1] ?? '0'
  const feet = /footnoteAreas=(\d+)/.exec(out)?.[1] ?? '0'
  const sample = /sample=("(?:[^"\\]|\\.)*")/.exec(out)?.[1] ?? '""'
  // The whole probe line, so a failure here says what paged.js actually did
  // rather than only that it did not do the right thing.
  const probe = /VERIFY-MAIN paged.*/.exec(out)?.[0] ?? 'no probe'

  check('Cmd+P is on the File menu and reaches the renderer', r.menuItemFound === true)
  check('it asks which days rather than printing twenty years', r.dialogShown === true)
  check(
    'the presets are the ones a person would want',
    Array.isArray(r.presets) && r.presets.join('|') === 'Today|Past week|Past month|Everything',
    JSON.stringify(r.presets),
  )
  check(
    'a preset fills both ends of the range',
    Array.isArray(r.range) && r.range.length === 2 && r.range[1] === DAY && r.range[0] < r.range[1],
    `${JSON.stringify(r.range)} count=${r.count}`,
  )
  check(
    'the annotation policy is a question the dialog asks (D50)',
    Array.isArray(r.choices) && r.choices.length === 4 && r.notesChosen === true,
    JSON.stringify(r.choices),
  )
  check(
    'a footnote print is paginated, because a footnote needs a page',
    Number(paged) >= 1,
    `${paged} pages, policy ${r.policyChosen}`,
  )
  check(
    'and the note actually reached the foot of one',
    Number(feet) >= 1 && /Worth checking/.test(sample),
    probe,
  )
  check('a PDF was produced', pdf !== null && pdf.size > 1000, pdf ? `${pdf.size} bytes` : 'no file')
  check('the dialog got out of the way', r.dialogClosed === true)
  check('and nothing errored on the way', r.appError === 'none')
}

// ── 2. the sidebar ──────────────────────────────────────────────────────────
//
// Not "a list appears". The claims are D51's: the sections are built from the
// corpus rather than from the loaded window, and every row has the SAME verb —
// clicking a subject that occurs three times visits three places and comes back
// round to the first.
console.log('\n— the sidebar —')
{
  const TAG = (s, text) => `<!--tephra:tag-start ${s}-->${text}<!--tephra:tag-end ${s}-->`
  const root = await week([
    `Today.\n\n## A heading today\n\nWith ${TAG('Recurring', 'the third mention')} in it.\n`,
    `Yesterday, with ${TAG('Recurring', 'a second mention')} and <!--tephra:mark the-spot-->a bookmark.\n`,
    '\n\n',
    `The earliest day, where ${TAG('Recurring', 'it first came up')} — and ${TAG('Once', 'something else')}.\n`,
  ])
  const r = report(await launch('sidebar', root))

  const sections = Array.isArray(r.sections) ? r.sections.map(s => s.title) : []
  check(
    'the sections are the built-in ones (D51)',
    sections.join('|') === 'Outline|Subjects|Bookmarks|Comments',
    JSON.stringify(r.sections),
  )
  check(
    'subjects come from the whole corpus, not the loaded window',
    Array.isArray(r.subjectRows) && r.subjectRows.length === 2 &&
      r.subjectRows.some(t => t.includes('Recurring') && t.includes('3')),
    JSON.stringify(r.subjectRows),
  )
  check(
    'a bookmark in an earlier day is listed',
    Array.isArray(r.bookmarkRows) && r.bookmarkRows.some(t => t.includes('the-spot')),
    JSON.stringify(r.bookmarkRows),
  )
  check(
    'the outline holds the days, with headings under them',
    Array.isArray(r.outlineRows) && r.outlineRows.some(t => t.includes('A heading today')),
    JSON.stringify(r.outlineRows),
  )
  check(
    'THE ONE VERB: clicking a subject visits each of its places',
    r.distinctPlaces === 3,
    `carets ${JSON.stringify(r.caretsAfterClicks)}`,
  )
  check('and comes back round rather than stopping', r.wrappedAround === true)
  check(
    'the active row says where in the set you are',
    typeof r.counterShown === 'string' && /\d+ of 3/.test(r.counterShown) && r.steppersShown === 2,
    `${r.counterShown} · ${r.steppersShown} steppers`,
  )
  check('and nothing errored on the way', r.appError === 'none')
}

const failed = checks.filter(c => !c.ok)
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length === 0 ? 0 : 1)
