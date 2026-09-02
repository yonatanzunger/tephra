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
import { mkdtemp, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electron = './node_modules/.bin/electron'

/** Today in the reference zone, the same rule the app files by (D38). */
const DAY = new Date(Date.now() - 8 * 60 * 60_000).toISOString().slice(0, 10)

/**
 * A day relative to today, in the reference zone.
 *
 * **Every date a fixture writes has to be relative.** A due date spelled out as
 * `2026-09-14` is a different number of days away tomorrow than it is today, so
 * a suite that hard-codes one passes on the day it was written and fails every
 * day after — which is a suite that cries wolf, and the only reason a green run
 * is worth anything is that it does not.
 */
const dayFrom = days =>
  new Date(Date.parse(`${DAY}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/**
 * A day's label as the sidebar writes it — "26 Aug" — counted back from today.
 *
 * **Derived, never typed.** m2 was fixed once for hard-coded dates and this
 * script repeated the mistake in its first week: two checks named "26 Aug" and
 * "24 Aug", and both went red the next morning. A date written into an
 * assertion is a test that expires overnight.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDay = back => {
  const at = new Date(Date.parse(`${DAY}T12:00:00Z`) - back * 86_400_000)
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`
}

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
    await mkdir(join(root, 'notebook.stream', y, m), { recursive: true })
    await writeFile(join(root, 'notebook.stream', y, m, `${key}.md`), `---\ntephra: 1\ndate: ${key}\n---\n\n${bodies[back]}`)
  }
  return root
}

// **Three minutes, not ninety seconds.** The scenes have grown — the sidebar's
// drives a dozen gestures through real IPC — and the timeout had not, so the
// longest one was the first to fall over whenever the machine had anything else
// to do. A timeout that fires on a slow machine reports a failure that is not
// there, which is worse than a slow suite.
/**
 * How long each scene took, so a suite that has got slow can say where.
 *
 * **A harness that cannot report its own cost gets slower by accident.** These
 * runs are minutes of real Electron and the time is nearly all deliberate
 * waiting; without a number per scene, the only signal is that the whole thing
 * feels slow, which is not enough to act on.
 */
const spent = []

function launch(scene, root, { timeoutMs = 180_000, shotDelay = 30_000 } = {}) {
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
  // Eight days, so the timeline has to leave some out — the limit is part of
  // the design, not an accident of the fixture.
  const root = await week([
    `Today.\n\n## A heading today\n\nWith ${TAG('Recurring', 'the third mention')} in it.\n`,
    `Yesterday, with ${TAG('Recurring', 'a second mention')} and <!--tephra:mark the-spot-->a bookmark.\n`,
    '\n\n',
    `The earliest shown day, where ${TAG('Recurring', 'it first came up')} — and ${TAG('Once', 'something else')}.\n`,
    'Four days ago.\n',
    'Five days ago.\n',
    'Six days ago.\n',
    'Seven days ago, which the timeline has to leave out at first.\n',
  ])
  const r = report(await launch('sidebar', root))

  const sections = Array.isArray(r.sections) ? r.sections.map(s => s.title) : []
  check(
    'the sections are the built-in ones (D51)',
    sections.join('|') === 'Timeline|Subjects|Bookmarks|Comments',
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
    'the timeline holds the days, with headings under the open one',
    Array.isArray(r.timelineRows) && r.timelineRows.some(t => t.includes('A heading today')),
    JSON.stringify(r.timelineRows),
  )
  check(
    'it shows the recent five and offers the rest',
    Array.isArray(r.timelineRows) && r.timelineRows.filter(t => /^\d+ \w{3}/.test(t)).length === 5 &&
      /2 earlier days/.test(String(r.moreLabel)),
    `${JSON.stringify(r.timelineRows)} · ${r.moreLabel}`,
  )
  check(
    'a day nobody wrote in is not a row (D8 files one whenever the app opens)',
    // The blank body is the third day back in the fixture above.
    Array.isArray(r.timelineRows) && !r.timelineRows.some(t => t.startsWith(shortDay(2))),
    `${shortDay(2)} should be absent from ${JSON.stringify(r.timelineRows)}`,
  )
  check('and asking for more gets them', r.rowsAfterMore > r.timelineRows.length, `${r.rowsAfterMore} rows`)
  check(
    'a day collapses without the row losing its verb',
    r.headingsWhileOpen >= 1 && r.headingsWhenCollapsed === 0,
    `${r.headingsWhileOpen} → ${r.headingsWhenCollapsed}`,
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
  check(
    'the scroll track shows where else the set is',
    r.trackMarks === 3 && r.trackCurrent === 1,
    `${r.trackMarks} marks, ${r.trackCurrent} current, at ${JSON.stringify(r.trackTops)}`,
  )
  check(
    'and the marks are at different heights, not stacked at zero',
    Array.isArray(r.trackTops) && new Set(r.trackTops).size === 3,
    JSON.stringify(r.trackTops),
  )
  check(
    'a mark is as tall as the passage it stands for',
    Array.isArray(r.trackHeights) && r.trackHeights.every(h => /^max\(3px, [\d.]+%\)$/.test(String(h))),
    JSON.stringify(r.trackHeights),
  )
  check(
    'and it is drawn in the subject\'s own colour, the one the text is underlined in',
    typeof r.trackColour === 'string' && r.trackColour.startsWith('var(--tag-') &&
      r.trackColour === String(r.tagColourInText),
    `track ${r.trackColour} · text ${r.tagColourInText}`,
  )
  check(
    'the foot of the panel says where the caret is: day, heading, subject',
    String(r.whereDay).startsWith(shortDay(0)) &&
      Array.isArray(r.whereHeadings) && r.whereHeadings.includes('A heading today') &&
      Array.isArray(r.whereTags) && r.whereTags.includes('Recurring'),
    `${r.whereDay} › ${JSON.stringify(r.whereHeadings)} · ${JSON.stringify(r.whereTags)}`,
  )
  check(
    'and filling it moves nothing above it',
    typeof r.rowsMoved === 'number' && r.rowsMoved < 1,
    `rows moved ${r.rowsMoved}px`,
  )
  check(
    'and it empties when the caret is in plain text',
    Array.isArray(r.whereTagsAway) && r.whereTagsAway.length === 0 && r.whereHeadingsAway === 0,
    `${JSON.stringify(r.whereTagsAway)} · ${r.whereHeadingsAway} headings`,
  )
  check('and nothing errored on the way', r.appError === 'none')
}

// ── 3. curated sections ─────────────────────────────────────────────────────
//
// D53's claims, over a real sections/ tree: the top level is a fileset of
// filesets, every entry kind is written the way the format says, an entry that
// resolves to nothing is still an entry, and a pinned row is the SAME row as a
// built-in one.
console.log('\n— curated sections —')
{
  const TAG = (s, text) => `<!--tephra:tag-start ${s}-->${text}<!--tephra:tag-end ${s}-->`
  const root = await week([
    `Today, with ${TAG('Recurring', 'the second mention')} of it.\n`,
    `Yesterday, where ${TAG('Recurring', 'it first came up')}, and <!--tephra:mark the-spot-->a mark.\n`,
  ])
  await mkdir(join(root, 'sections'), { recursive: true })
  await writeFile(
    join(root, 'sections', '_index.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: My sections\n---\n' +
      '- [The house](tephra:section/house) — everything about the move\n' +
      '- [What keeps coming up](tephra:tag/Recurring)\n' +
      '- [A section that went away](tephra:section/gone)\n',
  )
  await writeFile(
    join(root, 'sections', 'house.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n' +
      'What I am tracking about the move.\n\n' +
      '- [That marked spot](tephra:mark/the-spot)\n' +
      '- [The listing](https://example.com/listing) — asking price is optimistic\n',
  )
  const r = report(await launch('sections', root))

  check(
    'each curated section is a section beside the built-ins (D10)',
    Array.isArray(r.sections) &&
      r.sections.slice(0, 2).join('|') === 'The house|A section that went away' &&
      r.sections.slice(2).join('|') === 'Timeline|Subjects|Bookmarks|Comments',
    JSON.stringify(r.sections),
  )
  check(
    'a pin that is not a section is a loose row above them',
    Array.isArray(r.looseRows) && r.looseRows.length === 1 &&
      r.looseRows[0].includes('What keeps coming up'),
    JSON.stringify(r.looseRows),
  )
  check(
    'a section holds its own entries, of every kind the format allows',
    Array.isArray(r.houseRows) && r.houseRows.length === 2 &&
      r.houseRows.some(t => t.includes('That marked spot')) &&
      r.houseRows.some(t => t.includes('The listing')),
    JSON.stringify(r.houseRows),
  )
  check(
    'the summary after the link is shown, and is the words a person wrote (R20)',
    Array.isArray(r.summaries) && r.summaries.includes('everything about the move') &&
      r.summaries.includes('asking price is optimistic'),
    JSON.stringify(r.summaries),
  )
  check(
    'a section whose file is gone keeps the name someone gave it, and says so (D53)',
    r.missingSection === 'not found',
    `${JSON.stringify(r.sections)} · ${r.missingSection}`,
  )
  check(
    'a pinned subject is the same row as a built-in one: same verb, same marks',
    r.caretAfterPinned > 0 && r.marksAfterPinned === 2,
    `caret ${r.caretAfterPinned}, ${r.marksAfterPinned} track marks`,
  )
  check(
    'and a section is a group its own header discloses',
    r.houseHidden === true && r.houseRowsBefore === 2,
    `${r.houseRowsBefore} rows, hidden after: ${r.houseHidden}`,
  )
  check('and nothing errored on the way', r.appError === 'none')
}

// ── 4. pinning ──────────────────────────────────────────────────────────────
//
// The claim D53 makes is that pinning is an ORDINARY EDIT: a line appended to a
// markdown file, and nothing else anywhere. So the test is the round trip —
// press the control, read the file on disk, and find the row back in the panel
// having come from that file.
console.log('\n— pinning —')
{
  const TAG = (s, text) => `<!--tephra:tag-start ${s}-->${text}<!--tephra:tag-end ${s}-->`
  const root = await week([
    `Today, with ${TAG('Recurring', 'the second mention')}.\n`,
    `Yesterday, where ${TAG('Recurring', 'it first came up')}, and <!--tephra:mark the-spot-->a mark.\n`,
  ])
  // **A notebook with a history, not a fresh one.** The bug this section could
  // not see was that a pin into a notebook that already had a top-level ORDER
  // wrote its file and stayed invisible, because the order never named it.
  await mkdir(join(root, 'sections'), { recursive: true })
  await writeFile(
    join(root, 'sections', '_index.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: Sections\n---\n- [The house](tephra:section/house)\n',
  )
  await writeFile(
    join(root, 'sections', 'house.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n- [The listing](https://example.com/x)\n',
  )
  const pinned = join(root, 'sections', 'pinned.fileset.md')
  const order = join(root, 'sections', '_index.fileset.md')
  const r = report(await launch('pin', root))
  const written = await readFile(pinned, 'utf8').catch(() => '')

  // A SECOND launch over the same notebook: what comes back is what the files
  // hold, which is the whole claim (D53).
  const back = report(await launch('unpin', root))
  const afterUnpin = await readFile(pinned, 'utf8').catch(() => '')

  check(
    'the notebook began with an order that did not mention pinning',
    r.sectionsBefore === 5,
    `${r.sectionsBefore} sections`,
  )
  check('a row offers a pin', r.pinControlFound === true)
  check(
    'THE ROUND TRIP: the pin is a line in a markdown file (D53)',
    /^- \[Recurring\]\(tephra:tag\/Recurring\)$/m.test(written) &&
      /^- \[the-spot\]\(tephra:mark\/the-spot\)$/m.test(written),
    JSON.stringify(written),
  )
  check(
    'and the section it made is named for what it holds, not for its category',
    /^---\ntephra: 1\nkind: fileset\ntitle: Pinned\n---\n/.test(written),
    JSON.stringify(written.slice(0, 60)),
  )
  check(
    'pinning the same thing twice does not double it',
    (written.match(/tephra:tag\/Recurring/g) ?? []).length === 1,
    `${(written.match(/tephra:tag\/Recurring/g) ?? []).length} occurrences`,
  )
  check(
    'and the order gains the new section, so the pin is VISIBLE (D53)',
    /tephra:section\/pinned/.test(await readFile(order, 'utf8').catch(() => '')) &&
      r.sectionsAfter === 6,
    `${r.sectionsAfter} sections; order: ${JSON.stringify(await readFile(order, 'utf8').catch(() => ''))}`,
  )
  check(
    'and a RESTART finds them, because the file is where they live',
    Array.isArray(back.rowsAfterRestart) && back.rowsAfterRestart.length === 2 &&
      back.rowsAfterRestart.some(t => t.includes('Recurring')) &&
      back.rowsAfterRestart.some(t => t.includes('the-spot')),
    JSON.stringify(back.rowsAfterRestart),
  )
  check('a pinned row offers to be unpinned', back.unpinFound === true)
  check(
    'and unpinning takes the line back out of the file',
    Array.isArray(back.rowsAfterUnpin) && back.rowsAfterUnpin.length === 1 &&
      !afterUnpin.includes('the-spot') && afterUnpin.includes('Recurring'),
    `${JSON.stringify(back.rowsAfterUnpin)} · file ${JSON.stringify(afterUnpin)}`,
  )
  check('and nothing errored on the way', r.appError === 'none' && back.appError === 'none')
}

// ── 5. opening a document that is not the stream ────────────────────────────
//
// MC5's claim, and the first thing in this app that has never worked: a sidebar
// row naming a FILE opens that file. Every piece of it was missing at once —
// one hard-coded document handle, a pane that could only express the stream,
// and a `.md` link that came back `unsupported` and was dropped in silence.
console.log('\n— opening another document —')
{
  const root = await week([
    'Today, and nothing else.\n',
    'Yesterday, which is how we know which document we are in.\n',
  ])
  await mkdir(join(root, 'sections'), { recursive: true })
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(
    join(root, 'notes', 'offer.md'),
    '---\ntephra: 1\nkind: markdown\ntitle: The offer letter\n---\n' +
      'What we offered, and what they said back.\n',
  )
  await writeFile(
    join(root, 'sections', '_index.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: My sections\n---\n- [The house](tephra:section/house)\n',
  )
  await writeFile(
    join(root, 'sections', 'house.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n- [The offer letter](../notes/offer.md)\n',
  )
  const r = report(await launch('open-document', root))
  const onDisk = await readFile(join(root, 'notes', 'offer.md'), 'utf8').catch(() => '')

  check('the app opened in the stream', r.titleBefore !== undefined && r.streamText === true, r.titleBefore)
  check('a section names a file, and the row is there', r.fileRowFound === true)
  check(
    'THE LANDING: clicking it opens THAT document (D54)',
    typeof r.textAfter === 'string' &&
      r.textAfter.includes('What we offered') &&
      !r.textAfter.includes('Yesterday'),
    JSON.stringify(r.textAfter),
  )
  check(
    'under the name the document gives itself, not its path',
    r.titleAfter === 'The offer letter',
    JSON.stringify(r.titleAfter),
  )
  check(
    'a note opens at the top, because it is not being appended to',
    r.caretAfter === 0,
    `caret at ${r.caretAfter}`,
  )
  check(
    'and nothing draws day separators through a document with no days',
    r.daySeparators === 0,
    `${r.daySeparators} separators`,
  )
  check(
    'it is an ORDINARY document: typing lands in it and reaches its file',
    typeof r.afterTyping === 'string' && r.afterTyping.includes('Signed on Tuesday'),
    JSON.stringify(r.afterTyping),
  )
  check(
    'and undo takes it back, on that document\'s own stack (D54)',
    typeof r.afterUndo === 'string' && !r.afterUndo.includes('Signed on Tuesday'),
    JSON.stringify(r.afterUndo),
  )
  check(
    'and BOTH reached the file, which is where the document lives (D54)',
    /^---\ntephra: 1\n/.test(onDisk) &&
      /title: The offer letter/.test(onDisk) &&
      onDisk.includes('What we offered') &&
      !onDisk.includes('Signed on Tuesday'),
    JSON.stringify(onDisk),
  )
  check(
    'and BACK returns to the stream we came from',
    r.backInStream === true,
    `${JSON.stringify(r.titleBack)} · ${r.backInStream}`,
  )
  check(
    'a file nobody pinned is listed under its DIRECTORY, and is not missing',
    r.derivedRowFound === true && r.derivedMissing === false,
    `found ${r.derivedRowFound} · missing ${r.derivedMissing}`,
  )
  check(
    'and clicking it opens the file, because it resolves from its directory',
    typeof r.afterDerived === 'string' && r.afterDerived.includes('What we offered'),
    JSON.stringify(r.afterDerived),
  )
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

// ── 6. windows: a session, not a window ─────────────────────────────────────
//
// MC6's claim. A window is a VIEW on a document, so the thing that survives a
// quit is the ARRANGEMENT — someone who left a note open beside the notebook
// left both, and restoring only the last one they touched throws that away.
// Then the other half: two windows on ONE document, each seeing the other's
// edits, because there is one document in main and both are looking at it.
console.log('\n— windows —')
{
  const root = await week([
    'Today, in the notebook.\n',
    'Yesterday, also in the notebook.\n',
  ])
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(
    join(root, 'notes', 'offer.md'),
    '---\ntephra: 1\nkind: markdown\ntitle: The offer letter\n---\nWhat we offered.\n',
  )

  const first = report(await launch('windows', root))
  const saved = JSON.parse(await readFile(join(root, '.tephra', 'ui-state.json'), 'utf8').catch(() => '{}'))
  const back = report(await launch('windows-back', root))
  const onDisk = await readFile(join(root, 'notes', 'offer.md'), 'utf8').catch(() => '')

  check(
    'the Open… list names every document, the notebook first',
    Array.isArray(first.documents) && first.documents[0] === 'Notebook' &&
      first.documents.includes('The offer letter'),
    JSON.stringify(first.documents),
  )
  check('a second window opened on the note', first['w2.name'] === 'The offer letter', String(first['w2.name']))
  check(
    'and it is showing that document, not a second copy of the stream',
    typeof first['w2.text'] === 'string' && first['w2.text'].includes('What we offered'),
    JSON.stringify(first['w2.text']),
  )
  check(
    'the window this one is stayed the notebook, named as a person reads a day',
    typeof first.titleHere === 'string' && /^\d{1,2} [A-Z][a-z]{2}( \d{4})?$/.test(first.titleHere),
    JSON.stringify(first.titleHere),
  )
  check(
    'THE SESSION IS A SET: both windows were written down, in order (MC6)',
    Array.isArray(saved.windows) && saved.windows.length === 2 &&
      saved.windows[0]?.location?.kind === 'today' &&
      saved.windows[1]?.location?.kind === 'document',
    JSON.stringify(saved.windows),
  )
  check(
    'and each remembered where it sat',
    Array.isArray(saved.windows) && saved.windows.every(w => typeof w.bounds?.width === 'number'),
    JSON.stringify(saved.windows?.map(w => w.bounds)),
  )
  check(
    'ACROSS A QUIT: both come back, each where it was',
    typeof back.titleHere === 'string' && /^\d{1,2} [A-Z][a-z]{2}( \d{4})?$/.test(back.titleHere) &&
      back['w2.name'] === 'The offer letter',
    `${JSON.stringify(back.titleHere)} · ${JSON.stringify(back['w2.name'])}`,
  )
  check(
    'the restored window is showing the note, not just named for it',
    typeof back['w2.text'] === 'string' && back['w2.text'].includes('What we offered'),
    JSON.stringify(back['w2.text']),
  )
  check(
    'ONE DOCUMENT, TWO VIEWS: an edit in this window arrives in the other (D45)',
    typeof back['w2.textLater'] === 'string' && back['w2.textLater'].includes('Countersigned'),
    JSON.stringify(back['w2.textLater']),
  )
  check(
    'and it reached the file, once, from whichever window typed it',
    (onDisk.match(/Countersigned/g) ?? []).length === 1,
    JSON.stringify(onDisk),
  )
  check('and nothing errored on the way', first.appError === 'none' && back.appError === 'none',
    `${first.appError} · ${back.appError}`)
}

// ── 7. a file from outside the notebook ─────────────────────────────────────
//
// Downloading something and wanting to read it here is an ordinary thing to
// want. Tephra can read anything; what it cannot do is keep its promises about
// a file it does not manage — no history, no versions, no index — so the window
// says so, and the saying-so is the button that fixes it (MC6).
console.log('\n— a file from outside —')
{
  const root = await week(['Today.\n', 'Yesterday.\n'])
  const elsewhere = await mkdtemp(join(tmpdir(), 'tephra-downloads-'))
  const outside = join(elsewhere, 'spec.md')
  await writeFile(outside, 'A spec I downloaded.\n')

  const r = report(await launch(`readonly|${outside}`, root))
  const original = await readFile(outside, 'utf8')
  const copy = await readFile(join(root, 'notes', 'spec.md'), 'utf8').catch(() => '')

  check(
    'an outside file opens, under its own name',
    r.titleOutside === 'spec',
    JSON.stringify(r.titleOutside),
  )
  check(
    'and shows its text, which is what you came for',
    typeof r.textOutside === 'string' && r.textOutside.includes('A spec I downloaded'),
    JSON.stringify(r.textOutside),
  )
  check(
    'the window says it is read-only, and offers the way out',
    r.badgeShown === 'Read-only · Import',
    JSON.stringify(r.badgeShown),
  )
  check(
    'TYPING DOES NOTHING: refused now, not lost at save time',
    typeof r.afterTyping === 'string' && !r.afterTyping.includes('SHOULD NOT LAND'),
    JSON.stringify(r.afterTyping),
  )
  check(
    'THE BADGE IS THE GESTURE: clicking it brings the file in',
    typeof r.textAfterImport === 'string' && r.textAfterImport.includes('A spec I downloaded'),
    JSON.stringify(r.textAfterImport),
  )
  check(
    'and what is showing now is a document of ours, so the badge is gone',
    r.badgeAfterImport === '(none)',
    JSON.stringify(r.badgeAfterImport),
  )
  check(
    'the copy is writable, because being inside is what that means',
    typeof r.typedIntoCopy === 'string' && r.typedIntoCopy.includes('a note of my own'),
    JSON.stringify(r.typedIntoCopy),
  )
  check(
    'it landed in the notebook as a proper document, saying where it came from',
    /^---\ntephra: 1\n/.test(copy) && /source: /.test(copy) && copy.includes('a note of my own'),
    JSON.stringify(copy),
  )
  check(
    'and the file it came from was not touched',
    original === 'A spec I downloaded.\n',
    JSON.stringify(original),
  )
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

// ── 8. theme management ─────────────────────────────────────────────────────
//
// M3's last visual claim: a theme is editable, all of it, from where a person
// looks for settings. The panel used to be `View \u25b8 Typography\u2026` and could reach
// the type and nothing else \u2014 the palette needed a text editor, and the chrome's
// own ground could not be changed at all, because it was mixed in code.
console.log('\n\u2014 theme management \u2014')
{
  const root = await week(['Today.\n', 'Yesterday.\n'])
  const r = report(await launch('themepanel', root))

  check('Settings\u2026 is in the application menu, on \u2318,', r.clicked === true)
  check('and it opens the theme panel', r.panelOpen === true)
  check(
    'which can reach every colour a theme has, the panel among them',
    Array.isArray(r.colours) &&
      ['Paper', 'Panel', 'Ink', 'Headings', 'Quiet', 'Rules', 'Accent'].every(c =>
        r.colours.includes(c),
      ),
    JSON.stringify(r.colours),
  )
  check(
    'a built-in cannot be deleted, because seeding would bring it back',
    r.deleteDisabled === true,
    String(r.deleteDisabled),
  )
  check(
    'a field on the panel is derived from the PANEL, not borrowed from the page',
    // Not a fixed value: what it lifts TO depends on the theme's panel text,
    // which this fixture leaves at the page's ink. What must never happen is
    // the page's paper behind text mixed for the panel — white on cream.
    typeof r.fieldGround === 'string' &&
      r.fieldGround !== `rgb(${String(r.pageGround).split(' ').join(', ')})`,
    `${JSON.stringify(r.fieldGround)} on a page of ${JSON.stringify(r.pageGround)}`,
  )
  check(
    'THE POINT: changing the panel colour changes the chrome',
    r.panelBefore !== r.panelAfter && r.panelAfter === '18 52 86',
    `${JSON.stringify(r.panelBefore)} \u2192 ${JSON.stringify(r.panelAfter)}`,
  )
}

// ── 9. \u2318-click opens a row in its own window ──────────────────────────────
//
// The same verb with a modifier: a row names a there, and \u2318-click puts that
// there in a window of its own instead of moving the one you are reading in.
// The point is having BOTH, so this window must not follow.
console.log('\n\u2014 \u2318-click \u2014')
{
  const root = await week(['Today.\n', 'Yesterday.\n'])
  await mkdir(join(root, 'sections'), { recursive: true })
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(
    join(root, 'notes', 'offer.md'),
    '---\ntephra: 1\nkind: markdown\ntitle: The offer letter\n---\nWhat we offered.\n',
  )
  await writeFile(
    join(root, 'sections', '_index.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: My sections\n---\n- [The house](tephra:section/house)\n',
  )
  await writeFile(
    join(root, 'sections', 'house.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n- [The offer letter](../notes/offer.md)\n',
  )
  const r = report(await launch('cmdclick', root))

  check('the row is there to click', r.rowFound === true)
  check(
    'THE POINT: \u2318-click opens it in a second window',
    r['w2.name'] === 'The offer letter',
    String(r['w2.name']),
  )
  check(
    'and showing the document, not a second copy of the stream',
    typeof r['w2.text'] === 'string' && r['w2.text'].includes('What we offered'),
    JSON.stringify(r['w2.text']),
  )
  check(
    'while THIS window stays where it was \u2014 the point is having both',
    r.titleAfter === r.titleBefore,
    `${JSON.stringify(r.titleBefore)} \u2192 ${JSON.stringify(r.titleAfter)}`,
  )
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

// ── 10. emphasis ────────────────────────────────────────────────────────────
//
// \u2318B and \u2318I, from the Edit menu where the accelerators live. Emphasis is the
// only command in the set that works from a bare caret, and a toggle rather
// than an insert \u2014 the second press is someone changing their mind.
console.log('\n\u2014 emphasis \u2014')
{
  const root = await week(['Today, so far.\n', 'Yesterday.\n'])
  const r = report(await launch('emphasis', root))

  check('Bold is in the menu, on \u2318B', r.bold1 === true)
  check(
    'from a bare caret it opens the markers',
    typeof r.afterBold === 'string' && r.afterBold.endsWith('****'),
    JSON.stringify(r.afterBold),
  )
  check('and leaves the caret BETWEEN them', r.caretInside === true)
  check(
    'so what you type next is what gets emphasised',
    typeof r.typedInside === 'string' && r.typedInside.endsWith('**loud**'),
    JSON.stringify(r.typedInside),
  )
  check(
    'pressing it again on the same words takes it off, rather than doubling it',
    typeof r.afterUnbold === 'string' && r.afterUnbold.endsWith('loud') &&
      !r.afterUnbold.includes('*'),
    JSON.stringify(r.afterUnbold),
  )
  check(
    'and italic is the same gesture with one marker',
    typeof r.afterItalic === 'string' && r.afterItalic.endsWith('*loud*'),
    JSON.stringify(r.afterItalic),
  )
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

// ── 11. code blocks ─────────────────────────────────────────────────────────
//
// A fenced block is a PLACE with typography of its own \u2014 its own face, leading,
// inset and measure \u2014 and its language is parsed rather than taken as one run of
// monospace. Prose is set to a reading measure; code is written to eighty
// columns, and wrapping it at sixty destroys the one thing its layout carries.
console.log('\n\u2014 code blocks \u2014')
{
  const root = await week(['Prose sits at the reading measure, which is sixty-two characters.\n'])
  const day = DAY
  const [yy, mm] = day.split('-')
  await writeFile(
    join(root, 'notebook.stream', yy, mm, `${day}.md`),
    `---\ntephra: 1\ndate: ${day}\nkind: stream\n---\n\n` +
      'Prose sits at the reading measure, which is sixty-two characters.\n\n' +
      '```python\ndef solve(grid, depth=0):\n    # memoised\n    return grid\n```\n',
  )
  const r = report(await launch('code', root))

  check('the lines of a fence are marked as code', Number(r.codeLines) >= 5, String(r.codeLines))
  check('including the fence rows themselves', r.fenceLines === 2, String(r.fenceLines))
  check(
    'code is set in the code face, prose in the reading face',
    typeof r.codeFace === 'string' && typeof r.proseFace === 'string' &&
      r.codeFace !== r.proseFace && /Mono|mono/.test(r.codeFace),
    `${JSON.stringify(r.codeFace)} vs ${JSON.stringify(r.proseFace)}`,
  )
  check(
    'THE MEASURE: a code block is wider than the prose column',
    Number(r.codeWidth) > Number(r.proseWidth),
    `${r.codeWidth}px vs ${r.proseWidth}px`,
  )
  check(
    'the fence is parsed as PYTHON, not as one run of monospace',
    r.keywordColoured === true && Number(r.distinctColours) >= 2,
    `def coloured: ${r.keywordColoured}, ${r.distinctColours} colours`,
  )
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

// ── 12. bullet lists ────────────────────────────────────────────────────────
//
// A wrapped item hangs under its own TEXT, not under its marker: a second line
// running back to the page margin reads as a new item rather than as the rest
// of this one, which is the shape of a list lost at the point a reader needs
// it. And the marker is drawn as a bullet over the hyphen the file keeps.
console.log('\n\u2014 bullet lists \u2014')
{
  const root = await week(['Placeholder.\n'])
  const day = DAY
  const [yy, mm] = day.split('-')
  await writeFile(
    join(root, 'notebook.stream', yy, mm, `${day}.md`),
    `---\ntephra: 1\ndate: ${day}\nkind: stream\n---\n\n` +
      'Things to fix:\n\n' +
      '- A short one\n' +
      '- A separate font selector for monospace, as well as different size, leading and measure, ' +
      'which is long enough to wrap onto a second line\n',
  )
  const r = report(await launch('lists', root))

  check('the items are marked as list lines', Number(r.listLines) >= 2, String(r.listLines))
  check('and the marker is drawn as a bullet', Number(r.bullets) >= 2, String(r.bullets))
  check(
    'THE HANG: a wrapped line starts where the text does, not at the margin',
    Number(r.secondRowLeft) > 0 && Math.abs(Number(r.secondRowLeft) - Number(r.firstTextLeft)) <= 2,
    `wrapped row at ${r.secondRowLeft}px, text at ${r.firstTextLeft}px`,
  )
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

// ── 13. the file lifecycle ──────────────────────────────────────────────────
//
// Rename, Save a Copy and Delete, from the File menu. The one that matters is
// rename: a fileset links by relative path, so renaming without rewriting those
// links leaves every section naming the document pointing at nothing. This is
// D13's "update references" step, which was present and empty from M2 until the
// sections it needed existed.
console.log('\n\u2014 the file lifecycle \u2014')
{
  const root = await week(['Today.\n'])
  await mkdir(join(root, 'notes'), { recursive: true })
  await mkdir(join(root, 'sections'), { recursive: true })
  await writeFile(
    join(root, 'notes', 'offer.md'),
    '---\ntephra: 1\nkind: markdown\n---\nWhat we offered.\n',
  )
  await writeFile(
    join(root, 'sections', '_index.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: My sections\n---\n- [The house](tephra:section/house)\n',
  )
  await writeFile(
    join(root, 'sections', 'house.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n- [The offer](../notes/offer.md) \u2014 worth keeping\n',
  )
  const r = report(await launch('lifecycle', root))
  const section = await readFile(join(root, 'sections', 'house.fileset.md'), 'utf8').catch(() => '')

  check('a document opens from the sidebar', r.opened === 'offer', JSON.stringify(r.opened))
  check('Rename\u2026 is offered, prefilled with the name it has', r.renamePrefilled === 'offer',
    JSON.stringify(r.renamePrefilled))
  check(
    'renaming moves the window to the document under its new name',
    r.titleAfterRename === 'counter-offer',
    JSON.stringify(r.titleAfterRename),
  )
  check(
    'THE POINT: the section that named it points at the new name',
    /\.\.\/notes\/counter-offer\.md/.test(section) && !/notes\/offer\.md/.test(section),
    JSON.stringify(section),
  )
  check('and keeps the label and summary somebody wrote', /The offer/.test(section) && /worth keeping/.test(section))
  check(
    'Save a Copy leaves you in the document you were working in',
    r.titleAfterCopy === 'counter-offer',
    JSON.stringify(r.titleAfterCopy),
  )
  check(
    // The copy, and only the copy: the original is deleted further down this
    // same scene, so asserting it survives would be asserting against the test
    // that follows.
    'the copy is a second file of its own',
    existsSync(join(root, 'notes', 'second-thoughts.md')),
  )
  check('Delete asks first, and says what will happen', r.confirmShown === true)
  check(
    'and afterwards the file is gone and the window is back in the notebook',
    !existsSync(join(root, 'notes', 'counter-offer.md')) &&
      /^\d{1,2} [A-Z][a-z]{2}( \d{4})?$/.test(String(r.titleAfterDelete)),
    `${existsSync(join(root, 'notes', 'counter-offer.md'))} \u00b7 ${JSON.stringify(r.titleAfterDelete)}`,
  )
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

// ── 14. the same acts, from the list ────────────────────────────────────────
//
// The sidebar is where a person is already looking at their documents, so the
// lifecycle has to be reachable there and not only from the menu bar. What is
// its own here is the distinction the panel has to make and the menu bar never
// does: a row can be a LINE somebody wrote, or the bare fact that a document is
// in a directory. They look identical and only one of them can be relabelled.
console.log('\n\u2014 the sidebar\'s own gestures \u2014')
{
  const root = await week(['Today.\n'])
  await mkdir(join(root, 'notes'), { recursive: true })
  await mkdir(join(root, 'sections'), { recursive: true })
  await writeFile(
    join(root, 'notes', 'offer.md'),
    '---\ntephra: 1\nkind: markdown\n---\nWhat we offered.\n',
  )
  // In the same directory and named by nobody: the derived half of a listing.
  await writeFile(
    join(root, 'notes', 'loose-note.md'),
    '---\ntephra: 1\nkind: markdown\n---\nDropped in by hand.\n',
  )
  await writeFile(
    join(root, 'sections', 'house.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n- [The offer](../notes/offer.md) \u2014 worth keeping\n',
  )
  const r = report(await launch('sidebar', root))
  const section = await readFile(join(root, 'sections', 'house.fileset.md'), 'utf8').catch(() => '')
  const items = (list) => (Array.isArray(list) ? list.join(' \u00b7 ') : String(list))

  check(
    'a listed row offers the label and the file as separate things',
    Array.isArray(r.curatedMenu) &&
      r.curatedMenu.includes('Edit Label') &&
      r.curatedMenu.includes('Rename File\u2026') &&
      r.curatedMenu.includes('Remove from Section'),
    items(r.curatedMenu),
  )
  check('the name is typed in the row, not in a dialog', r.editingInPlace === true)
  check('and the row takes the new label', r.rowAfterRelabel === true)
  check(
    'THE POINT: renaming the FILE leaves the label alone',
    r.rowKeptItsLabel === true && /Their first number/.test(section),
    JSON.stringify(section),
  )
  check(
    // FIRST, not last: a new file is pinned after it further down this scene,
    // so what this is watching for is the renamed entry having been cut and
    // re-appended — which would put it below the one made afterwards.
    'and the entry keeps its place in the list rather than moving to the end',
    (section.split('\n').find(line => line.startsWith('- ')) ?? '').includes('counter-offer'),
    JSON.stringify(section.split('\n').find(line => line.startsWith('- ')) ?? ''),
  )
  check(
    'a derived row has no label to edit, so it renames the file itself',
    Array.isArray(r.derivedMenu) &&
      r.derivedMenu.includes('Rename') &&
      !r.derivedMenu.includes('Edit Label') &&
      !r.derivedMenu.includes('Remove from Section'),
    items(r.derivedMenu),
  )
  check(
    'and that is a real rename on disk',
    r.rowAfterRename === true &&
      existsSync(join(root, 'notes', 'tidied-note.md')) &&
      !existsSync(join(root, 'notes', 'loose-note.md')),
  )
  check(
    'a new file lands in the section it was asked for from',
    /Survey report/.test(section) && r.titleAfterNew === 'Survey report',
    `${JSON.stringify(r.titleAfterNew)} \u00b7 ${JSON.stringify(section)}`,
  )
  check('deleting from a row asks first', r.confirmShown === true)
  check(
    'and afterwards the file is gone while the entry naming it stays, dangling',
    !existsSync(join(root, 'notes', 'counter-offer.md')) && /Their first number/.test(section),
  )
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))

  // The field replaces the row's text and must occupy exactly its box. A list
  // that shifts when a name goes from being read to being typed is a list you
  // have to find your place in again — the reflow this project has ruled out
  // everywhere else (D42).
  const fresh = await week(['Today.\n'])
  await mkdir(join(fresh, 'sections'), { recursive: true })
  await mkdir(join(fresh, 'notes'), { recursive: true })
  await writeFile(
    join(fresh, 'notes', 'offer.md'),
    '---\ntephra: 1\nkind: markdown\n---\nWhat we offered.\n',
  )
  await writeFile(
    join(fresh, 'sections', 'house.fileset.md'),
    '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n- [The offer](../notes/offer.md) \u2014 worth keeping\n',
  )
  const e = report(await launch('rowmenu|edit', fresh))
  check(
    'the field sits exactly where the row\'s name did',
    e.rowTop === e.fieldTop && e.rowHeight === e.fieldHeight && e.rowHeight > 0,
    `top ${e.rowTop}/${e.fieldTop} \u00b7 height ${e.rowHeight}/${e.fieldHeight}`,
  )
}

// ── 15. the task list ───────────────────────────────────────────────────────
//
// The first thing in Tephra shown as something other than running text, and the
// interaction that dominates every other thing a list is asked: read it, check
// something off, add to it. What is being tested beyond the drawing is that the
// list a person sees IS the carried working set — the day is materialised by
// opening it, not by a ritual that can be skipped (D55).
console.log('\n\u2014 the task list \u2014')
{
  const root = await week(['Today.\n'])
  await mkdir(join(root, 'notes'), { recursive: true })
  const [ty, tm] = dayFrom(-1).split('-')
  await mkdir(join(root, 'tasks.todo', ty, tm), { recursive: true })
  await writeFile(join(root, 'notes', 'covenants.md'), '---\ntephra: 1\nkind: markdown\n---\nThe covenants.\n')
  // Yesterday's list, with one of each thing that has to survive the carry or
  // deliberately not survive it.
  await writeFile(
    join(root, 'tasks.todo', ty, tm, `${dayFrom(-1)}.md`),
    `---\ntephra: 1\ndate: ${dayFrom(-1)}\nkind: todo\n---\n` +
      `- [ ] call the surveyor #house DUE ${dayFrom(2)} <!--tephra:item aaaaaaaa 1756600000 1756600000-->\n` +
      '- [/] read the survey <!--tephra:item bbbbbbbb 1756600000 1756600000-->\n' +
      '- [?] get the deeds #house \u2014 waiting on the solicitor <!--tephra:item cccccccc 1756600000 1756600000-->\n' +
      '- [x] ring the estate agent <!--tephra:item dddddddd 1756600000 1756600000-->\n' +
      `- [ ] file the return DUE ${dayFrom(-4)} <!--tephra:item ffffffff 1756600000 1756600000-->\n` +
      '- [ ] read [the covenants](../notes/covenants.md) again #term <!--tephra:item eeeeeeee 1756600000 1756600000-->\n',
  )

  const r = report(await launch('todo', root))
  const carried = Array.isArray(r.carried) ? r.carried : []
  const [ny, nm] = DAY.split('-')
  const today = await readFile(join(root, 'tasks.todo', ny, nm, `${DAY}.md`), 'utf8').catch(() => '')
  const yesterday = await readFile(join(root, 'tasks.todo', ty, tm, `${dayFrom(-1)}.md`), 'utf8')

  check('the list opens under its own name', r.title === 'tasks', JSON.stringify(r.title))
  check(
    'THE CARRY: today is what was still yours yesterday',
    carried.length === 5 && !carried.some(t => t.includes('estate agent')),
    JSON.stringify(carried),
  )
  check(
    'and yesterday is untouched, because it is the record of yesterday',
    /ring the estate agent/.test(yesterday) && yesterday.split('\n').filter(l => l.startsWith('- ')).length === 6,
  )
  check(
    'a blocked item keeps the reason somebody wrote',
    carried.some(t => t.includes('waiting on the solicitor')),
    JSON.stringify(carried),
  )
  check('tags are lifted out of the prose and shown as their own thing', Array.isArray(r.tags) && r.tags.length === 3, JSON.stringify(r.tags))
  check('links in an item are live', Array.isArray(r.links) && r.links[0] === 'the covenants', JSON.stringify(r.links))
  check(
    'the due-soon band surfaces what is close, most urgent first (T9)',
    // Relative, not literal: what is being tested is the ORDER — overdue
    // first — and a literal reads differently every morning.
    Array.isArray(r.band) && r.band.length === 2 &&
      / ago$/.test(String(r.band[0])) && !/ ago$/.test(String(r.band[1])),
    JSON.stringify(r.band),
  )

  check(
    'a click ADVANCES the status rather than jumping to done',
    r.afterOneClick === 'doing' && r.afterTwoClicks === 'done',
    `${r.afterOneClick} \u2192 ${r.afterTwoClicks}`,
  )
  check(
    'THE MARK STAYS: the finished row is where it was, greyed',
    Array.isArray(r.afterCheck) && r.afterCheck[0] === carried[0] &&
      Array.isArray(r.finished) && r.finished[0] === true && r.finished[1] === false,
    `${JSON.stringify(r.afterCheck?.[0])} \u00b7 ${JSON.stringify(r.finished)}`,
  )
  check(
    'and the three that are not part of the daily rhythm are a right-click away',
    Array.isArray(r.statusMenu) && r.statusMenu.length === 7 &&
      r.statusMenu.includes('Blocked\u2026') && r.afterBacklog === 'backlog',
    `${JSON.stringify(r.statusMenu)} \u00b7 ${r.afterBacklog}`,
  )
  check(
    // THE POINT of T6: the live set is dramatically smaller than every tag ever
    // used, and it is what makes completion useful rather than a list of
    // everything. By this point in the scene `#house` is on one item that is
    // done and one that is backlogged, so it is not offered — while `#term`,
    // on an item still live, is.
    'completion offers the tags that have LIVE items, and only those (T6)',
    Array.isArray(r.completions) && r.completions.includes('term') && !r.completions.includes('house'),
    JSON.stringify(r.completions),
  )
  check(
    'THE ASSISTANT IS NOT A SECOND INPUT PATH: the date button writes what typing would',
    // `resolveDue` is the same function the file is written through, so
    // pressing `tomorrow` and typing `DUE TOMORROW` leave the same characters
    // behind — one notation, reached two ways (T16).
    typeof r.afterDateButton === 'string' && r.afterDateButton.endsWith(`DUE ${dayFrom(1)}`),
    JSON.stringify(r.afterDateButton),
  )
  check('and it is done in the file, on today', /- \[x\] call the surveyor/.test(today), JSON.stringify(today))

  check(
    'a row is edited as the line it is, markers included (T16)',
    r.editingRaw === 'read the survey',
    JSON.stringify(r.editingRaw),
  )
  check(
    'and the edit commits once, tags and date together (D56)',
    Array.isArray(r.afterEdit) && r.afterEdit[1] === 'read the survey properly' &&
      Array.isArray(r.afterEditTags) && r.afterEditTags.length === 4,
    `${JSON.stringify(r.afterEdit?.[1])} \u00b7 ${JSON.stringify(r.afterEditTags)}`,
  )
  check(
    'adding lands at the end, in creation order, and never re-sorts',
    Array.isArray(r.afterAdd) && r.afterAdd[r.afterAdd.length - 1] === 'ring the bank',
    JSON.stringify(r.afterAdd),
  )
  check(
    'the file is the file it appears to be: a markdown task list',
    /^- \[.\] .* <!--tephra:item [0-9a-z]{8} \d+ \d+-->$/m.test(today),
    JSON.stringify(today.split('\n').find(l => l.startsWith('- '))),
  )
  check(
    "and the task list's days are not mistaken for the notebook's",
    // `parseDayFile` answers for every directory document (D59), so without a
    // root check the sidebar showed today twice — once per document with a
    // file for it. Caught by looking at a screenshot.
    r.appError === 'none' && !/todo/.test(String(r.title)),
  )
  check(
    'typing anywhere on the list starts an item',
    // A list is a thing you add to; the keyboard should not have to be told
    // that first, or the thought gets carried in the head instead (T13).
    r.typedToAdd === 'q',
    JSON.stringify(r.typedToAdd),
  )
  check(
    'and the add row IS a row — same height, same mark, same left edge',
    typeof r.addRow === 'object' && r.addRow !== null &&
      r.addRow.rowH === r.addRow.addH && r.addRow.rowMark === r.addRow.addMark,
    JSON.stringify(r.addRow),
  )
  check(
    'the due-soon rail is beside the list rather than above it (D42)',
    // A band that comes and goes as dates do moves every row under it. In the
    // gutter it grows into space that belongs to nobody.
    r.railRight === true,
  )
  check(
    'completion is a keyboard\'s: arrows move, Tab takes, Escape dismisses',
    typeof r.picked === 'string' && r.picked !== '' &&
      Array.isArray(r.completions) && r.completions.includes(r.picked) &&
      r.escapeHidesTheList === true && r.escapeKeptTheLine === true &&
      String(r.afterTab).endsWith(`#${r.picked}`),
    `picked ${JSON.stringify(r.picked)} \u00b7 hid ${r.escapeHidesTheList} \u00b7 kept ${r.escapeKeptTheLine} \u00b7 tab ${JSON.stringify(r.afterTab)}`,
  )
  check(
    'an item can be deleted outright, for a line that was never a task',
    r.menuHasDelete === true &&
      Array.isArray(r.afterDelete) && !r.afterDelete.includes('ring the bank'),
    JSON.stringify(r.afterDelete),
  )
  check(
    // T2 says items are never destroyed, only restatused, and this does not
    // break it: what is cut is the line from the day the item is LIVE in, and
    // every earlier day keeps its copy, because those days are the record of
    // what those days looked like.
    'and deleting cuts today\'s line, never the record of an earlier day',
    !/ring the bank/.test(today) && /ring the estate agent/.test(yesterday),
  )
  check(
    'the words sit a shade below the middle of the row, which is where they read as centred',
    typeof r.rhythm === 'object' && r.rhythm !== null &&
      r.rhythm.above > r.rhythm.below && r.rhythm.above - r.rhythm.below <= 5,
    JSON.stringify(r.rhythm),
  )
  check(
    // A line box is symmetric about the em box and a line of type is not: its
    // ink sits in the x-height band, well above the middle, because descenders
    // reach further down than the letters they hang from. So a mark centred on
    // the line box reads as low, and this one is on the cap line instead.
    'and the status mark is on the words rather than on the line box',
    typeof r.rhythm === 'object' && r.rhythm !== null &&
      r.rhythm.markAbove < r.rhythm.above && r.rhythm.above - r.rhythm.markAbove <= 5,
    JSON.stringify(r.rhythm),
  )
  check(
    'an item with no words is still an item, and says so',
    r.emptyShown === true,
  )
  check(
    'and the WHOLE ROW is what you click to give it some',
    // The text was a button, so an empty one collapsed to nothing and there was
    // no way back into the line short of editing the file.
    r.emptyEditable === true && r.afterNaming === true,
    `editable ${r.emptyEditable} \u00b7 named ${r.afterNaming}`,
  )
  check(
    'the status is DRAWN rather than typed into a box',
    r.marksDrawn === carried.length,
    `${r.marksDrawn} of ${carried.length}`,
  )
  check(
    'and the list is set in the notebook\'s own type, not a second set of numbers',
    typeof r.type === 'object' && r.type !== null && r.type.list === '20px' &&
      /Tephra|Lora|serif/i.test(String(r.type.listFace)),
    JSON.stringify(r.type),
  )
  check('nothing errored on the way', r.appError === 'none', String(r.appError))

  // **\u23181 opens a window of its own**, and leaves the one you were writing
  // in alone. A person works with the list beside their prose rather than
  // instead of it, which is why this is main's action and not a navigation.
  // Its OWN notebook: the scene above leaves a saved session with a task-list
  // window in it, and restoring that would make the todo window the FIRST one —
  // which is the window a scene runs in.
  const alone = await week(['Today.\n'])
  const w = report(await launch('todo-window', alone))
  check('\u23181 opens the list without taking the window you were in', w.thisWindowStayed === true && w.stillShowingProse === true,
    `${JSON.stringify(w.clicked)} \u00b7 stayed ${w.thisWindowStayed} \u00b7 prose ${w.stillShowingProse}`)
  check(
    // Both accelerators mean the same thing — "there should be a window with
    // this in it, in front" — and neither leaves a drift of identical windows
    // behind. \u23180 used to navigate the current one instead, which was an
    // accident of which was built first.
    'and \u23180 is the same act, not a navigation',
    w.again === true && w.notebookAgain === true && w.stillProse === true,
    `again ${w.again} \u00b7 notebook ${w.notebookAgain} \u00b7 prose ${w.stillProse}`,
  )
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
