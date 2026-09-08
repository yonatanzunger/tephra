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
    // Folded into the pill language, and the one exception to its sizing: a
    // preset is a primary control in its own dialog rather than a chip beside a
    // line, so it keeps the dialog's size instead of shrinking to seven tenths
    // of it. `--pill-size` is what that exception is spelled with.
    'a preset is a pill, and the one that keeps its own size',
    typeof r.presetPill === 'object' && r.presetPill !== null &&
      r.presetPill.edge === 'edge' && r.presetPill.round === '999px' && r.presetPill.size >= 12,
    JSON.stringify(r.presetPill),
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
  // **A notebook with documents in it that are not days**, which is what the
  // Timeline had never been tested against and what a real one is full of. The
  // headings are the ones that broke it: hyphens make `dayLabel` produce a
  // month, and `NaN` for the day.
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(
    join(root, 'notes', 'imported.md'),
    '---\ntephra: 1\nkind: markdown\ntitle: An imported post\n---\n' +
      '# AI-driven, market-shaping\n\nBody.\n\n## **Introduction**\n\nMore.\n',
  )
  const r = report(await launch('sidebar', root))

  const sections = Array.isArray(r.sections) ? r.sections.map(s => s.title) : []
  check(
    // The built-ins keep their identity and their order however many directory
    // sections a notebook grows.
    'the sections are the built-in ones (D51), whatever else is there',
    sections.slice(-4).join('|') === 'Timeline|Subjects|Bookmarks|Comments' && sections.includes('Notes'),
    JSON.stringify(r.sections),
  )
  check(
    // **Reported from a screenshot of a real notebook.** After importing a few
    // hundred markdown documents, the Timeline filled with their headings,
    // formatted as dates: `NaN driven, market`, `**Introduction**`. Nothing was
    // wrong with the index — the query was, and the sidebar's `title as
    // DateKey` was what let a heading reach a date formatter at all.
    'THE TIMELINE IS DAYS: a note\'s headings are not in it',
    Array.isArray(r.timelineRows) &&
      !r.timelineRows.some(t => t.includes('NaN') || t.includes('Introduction') || t.includes('market')),
    JSON.stringify(r.timelineRows),
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
  const r = report(await launch('sidebar-acts', root))
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
    // THE POINT of T6, and MT5b moved half of it: the live set is dramatically
    // smaller than every tag ever used and is what makes completion useful, so
    // it comes FIRST — but the full set stays reachable rather than vanishing,
    // so the rest follow, marked. By this point in the scene `#house` is on one
    // item that is done and one that is backlogged, so it is no longer live and
    // has dropped behind `#term`, which is still on a live item.
    'completion leads with the tags that have LIVE items (T6)',
    Array.isArray(r.completions) && r.completions[0] === 'term',
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
    // **Three moments, asserted separately.** This used to tie `picked` to
    // `afterTab` — but they are two different lists: the arrow is pressed
    // against everything matching `#`, and Tab is pressed later against
    // everything matching `#te`. It only ever passed because both lists happened
    // to hold one entry, and MT5b's dormant tags gave the first list a second.
    'completion is a keyboard\'s: arrows move, Tab takes, Escape dismisses',
    typeof r.picked === 'string' && r.picked !== '' &&
      Array.isArray(r.completions) && r.completions.includes(r.picked) &&
      r.escapeHidesTheList === true && r.escapeKeptTheLine === true &&
      r.afterTab === 'read the survey #term',
    `picked ${JSON.stringify(r.picked)} \u00b7 hid ${r.escapeHidesTheList} \u00b7 kept ${r.escapeKeptTheLine} \u00b7 tab ${JSON.stringify(r.afterTab)}`,
  )
  check(
    'completing twice completes once — the caret moves with the tag it wrote',
    r.afterTabTwice === r.afterTab,
    `${JSON.stringify(r.afterTab)} then ${JSON.stringify(r.afterTabTwice)}`,
  )
  check(
    'and the options run down the page, the way the arrows move through them',
    r.listRuns === 'down' || r.listRuns === 'one',
    String(r.listRuns),
  )
  check(
    // Matching is by prefix and a completed word is a prefix of itself, so the
    // list went on offering `term` over a line that already said `#term`.
    'taking a completion CLOSES the list, because the tag is finished',
    r.listAfterTaking === true,
    `still open: ${r.listAfterTaking === false}`,
  )
  check(
    // **Reported from use.** An open list takes Return as "accept the
    // suggestion", so with the list never closing, Return could not commit an
    // item that ended in a tag — at all, from the keyboard.
    'THE BUG: Return reaches the ITEM once the tag has been taken',
    r.secondEnterCommitted === true,
    String(r.secondEnterCommitted),
  )
  check(
    // Which is the gesture somebody actually makes: one Return for the tag,
    // one for the item.
    'and Return twice is the whole of typing a line that ends in a tag',
    r.firstEnterTook === 'paint the shed #term' &&
      r.andClosedTheList === true &&
      r.secondEnterCommitted === true &&
      Array.isArray(r.enterEnterRows) && r.enterEnterRows.includes('paint the shed'),
    `${JSON.stringify(r.firstEnterTook)} \u2192 committed ${r.secondEnterCommitted}`,
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

// ── a link in a task (ML) ───────────────────────
//
// **Reported from use: ⌘K did nothing in a task row.** Putting links into tasks
// is half the reason the link directory exists, and the gesture has to be the
// notebook's gesture. But a row is edited in an `<input>`, and the todo surface
// honestly reports no editor handle (MT3, D54) — so the command reached nothing
// and the menu item was greyed, which meant the accelerator was dead too.
//
// The cure is not to fake an editor. `EditorHandle` is the wrong shape to ask a
// one-line field for; what a range command actually needs is "is anything
// selected" and "put this around it", and `EditorHandle` satisfies that
// structurally — so the command takes whichever target is present and branches
// on nothing.
console.log('\n— a link in a task —')
{
  const root = await week(['Today.\n'])
  const [ty, tm] = dayFrom(-1).split('-')
  await mkdir(join(root, 'tasks.todo', ty, tm), { recursive: true })
  await writeFile(
    join(root, 'tasks.todo', ty, tm, `${dayFrom(-1)}.md`),
    `---\ntephra: 1\ndate: ${dayFrom(-1)}\nkind: todo\n---\n` +
      `- [ ] call the surveyor about the boundary #house DUE ${dayFrom(2)} <!--tephra:item aaaa1111 1756600000 1756600000-->\n` +
      `- [ ] read the survey DUE ${dayFrom(3)} <!--tephra:item aaaa7777 1756600006 1756600006-->\n`,
  )

  const k = report(await launch('todolink', root))
  check('a task row can be edited, and \u2318K reaches it', k.editing === true && k.asked === true,
    `editing ${k.editing} \u00b7 asked ${k.asked}`)
  check(
    // The asking takes the focus, and the row used to commit and unmount on
    // blur — so the answer had nothing left to write into.
    'THE ROW SURVIVES THE QUESTION: a dialog opened from it is not leaving it',
    k.rowSurvived === true,
    String(k.rowSurvived),
  )
  check(
    'and the answer lands as markdown, around the words that were selected',
    typeof k.afterLink === 'string' &&
      k.afterLink.includes('[surveyor](https://example.com/survey)') &&
      !k.afterLink.includes('surveyor about the boundary'),
    JSON.stringify(k.afterLink),
  )
  check(
    // Which is what ML1's shared scanner was built for: a row is a table cell
    // rather than CodeMirror, so a live link in one means finding links in a
    // string.
    'the committed row draws it as a LIVE link',
    Array.isArray(k.links) && k.links.includes('https://example.com/survey'),
    JSON.stringify(k.links),
  )
  check(
    // Reported from a screenshot: the rail showed the raw `[text](https://…)`.
    // It cannot make the link live — a rail row is itself a button that scrolls
    // to the item, and an anchor inside a button is both invalid and a second
    // thing to hit — so it shows what the sentence SAYS and leaves following it
    // to the row.
    'the due-soon rail shows a link\'s words, not its markup',
    k.railText === 'call the surveyor about the boundary' && k.railHasAnchor === false,
    JSON.stringify(k.railText),
  )
  check(
    // The same gesture as the notebook's, three cases and all: the second press
    // is somebody changing their mind, and `****` reads as broken.
    '\u2318B works in a row, and pressing it again takes it off',
    typeof k.afterBold === 'string' &&
      k.afterBold.includes('read the **survey**') &&
      typeof k.afterBoldTwice === 'string' &&
      k.afterBoldTwice.includes('read the survey') &&
      !k.afterBoldTwice.includes('*'),
    `${JSON.stringify(k.afterBold)} then ${JSON.stringify(k.afterBoldTwice)}`,
  )
  check('nothing errored on the way', k.appError === 'none', String(k.appError))
}

// ── notes under an item ─────────────────────
//
// **Prose about the task, not more task.** Indented continuation lines, which
// is markdown's own way of attaching a paragraph to a list item — so the file is
// what it appears to be (R26, D20) and hand-editing is adding a line and
// indenting it. The item's own line stays one line, which is what keeps the
// list scannable.
console.log('\n— notes under an item —')
{
  const root = await week(['Today.\n'])
  const [ny2, nm2] = DAY.split('-')
  await mkdir(join(root, 'tasks.todo', ny2, nm2), { recursive: true })
  await writeFile(
    join(root, 'tasks.todo', ny2, nm2, `${DAY}.md`),
    `---\ntephra: 1\ndate: ${DAY}\nkind: todo\n---\n` +
      '- [ ] call the surveyor #house <!--tephra:item aaaa1111 100 100-->\n' +
      '  Left a message Tuesday.\n' +
      '- [ ] renew the permit <!--tephra:item aaaa2222 100 100-->\n',
  )

  const N = report(await launch('notes', root))
  const file = await readFile(join(root, 'tasks.todo', ny2, nm2, `${DAY}.md`), 'utf8')
  check(
    'an indented line under an item is a NOTE, not an item',
    N.rows === 2 && JSON.stringify(N.shown) === JSON.stringify(['Left a message Tuesday.']),
    `${N.rows} rows \u00b7 ${JSON.stringify(N.shown)}`,
  )
  check(
    'one can be added where you are looking',
    N.opened === true && Array.isArray(N.afterAdding) && N.afterAdding.length === 2,
    JSON.stringify(N.afterAdding),
  )
  check(
    // **THE POINT.** A note is prose about the task, so the item grammar does
    // not apply inside it: the hash is a hash, the date is a date, and neither
    // is a second task.
    'NOTHING in a note is parsed \u2014 not a tag, not a due date, not a status',
    N.rowsAfter === 2 &&
      JSON.stringify(N.tagsAfter) === JSON.stringify(['house']) &&
      JSON.stringify(N.dueAfter) === JSON.stringify([]),
    `${N.rowsAfter} rows \u00b7 tags ${JSON.stringify(N.tagsAfter)} \u00b7 due ${JSON.stringify(N.dueAfter)}`,
  )
  check(
    // The file is what it appears to be: any renderer shows this as part of the
    // item above it, and hand-editing is adding a line and indenting it.
    'and the file holds it as markdown\'s own continuation line',
    /^ {2}Called back/m.test(file) && /^- \[ \] call the surveyor/m.test(file),
    JSON.stringify(file.split('\n').slice(4, 8)),
  )
  check('nothing errored on the way', N.appError === 'none', String(N.appError))
}

// ── print prints what you are looking at ──────────
//
// **Reported from use.** ⌘P asked the stream for its extent whatever was on
// screen, so printing from a note printed the notebook — a command that reads
// as "print this" and did not. Only the stream has days to choose between,
// which is why only the stream is asked which ones.
console.log('\n— print prints what you are looking at —')
{
  const root = await week(['Today, with a note beside it.\n'])
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(
    join(root, 'notes', 'covenants.md'),
    '---\ntephra: 1\nkind: markdown\ntitle: The covenants\n---\n# What they say\n\nA paragraph.\n',
  )

  const P2 = report(await launch('printhere', root))
  const made = await stat(join(root, '.tephra', 'print.pdf')).catch(() => null)
  check('the window is showing the note', P2.showing === 'The covenants', String(P2.showing))
  check(
    // THE BUG: it asked which DAYS, which is a question about the notebook and
    // has no answer for a note.
    'THE POINT: printing a note does not ask which days',
    P2.clicked === true && P2.askedWhichDays === false,
    `reached ${P2.clicked} \u00b7 asked about days ${P2.askedWhichDays}`,
  )
  check('and something reached paper', (made?.size ?? 0) > 0, `${made?.size ?? 0} bytes`)
  check('nothing errored on the way', P2.appError === 'none', String(P2.appError))
}

// ── the list's arrangement is a setting ───────────
//
// **MT4a left it unpersisted on purpose and named where it would go if that
// was wrong**: "where the theme's selection already is, rather than into a
// second place soft state lives." It was wrong — the list window stays open all
// day, so the reset is rare, and a rare surprise is worse than a frequent one
// because you have stopped expecting it.
console.log('\n— the list remembers how it was arranged —')
{
  const root = await week(['Today.\n'])
  const [sy, sm] = DAY.split('-')
  await mkdir(join(root, 'tasks.todo', sy, sm), { recursive: true })
  await writeFile(
    join(root, 'tasks.todo', sy, sm, `${DAY}.md`),
    `---\ntephra: 1\ndate: ${DAY}\nkind: todo\n---\n` +
      '- [ ] fix the gate #house <!--tephra:item aaaa1111 100 100-->\n',
  )

  const S1 = report(await launch('sticky', root))
  check('the list opens by time, and changing that reaches main',
    JSON.stringify(S1.atFirst) === JSON.stringify(['by time']) &&
      JSON.stringify(S1.afterClick) === JSON.stringify(['by tag']) && S1.reported === 'tag',
    `${JSON.stringify(S1.atFirst)} \u2192 ${JSON.stringify(S1.afterClick)} \u00b7 main holds ${JSON.stringify(S1.reported)}`)

  // **The claim is that it OUTLIVES the window**, which only a second launch
  // over the same notebook can show. The session is pointed back at the stream
  // first: a restored window on the task list is the window a scene runs in,
  // and this scene navigates there itself.
  const saved = join(root, '.tephra', 'ui-state.json')
  const state = JSON.parse(await readFile(saved, 'utf8'))
  await writeFile(saved, JSON.stringify({ ...state, windows: [{ location: { kind: 'today' }, cursor: null }] }))

  const S2 = report(await launch('sticky', root))
  check(
    'THE POINT: and it is still that way after a restart',
    JSON.stringify(S2.atFirst) === JSON.stringify(['by tag']) && S2.reported === 'tag',
    `${JSON.stringify(S2.atFirst)} \u00b7 main holds ${JSON.stringify(S2.reported)}`,
  )
  check('nothing errored on the way', S1.appError === 'none' && S2.appError === 'none',
    `${S1.appError} \u00b7 ${S2.appError}`)
}

// ── the pivots and the drawer (MT6) ──────────────
//
// **Three views over one question the corpus can answer and today's list
// cannot**: what became of the items that stopped being carried. MT5b left
// status out of the index deliberately — nobody needed it, because today's
// items answer for themselves — and all three of these needed it, about
// somewhere other than today.
console.log('\n— the pivots and the drawer —')
{
  const root = await week(['Today.\n'])
  const day = (back) => dayFrom(-back)
  const put = async (back, lines) => {
    const [yy, mm] = day(back).split('-')
    await mkdir(join(root, 'tasks.todo', yy, mm), { recursive: true })
    await writeFile(
      join(root, 'tasks.todo', yy, mm, `${day(back)}.md`),
      `---\ntephra: 1\ndate: ${day(back)}\nkind: todo\n---\n${lines.join('\n')}\n`,
    )
  }
  await put(9, [
    '- [x] fix the gate #house <!--tephra:item aaaa1111 100 100-->',
    '- [>] someday, the loft #house <!--tephra:item aaaa2222 100 100-->',
    '- [ ] paint the shed #house <!--tephra:item aaaa3333 100 100-->',
  ])
  await put(4, [
    '- [-] reroof it #house <!--tephra:item aaaa4444 100 100-->',
    '- [ ] paint the shed #house <!--tephra:item aaaa3333 100 100-->',
    '- [>] someday, a pond <!--tephra:item aaaa5555 100 100-->',
  ])
  await put(0, [
    '- [ ] paint the shed #house <!--tephra:item aaaa3333 100 100-->',
    '- [ ] read the survey #tephra <!--tephra:item aaaa6666 100 100-->',
  ])

  const V = report(await launch('mt6', root))
  check(
    // T8's other half. The live half is a regrouping of today and needed
    // nothing built (MT4a); this is the part only the corpus knows.
    'THE RESOLVED TAIL: what was finished under a tag, newest first',
    JSON.stringify(V.tailUnderHouse) === JSON.stringify(['reroof it #house', 'fix the gate #house']),
    JSON.stringify(V.tailUnderHouse),
  )
  check(
    // It is carried, greyed and on screen (T7); showing it underneath as well
    // would be showing it twice. And a live item never appears there at all.
    'and the LIVE item stays where it is, once',
    JSON.stringify(V.liveUnderHouse) === JSON.stringify(['paint the shed']),
    JSON.stringify(V.liveUnderHouse),
  )
  check(
    'the tail is dated in the language of a thing you finished',
    Array.isArray(V.tailWhen) && V.tailWhen.every(w => /ago$/.test(String(w))),
    JSON.stringify(V.tailWhen),
  )
  check(
    // **Counted on the outside** (T14): a backlogged item is not carried
    // forward (D55), so it sits in the day it was put down and nothing else on
    // the page would show it. That is the graveyard the goal warns about, which
    // is why how much you have put down is visible without opening it.
    'THE DRAWER: counted before it is opened, and holding what nothing else shows',
    V.drawerLabel === '\u25b8 Backlog2' &&
      JSON.stringify(V.drawer) === JSON.stringify(['someday, a pond', 'someday, the loft #house']),
    `${JSON.stringify(V.drawerLabel)} \u00b7 ${JSON.stringify(V.drawer)}`,
  )
  check(
    // Nearly free, and this is why: a past working set is not reconstructed, it
    // is a file (D55) \u2014 which is the property flow 7 was said to constrain the
    // format for.
    'SCRUBBING to a past day shows that day, not this one',
    JSON.stringify(V.todayRows) === JSON.stringify(['paint the shed', 'read the survey']) &&
      JSON.stringify(V.pastRows) === JSON.stringify(['reroof it', 'paint the shed', 'someday, a pond']),
    `${JSON.stringify(V.todayRows)} \u2192 ${JSON.stringify(V.pastRows)}`,
  )
  check(
    // Every earlier day is the record of what that day looked like, and editing
    // one would be re-dating through the side door (D9). The verbs are ABSENT
    // rather than refusing: a control that says no is one you learn to distrust.
    'and a day that has gone past is read \u2014 the verbs are gone, not greyed',
    V.readOnly === 'true' && V.noAdd === true && V.noWalk === true && V.markNotAButton === true,
    `read-only ${V.readOnly} \u00b7 no add ${V.noAdd} \u00b7 no walk ${V.noWalk} \u00b7 mark drawn ${V.markNotAButton}`,
  )
  check(
    'and there is one way back to today, which is where you end up',
    typeof V.wayHome === 'string' && V.wayHome.endsWith('back to today') &&
      JSON.stringify(V.backToday) === JSON.stringify(V.todayRows) && V.writableAgain === true,
    `${JSON.stringify(V.wayHome)} \u00b7 writable again ${V.writableAgain}`,
  )
  check('nothing errored on the way', V.appError === 'none', String(V.appError))
}

// ── three the list got wrong ──────────────────
//
// Reported from use in one sitting, and none of them findable except by using
// the thing: a list you cannot scroll needs more items than a fixture has, and
// the other two are about where a caret lands.
console.log('\n— three the list got wrong —')
{
  const root = await week(['Today.\n'])
  const [by2, bm2] = DAY.split('-')
  await mkdir(join(root, 'tasks.todo', by2, bm2), { recursive: true })
  await writeFile(
    join(root, 'tasks.todo', by2, bm2, `${DAY}.md`),
    `---\ntephra: 1\ndate: ${DAY}\nkind: todo\n---\n` +
      '- [ ] fix the gate #house <!--tephra:item aaaa1111 100 100-->\n' +
      '- [ ] paint the shed #house <!--tephra:item aaaa2222 100 100-->\n' +
      '- [ ] read the survey #tephra <!--tephra:item aaaa3333 100 100-->\n',
  )

  const B = report(await launch('listbugs', root))
  check(
    // The field selected everything on open, which is right for a row being
    // edited and for a captured sentence — both are offers, and typing replaces
    // them (MT4). The character you just typed is not an offer.
    'TYPING STARTS AN ITEM, and the second keystroke does not delete the first',
    B.typedOpens === 'b' && B.caretAfter?.start === 1 && B.caretAfter?.end === 1,
    `${JSON.stringify(B.typedOpens)} \u00b7 caret ${JSON.stringify(B.caretAfter)}`,
  )
  check(
    // `.frame-reading` is a flex column that does not scroll — the editor has
    // CodeMirror's own scroller inside it, so nothing had ever asked. A list
    // longer than the window simply could not be reached past the fold.
    'THE LIST SCROLLS, because a surface scrolls itself',
    B.scrolls === 'auto',
    String(B.scrolls),
  )
  check(
    'in the tag view, every group offers to add to itself',
    Array.isArray(B.addHere) && B.addHere.includes('+ Add to house'),
    JSON.stringify(B.addHere),
  )
  check(
    // The tag is already written and the caret is in front of it, so typing
    // produces `buy paint #house` in one gesture — and the row opens INSIDE the
    // group, because a field that appeared at the foot of the page after
    // "add to house" is answering a different question from the one asked.
    'and it opens in the group, tag written, caret in front of it',
    B.prefilled === ' #house' && B.caretBeforeTag?.start === 0 &&
      B.openedInGroup === true && B.notAtFoot === true,
    `${JSON.stringify(B.prefilled)} \u00b7 caret ${JSON.stringify(B.caretBeforeTag)} \u00b7 in group ${B.openedInGroup}`,
  )
  check('nothing errored on the way', B.appError === 'none', String(B.appError))
}

// ── pills say what they are ────────────────────
//
// **Six of these had been invented separately** — at 10.5px, 10.5px, 10.5px,
// 12.5px, 11px and `inherit` — and a system was almost there without anybody
// saying it: a LABEL is a fact about the row and has no edge; a CONTROL does
// something and has one. Every pill followed that except the link directory's
// source, which filters and wore a label's clothes, which is why the reported
// symptom was about colour.
console.log('\n— pills —')
{
  const root = await week(['Read [the paper](https://example.com/a) today.\n'])
  const [py, pm] = DAY.split('-')
  await mkdir(join(root, 'tasks.todo', py, pm), { recursive: true })
  await writeFile(
    join(root, 'tasks.todo', py, pm, `${DAY}.md`),
    `---\ntephra: 1\ndate: ${DAY}\nkind: todo\n---\n` +
      `- [ ] read the survey #house DUE ${dayFrom(2)} <!--tephra:item aaaa1111 100 100-->\n`,
  )

  const P = report(await launch('pills', root))
  const tag = P.todoTag ?? {}
  const source = P.linkSource ?? {}
  check(
    // Nothing to click, so nothing that says you could.
    'a TAG is a label: no edge, and a ground to separate it from the line',
    tag.edge === 'none' && tag.ground !== 'none',
    JSON.stringify(tag),
  )
  check(
    // The one that was wrong. It filters, and it looked like a tag.
    'a SOURCE is a control: an edge, because it does something',
    source.edge === 'edge',
    JSON.stringify(source),
  )
  check(
    // `theme.ts` on code: a ratio, not a size of its own. A pill is subordinate
    // to the line it sits beside — 20px prose and a 15.6px directory row — and
    // an absolute number makes the theme's slider lie about what it controls.
    // Two pills in two panels come out at two sizes, which is the whole claim:
    // neither is a constant, and each is a fraction of the line it sits beside.
    'and both are sized against the line they sit beside, not against the page',
    tag.size !== source.size && tag.size >= 11 && source.size >= 10,
    `tag ${tag.size}px beside 20px prose \u00b7 source ${source.size}px beside a 15.6px row`,
  )
  check(
    // **Reported from use**: they sat in the same row at 14px and 11px, because
    // they were two independent constants — which is what two constants always
    // come to. One variable now, so they cannot drift apart again.
    'a tag and a due date are the same size, because they share one',
    tag.size === (P.todoDue ?? {}).size,
    `tag ${tag.size}px \u00b7 due ${(P.todoDue ?? {}).size}px`,
  )
  check(
    // **Reported from use**: they sat at the top of a 1.72em line box, riding
    // visibly above the words they belong to. Centred on the FIRST line by the
    // same arithmetic the status mark uses — which keeps them on line one when
    // an item wraps to three, the thing `flex-start` was protecting.
    'a tag and a due date sit on the middle of the line, not the top of it',
    typeof P.middles === 'object' && P.middles !== null &&
      Math.abs(P.middles.tag - P.middles.text) <= 2 &&
      Math.abs(P.middles.due - P.middles.text) <= 2,
    JSON.stringify(P.middles),
  )
  check(
    // Quiet is not the same as unreadable: muted grey on a grey tint was two
    // greys deep, which is what was reported.
    'a label\'s ink is the text colour held back, not a second grey',
    typeof tag.ink === 'string' && tag.ink.includes('0.72'),
    String(tag.ink),
  )
  check('nothing errored on the way', P.appError === 'none', String(P.appError))
}

// ── the link directory (ML3, R10a, T10) ────────────
//
// **The first window location that is not a document at all.** `NavTarget`
// already carried a variant commented "a search result", so the shape was
// anticipated; what changes is that a window shows a document *or a query*, and
// the title bar, back/forward, restore and "bring it to the front" all follow
// from that one change rather than from a special case per view. Every filtered
// view after this one inherits it, which is why this is the part M4 pays for
// anyway.
console.log('\n— the link directory —')
{
  const root = await week([
    'A note on [boundary law](https://law.example.org/boundaries) for later.\n',
    'Back to [that paper](https://example.com/survey-methods#part-2) again, and also\n' +
      '[the covenants](../../../notes/covenants.md) which I keep losing.\n',
    'Read [the paper](https://example.com/survey-methods?utm_source=news) this morning.\n',
  ])
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(
    join(root, 'notes', 'covenants.md'),
    '---\ntephra: 1\nkind: markdown\ntitle: The covenants\n---\n' +
      'And [the paper](https://example.com/survey-methods) is cited here.\n',
  )
  // **A link written inside a TASK**, which is where clicking a row produced
  // `ENOTDIR`: a task list is a directory document (D59), so the file is one of
  // its segments and is not an id.
  const [ly, lm] = DAY.split('-')
  await mkdir(join(root, 'tasks.todo', ly, lm), { recursive: true })
  await writeFile(
    join(root, 'tasks.todo', ly, lm, `${DAY}.md`),
    `---\ntephra: 1\ndate: ${DAY}\nkind: todo\n---\n` +
      "- [ ] Review Steve's [bio draft](https://docs.example.com/d/1t8/edit) #career " +
      '<!--tephra:item oqacmjoh 1788311075 1788397350-->\n',
  )

  const L = report(await launch('linkdir', root))
  check(
    // The whole of ML3's structural claim, in one assertion: the window is
    // showing something, it is called something, and it is not an editor.
    'THE POINT: a window can be on a QUERY \u2014 named, and with no document under it',
    L.title === 'Links' && L.noEditor === true,
    `${JSON.stringify(L.title)} \u00b7 no editor: ${L.noEditor}`,
  )
  check('and \u23182 reaches it from the menu', L.clicked === true, String(L.clicked))
  check(
    // Newest first is the order R10a asks for, and the reason no ranking is
    // needed. `the paper` leads because a note cited it most recently.
    'a row per destination, newest first by last appearance',
    JSON.stringify(L.rows) === JSON.stringify(['bio draft', 'the paper', 'boundary law', 'the covenants']) ||
      JSON.stringify(L.rows) === JSON.stringify(['bio draft', 'the covenants', 'the paper', 'boundary law']),
    JSON.stringify(L.rows),
  )
  check(
    // Three spellings — a tracking parameter, a fragment, and neither — written
    // across two days and a note. The canonical form is what joins them, and it
    // is a key that never appears on screen (D60).
    'THE CANONICAL FORM DOES ITS WORK: three spellings are ONE row, in three places',
    Array.isArray(L.places) && L.places.filter(p => String(p) === '\u25b8 3').length === 1,
    JSON.stringify(L.places),
  )
  check(
    // Reported once already, on the due-soon rail: a place that cannot make a
    // link live must show the words rather than the markup.
    'the line it was written in reads as a sentence, not as markup',
    Array.isArray(L.where) && !L.where.some(w => String(w).includes('](')),
    JSON.stringify(L.where),
  )
  check(
    // A column that sorts by one thing and shows another is the inconsistency;
    // a note dates by its file's stamp, in the notebook's zone, computed in
    // main because there is one answer about what day it is (D62, D63).
    'every row says WHEN, and every when is a date',
    Array.isArray(L.whens) && L.whens.every(w => /^\d+ \w{3}/.test(String(w))),
    JSON.stringify(L.whens),
  )
  check(
    'the query box filters, in the client, over what you would remember',
    // Derived, not hardcoded: this has now been broken twice by adding a row
    // to the fixture, which is a fact about the fixture and not about filtering.
    JSON.stringify(L.filtered) === JSON.stringify(['the paper']) &&
      L.filteredCount === `1 of ${L.rows?.length ?? 0}`,
    `${JSON.stringify(L.filtered)} \u00b7 ${L.filteredCount}`,
  )
  check(
    // **The second place per row**, and the question behind the question.
    'clicking where you WROTE it goes there',
    L.wentBack === true && typeof L.titleAfter === 'string' && L.titleAfter !== 'Links',
    `editor ${L.wentBack} \u00b7 now showing ${JSON.stringify(L.titleAfter)}`,
  )
  check(
    // Which is the shape paying for itself: history does not know or care that
    // one of its entries is not a document.
    'and BACK returns to the directory, across a location that is not a document',
    L.canGoBack === true && L.backToLinks === true,
    `can go back: ${L.canGoBack} \u00b7 returned: ${L.backToLinks}`,
  )
  check(
    // **Reported from use.** A label alone is rarely enough to recognise
    // anything — "course", "bio draft", "list" mean what the sentence around
    // them meant — so the line leads and the destination follows.
    'THE SENTENCE LEADS, and it reads as one: no markers, no markup, no bullet',
    Array.isArray(L.where) &&
      L.where.some(w => String(w) === "Review Steve's bio draft #career") &&
      !L.where.some(w => /tephra:item|\]\(|^- \[/.test(String(w))),
    JSON.stringify(L.where),
  )
  check(
    // Among the few things anybody reliably remembers about a link: it was in a
    // task, it was in the publication list.
    'every row says where it came from, and the source is a filter you can click',
    Array.isArray(L.sources) && L.sources.includes('tasks') && L.sources.includes('notebook') &&
      Array.isArray(L.bySource) && L.bySource.length > 0 &&
      L.bySource.every(t => String(t) === 'bio draft'),
    `${JSON.stringify(L.sources)} \u00b7 filtered to ${JSON.stringify(L.bySource)}`,
  )
  check(
    // THE BUG: `tasks.todo/2026/09/2026-09-05.md` is a segment of a directory
    // document, not a document id. Handing the file over as one asked to open a
    // path that is not a path.
    'A LINK WRITTEN IN A TASK OPENS ITS LIST, not a path that is not one',
    L.fromTask === 'tasks' && L.taskError === 'none',
    `${JSON.stringify(L.fromTask)} \u00b7 ${L.taskError}`,
  )
  check(
    // **Asked for from use**, and it is the honest form: a row groups
    // appearances by destination, and each may have been written with different
    // words — so repeating one of them beside the row showed it as if it spoke
    // for all. The link is underlined where it was written instead.
    'THE LINK IS IN THE SENTENCE, live, and not repeated beside it',
    L.liveLinks === L.rows?.length && L.liveLinks > 0,
    `${L.liveLinks} of ${L.rows?.length} rows draw their link inside the line`,
  )
  check('nothing errored on the way', L.appError === 'none', String(L.appError))
}

// ── the tag index (MT5b, T6, D56) ──────────────────
//
// **Narrower than the milestone was planned to be, and this is the half that
// needed an index.** MT3 found the LIVE tag set needs none at all: it is the
// tags on today's items, which are already on screen. But a tag whose last task
// was finished in March is in no list on screen, and T6 asks that the full set
// stay reachable — so the corpus is asked for the whole of it, and *dormant* is
// the subtraction between the two.
console.log('\n— the tag index —')
{
  const root = await week(['Today.\n'])
  const [y, m] = DAY.split('-')
  await mkdir(join(root, 'tasks.todo', '2026', '03'), { recursive: true })
  await mkdir(join(root, 'tasks.todo', y, m), { recursive: true })
  // Finished months ago, so nothing on screen knows these tags exist.
  await writeFile(
    join(root, 'tasks.todo', '2026', '03', '2026-03-01.md'),
    '---\ntephra: 1\ndate: 2026-03-01\nkind: todo\n---\n' +
      '- [x] fix the gate #house <!--tephra:item aaaa1111 100 100-->\n' +
      '- [x] file the return #hmrc <!--tephra:item aaaa2222 100 100-->\n',
  )
  await writeFile(
    join(root, 'tasks.todo', y, m, `${DAY}.md`),
    `---\ntephra: 1\ndate: ${DAY}\nkind: todo\n---\n` +
      '- [ ] read the survey #here <!--tephra:item bbbb1111 100 100-->\n',
  )

  const g = report(await launch('tagindex', root))
  check(
    'the corpus knows every tag ever put on a task, live or not',
    JSON.stringify(g.everyTag) === JSON.stringify(['here', 'hmrc', 'house']),
    JSON.stringify(g.everyTag),
  )
  check(
    // One list in one order, because the arrow keys move through one thing. A
    // second panel of dormant tags would be a second place to look.
    'THE POINT: completion offers the live one FIRST, then the rest',
    JSON.stringify(g.offered) === JSON.stringify(['here', 'hmrc', 'house']) && g.firstIsLive === true,
    `${JSON.stringify(g.offered)} \u00b7 first is live: ${g.firstIsLive}`,
  )
  check(
    // Marked rather than hidden: "the full set stays reachable" is the other
    // half of the requirement whose first half is "offer the live ones".
    'and says which of them have no live task',
    JSON.stringify(g.dormant) === JSON.stringify(['hmrc', 'house']),
    JSON.stringify(g.dormant),
  )
  check(
    'a dormant tag completes exactly as a live one does',
    g.afterTaking === 'a new one #hmrc',
    JSON.stringify(g.afterTaking),
  )
  check('nothing errored on the way', g.appError === 'none', String(g.appError))
}

// ── the walk (MT5a, T11) ──────────────────────────
//
// **The mode in which deleting is cheap.** Era 2's ritual was copying
// yesterday's list by hand and crossing swathes of it out, and deleting there
// never felt like abandonment the way it did mid-afternoon — the frame around
// the act was different. So the pass supplies the frame and adds exactly one
// control: marking done already has one, and it is the glyph, in the place it
// is on every other day.
console.log('\n— the walk —')
{
  const walkbook = async () => {
    const root = await week(['Today.\n'])
    const [ty, tm] = dayFrom(-1).split('-')
    await mkdir(join(root, 'tasks.todo', ty, tm), { recursive: true })
    await writeFile(
      join(root, 'tasks.todo', ty, tm, `${dayFrom(-1)}.md`),
      `---\ntephra: 1\ndate: ${dayFrom(-1)}\nkind: todo\n---\n` +
        '- [ ] call the surveyor #house <!--tephra:item aaaa1111 1756600000 1756600000-->\n' +
        '- [/] draft the copy #tephra <!--tephra:item aaaa2222 1756600001 1756600001-->\n' +
        '- [ ] renew the permit #admin <!--tephra:item aaaa3333 1756600002 1756600002-->\n' +
        '- [ ] think about it <!--tephra:item aaaa5555 1756600004 1756600004-->\n' +
        '- [?] reroof the shed #house \u2014 waiting on the quote <!--tephra:item aaaa6666 1756600005 1756600005-->\n' +
        '- [ ] read the survey #tephra <!--tephra:item aaaa7777 1756600006 1756600006-->\n',
    )
    return root
  }

  const w = report(await launch('walk', await walkbook()))
  check(
    // T11 wants a prominent affordance and not a modal. A tint across the rows
    // that came from yesterday is exactly that: it says what there is to review
    // without asking anything.
    'THE OFFER IS THE LIST LOOKING DIFFERENT: yesterday\'s rows are marked',
    w.carriedRows === 6 && w.allRows === 6 && w.offered === 'true',
    `${w.carriedRows} of ${w.allRows} carried \u00b7 offered ${w.offered}`,
  )
  check(
    // Marking done already has a control and it is the glyph. A control that
    // changed meaning inside a mode would be the surprise this was rearranged
    // to avoid, so the pass adds exactly one button and it is the destructive one.
    'a pass adds ONE control per row, and only inside the pass',
    w.noDropButtons === 0 && w.dropButtons === 6,
    `${w.noDropButtons} before \u00b7 ${w.dropButtons} during`,
  )
  check(
    // The whole reason staging exists: mark a swathe, look at what is about to
    // happen, and only then commit.
    'THE POINT: marking is a SELECTION \u2014 nothing is written until you finish',
    w.staged === 2 && w.nothingWrittenYet === 6,
    `${w.staged} staged \u00b7 ${w.nothingWrittenYet} rows still there`,
  )
  check('and un-marking one puts it back', w.afterKeeping === 1, String(w.afterKeeping))
  check(
    // A walk that drops nothing is the common one and still has to record that
    // you looked \u2014 so this is not "apply", it is "I have looked", which
    // sometimes also deletes. The count is there because the count is the risk.
    'finishing says what it will do, and says it only when there is a risk',
    w.finishSays === 'Finish' && w.finishCounts === 'Finish, dropping 2',
    `${JSON.stringify(w.finishSays)} then ${JSON.stringify(w.finishCounts)}`,
  )
  check(
    'finishing drops what was marked and takes the offer down',
    w.rowsAfterFinish === 5 && w.highlightGone === 0 && w.startSaysAfter === 'walk again',
    `${w.rowsAfterFinish} rows \u00b7 ${w.highlightGone} still marked \u00b7 ${JSON.stringify(w.startSaysAfter)}`,
  )
  check('nothing errored on the way', w.appError === 'none', String(w.appError))

  const c = report(await launch('walk|cancel', await walkbook()))
  check(
    // Nothing to undo: a selection was never a change. And the day is still
    // unreviewed, because you did not say you had looked.
    'cancelling forgets the marks and leaves every item where it was',
    c.rowsAfterCancel === 6 && c.barGone === true && c.stillOffered === 'true',
    `${c.rowsAfterCancel} rows \u00b7 still offered ${c.stillOffered}`,
  )
}

// ── arranging the list by tag (T8's cheap half) ────────────────
//
// **A regrouping of what is on screen, not a query.** Every live item is in the
// day already open, so the pivot needs no index and reaches no other file — and
// what has to be true of it is therefore that it is the SAME list: nothing lost,
// nothing invented, and every verb still working from inside a group.
console.log('\n— arranging the list —')
{
  const root = await week(['Today.\n'])
  const [y, m] = DAY.split('-')
  await mkdir(join(root, 'tasks.todo', y, m), { recursive: true })
  await writeFile(
    join(root, 'tasks.todo', y, m, `${DAY}.md`),
    `---\ntephra: 1\ndate: ${DAY}\nkind: todo\n---\n` +
      `- [ ] call the surveyor #house DUE ${dayFrom(2)} <!--tephra:item aaaa1111 1756600000 1756600000-->\n` +
      // The item that decides the design: two tags, so it is in two places.
      '- [/] draft the copy #tephra #writing <!--tephra:item aaaa2222 1756600000 1756600000-->\n' +
      '- [ ] renew the permit #admin <!--tephra:item aaaa3333 1756600000 1756600000-->\n' +
      '- [x] fix the gate #house <!--tephra:item aaaa4444 1756600000 1756600000-->\n' +
      '- [ ] think about it <!--tephra:item aaaa5555 1756600000 1756600000-->\n' +
      '- [?] reroof the shed #house \u2014 waiting on the quote <!--tephra:item aaaa6666 1756600000 1756600000-->\n' +
      '- [ ] read the survey #tephra <!--tephra:item aaaa7777 1756600000 1756600000-->\n',
  )

  const v = report(await launch('todoview', root))
  const byTime = Array.isArray(v.byTime) ? v.byTime : []
  const byTag = Array.isArray(v.byTag) ? v.byTag : []

  check(
    // Alphabetical because the list's governing promise is that it is a place
    // you know your way around; by size or by recency the headings would move
    // under the reader as items came and went.
    'the groups are the tags, alphabetically, with the untagged ones LAST',
    JSON.stringify(v.headings) === JSON.stringify(['admin', 'house', 'tephra', 'writing', 'Untagged']),
    JSON.stringify(v.headings),
  )
  check('and each says how many it holds', JSON.stringify(v.counts) === JSON.stringify([1, 3, 2, 1, 1]),
    JSON.stringify(v.counts))
  check(
    // "What is outstanding on the house" has to include an item that is also
    // urgent; filing it under whichever tag was typed first answers a question
    // nobody asked. So the rows outnumber the items, on purpose.
    'THE CHOICE: an item with two tags is in both places',
    v.appearsTwice === 2 && byTag.length === byTime.length + 1,
    `${v.appearsTwice} copies \u00b7 ${byTag.length} rows for ${byTime.length} items`,
  )
  check(
    // A heading already said it. The OTHER tag is exactly what the reader wants
    // — it says where else this thing lives.
    'a row does not repeat its group\'s tag, and still shows the others',
    JSON.stringify(v.chipsUnderTephra) === JSON.stringify(['writing']),
    JSON.stringify(v.chipsUnderTephra),
  )
  check(
    'nothing is lost on the way in: every item reaches a group',
    byTime.every(text => byTag.includes(text)),
    `${byTime.filter(t => !byTag.includes(t)).join(', ') || 'all present'}`,
  )
  check(
    // The verbs are the row's, wherever the row is drawn — and because every
    // change round-trips through main and the list re-reads, the item's other
    // copy follows without being told.
    'a status set from inside one group moves the item in BOTH',
    JSON.stringify(v.statusesAfter) === JSON.stringify(['done', 'done']),
    JSON.stringify(v.statusesAfter),
  )
  check(
    // The pivot is a view. Turning it off restores the order exactly, because
    // nothing about the file changed when it went on.
    'and going back is the list exactly as it was, in creation order',
    JSON.stringify(v.backToTime) === JSON.stringify(byTime) && byTime.length === 7,
    JSON.stringify(v.backToTime),
  )
  check('nothing errored on the way', v.appError === 'none', String(v.appError))
}

// ── the notebook is filing days somewhere you are not (D63) ────────────
//
// **Reported from use, and the report had three parts.** Changing the system
// timezone with two windows open produced two windows offering to move the
// notebook in OPPOSITE directions (each renderer had resolved the machine's
// zone in its own process, where `Intl` is frozen at context creation); the
// offer was a pill too small to notice; and clicking it did nothing at all,
// because a title bar is a drag region and drag regions swallow clicks.
//
// The first is settled in `zone-notice.test.ts`, where main is the only thing
// that answers. The other two are only settled by pixels and a click.
{
  // A zone that is not this machine's, whatever machine this is — so the suite
  // says the same thing in California as it does in Tel Aviv.
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone
  const away = here === 'Asia/Jerusalem' ? 'America/Los_Angeles' : 'Asia/Jerusalem'
  const city = zone => zone.split('/').pop().replace(/_/g, ' ')

  const filed = async () => {
    const root = await week(['A day filed somewhere else.\n'])
    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(join(root, 'config', 'notebook.json'), JSON.stringify({ zone: away }))
    return root
  }

  const z = report(await launch('zonebar', await filed()))
  check('the offer is a row across the page, not a pill in the corner', z.shown === true && z.widthOfPage >= 90,
    `shown ${z.shown} \u00b7 ${z.widthOfPage}% of the page`)
  check(
    // "You are in Los Angeles" is not actionable; the comparison is.
    'and it names BOTH zones, because the decision is a comparison',
    String(z.says).includes(city(away)) && String(z.says).includes(city(here)),
    String(z.says),
  )
  check(
    // The defect: a handler that was correct and unreachable.
    'THE BUG: the button actually moves the notebook',
    z.before === away && z.after === here,
    `${z.before} \u2192 ${z.after}`,
  )
  check('and the row goes away once there is nothing to offer', z.gone === true, String(z.gone))
  check('nothing errored on the way', z.appError === 'none', String(z.appError))

  const d = report(await launch('zonebar|dismiss', await filed()))
  check(
    // No is an answer. Travelling is not a mistake to be corrected.
    'dismissing it puts the row away and leaves the notebook where it was',
    d.gone === true && d.zoneKept === away,
    `gone ${d.gone} \u00b7 filing in ${d.zoneKept}`,
  )
}

if (process.env.TEPHRA_TIMING !== undefined) {
  const total = spent.reduce((n, one) => n + one.ms, 0)
  console.log(`\n\u2014 where the time went: ${(total / 1000).toFixed(1)}s across ${spent.length} launches \u2014`)
  for (const one of [...spent].sort((a, b) => b.ms - a.ms)) {
    console.log(`  ${String((one.ms / 1000).toFixed(1)).padStart(6)}s  ${one.scene}`)
  }
}

// ── 16. capture from where the thought arrives ──────────────────────────────
//
// The success criterion's first failure is a task that never reaches the list,
// so the head goes on carrying it (T13). What guards it is that capture costs
// nothing: no window to open, no place to go, no sentence abandoned.
console.log('\n\u2014 capture from the stream \u2014')
{
  const prose = 'Spoke to the agent today. I should call the surveyor about the boundary before Friday.\n'

  // **Committed**: the row opens in the list prefilled from the selection, and
  // once it is committed the words point at the task they became.
  const kept = report(await launch('capture', await week([prose])))
  check('a selection can be taken from mid-sentence', kept.selected === 'call the surveyor about the boundary')
  check(
    'THE POINT: it opens the LIST with a row, prefilled — not an item made behind your back',
    kept['w2.rowOpen'] === true && kept['w2.prefilled'] === 'call the surveyor about the boundary',
    `${kept['w2.rowOpen']} \u00b7 ${JSON.stringify(kept['w2.prefilled'])}`,
  )
  check(
    'committing it makes the item and leaves the sentence its words',
    Array.isArray(kept.items) && kept.items[0] === 'call the surveyor about the boundary' &&
      /Spoke to the agent today\./.test(String(kept.prose)) && /before Friday\./.test(String(kept.prose)),
    JSON.stringify(kept.items),
  )
  check(
    'and the words now point at the task they became',
    /\[call the surveyor about the boundary\]\(tephra:todo\/[0-9a-z]{8}\)/.test(String(kept.prose)),
    String(kept.prose),
  )
  check('nothing errored on the way', kept.appError === 'none', String(kept.appError))

  // **Abandoned**: Escape eliminates it, which costs nothing because it was
  // never made — the item exists only once the row is committed.
  const gone = report(await launch('capture|escape', await week([prose])))
  check(
    'escaping the row leaves no task behind',
    gone['w2.rowGone'] === true && gone['w2.leftBehind'] === 0 &&
      Array.isArray(gone.items) && gone.items.length === 0,
    `row ${gone['w2.rowGone']} \u00b7 rows ${gone['w2.leftBehind']} \u00b7 ${JSON.stringify(gone.items)}`,
  )
  check(
    'and the sentence you were writing is exactly as you left it',
    gone.proseUntouched === true && gone.linked === false,
    String(gone.prose),
  )
}

const failed = checks.filter(c => !c.ok)
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length === 0 ? 0 : 1)
