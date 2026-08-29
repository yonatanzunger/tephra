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
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electron = './node_modules/.bin/electron'

/** Today in the reference zone, the same rule the app files by (D38). */
const DAY = new Date(Date.now() - 8 * 60 * 60_000).toISOString().slice(0, 10)

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
  check('and nothing errored on the way', r.appError === 'none', String(r.appError))
}

const failed = checks.filter(c => !c.ok)
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length === 0 ? 0 : 1)
