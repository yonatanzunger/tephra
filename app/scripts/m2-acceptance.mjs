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

console.log('— what a marker resolves to —')
{
  // Reported from use: clicking a marker produced a panel saying *nothing
  // resolves here*, about a mark the editor had drawn itself.
  const body =
    '**Intrinsic S** is a property of the participant, not of any\nrelationship. ' +
    'This distinguishes the mechanism from the hold-up\nproblem of Klein, Crawford and Alchian.\n'
  const root = await notebook(body)
  const r = report(await launch('mark-panel', root))

  check('a tag resolves from its own marker', r.tagged === true
    && r.resolved?.[0]?.names?.[0] === 'House Deal', JSON.stringify(r.resolved))
  check('and so does a bookmark', r.bookmarked === true
    && r.resolvedWithBookmark?.some(m => m.kinds?.includes('Bookmark')) === true,
    JSON.stringify(r.resolvedWithBookmark))
  check(
    'THE ONE THAT LIED: a comment resolves from its marker too',
    // A commented range opens with a handle exactly as a tagged one does, and
    // `markAt` asked about anchors and tags only — so the third kind of marker
    // drew a mark that stood for nothing.
    r.commented === true && r.composerOpened === true
      && r.resolvedWithComment?.some(m => m.kinds?.includes('Comment')) === true,
    JSON.stringify(r.resolvedWithComment),
  )
  check(
    'naming the note and who wrote it, rather than reading it out',
    // The thread's messages are in the rail (D50); the panel identifies.
    r.resolvedWithComment?.some(m =>
      m.names?.[0] === 'Is this the right word for it?' && m.who?.[0] === 'zunger') === true,
    JSON.stringify(r.resolvedWithComment),
  )
  check(
    'and NO marker in the fixture resolves to nothing',
    // The general form of the report: every handle drawn stands for something.
    Array.isArray(r.resolvedWithComment)
      && r.resolvedWithComment.every(m => !m.kinds?.includes('Marker')),
    JSON.stringify(r.resolvedWithComment),
  )
  check('and the picture is of the case that was reported', r.photographed === 'Comment')
}

console.log('— a tagged region —')
{
  // Reported from use: underlining is jarring once a subject covers more than a
  // handful of words, and what the notebook is actually FOR is subject-tagging
  // whole areas. A rule under the words is a word-scale device; over three
  // paragraphs the same notation lands on every line of them.
  const body =
    'Every market participant has a finite shock limit S(t): the largest sudden\n' +
    'loss it can absorb. The limit is not a property of any one relationship,\n' +
    'which is what makes it awkward to price: it moves when anything else in\n' +
    'the portfolio moves, and the counterparty cannot see it moving.\n\n' +
    'That opacity is the whole difficulty. A limit nobody can observe is a\n' +
    'limit nobody can contract on, so the mechanism has to work without it.\n\n' +
    'THE END\n'
  const root = await notebook(body)
  const r = report(await launch('tag-region', root))

  check('the subject went on, over a span well past a phrase', r.tagged === true && r.span > 160, `span=${r.span}`)
  check(
    'THE POINT: nothing under the words',
    r.underlines === 0,
    `underlines=${r.underlines}`,
  )
  check('and a spine beside them instead', r.spines === 1, `spines=${r.spines}`)
  check(
    'entirely left of the text, in the band the layout reserves',
    r.spineBox?.leftOfText === true && r.spineBox?.band > 0,
    JSON.stringify(r.spineBox),
  )
  check(
    'narrow, and as tall as the region rather than as tall as a line',
    r.spineBox?.width >= 2 && r.spineBox?.width <= 8 && r.spineBox?.tall === true,
    JSON.stringify(r.spineBox),
  )
  check(
    'one unbroken rule covering the region exactly, blank lines included',
    // Measured, because it was seven pixels short at each end when it asked
    // `coordsAtPos` for character boxes instead of asking for line blocks.
    r.spineBox?.region !== null && r.spineBox?.top === r.spineBox?.region?.top
      && r.spineBox?.height === r.spineBox?.region?.height,
    JSON.stringify(r.spineBox),
  )
  check(
    'THE ONE THAT WAS UNREACHABLE: clicking it opens the panel',
    // A wide tag's own mark sits at the top of the region, usually off screen,
    // so this was in practice the hardest kind of tag to rename or remove.
    r.panel?.opened === true && r.panel?.named?.includes('Shock limits') === true,
    JSON.stringify(r.panel),
  )
  check(
    'and the panel offers exactly rename and remove',
    Array.isArray(r.panel?.offers) && r.panel.offers.includes('Rename')
      && r.panel.offers.includes('Remove'),
    JSON.stringify(r.panel?.offers),
  )
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
  check(
    // **Reported from use**: the row of offered emoji read as reactions the
    // comment already had. What exists is drawn; what you could add is a control,
    // and controls appear on hover the way Edit and Delete do.
    'THE EMOJI SELECTORS ARE CONTROLS, invisible until you hover',
    r.quickAtRest === '0' && r.plusAtRest === '0',
    `quick ${r.quickAtRest} · plus ${r.plusAtRest}`,
  )
  check(
    // **Reported from use**: *comments are rendering too close to the text, with
    // their guideline even overlapping it a bit* — seven pixels, being the spine
    // band the rail's placement did not account for.
    'and a note\'s guideline is clear of the prose, not through it',
    typeof r.guideGap === 'number' && r.guideGap > 0,
    `${r.guideGap}px between the column edge and the guideline`,
  )
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

// ── a table wider than the measure ──────────
//
// **Reported from use** (2026-09-15), from a real notebook: a six-column table
// at the end of a day pushed the reading column open and took the prose with it,
// so sentences ran off the right edge of the window. The measure is the one
// promise this frame exists to keep (D42, R27) — so a table is allowed to be
// wider than it and is not allowed to widen it.
console.log('\n— a wide table —')
{
  // **The shape reported from use**, and then a cell that cannot compress.
  //
  // The reported table is six ordinary columns, and a table like that COMPRESSES:
  // its cells wrap word by word, so it fits any measure and needs no scroller.
  // That is why the first version of this section passed while the bug was live.
  // The last row holds one unbreakable token, which is the only way to make a
  // table genuinely wider than the column it is in — and that is the case where
  // *bounded, with its own scroller* has to be true rather than moot.
  const table = [
    '| Mode | Impact | Work | Scariness | Boundaries | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
    '| **Netflix-type job** | Low | High | Low | Externally enforced | `see note` |',
    '| SoD book etc | High | Med-High | High | Must be internal | Time pressure: need to act soon |',
    '| Clarity-type work | Uncertain | Med-High | Med | Must be internal | Details still fuzzy |',
    '| Unbreakable | x | y | z | w | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa |',
  ].join('\n')
  // **And a fenced block**, because a code line has a measure of its own and is
  // meant to reach past the prose column (`theme.ts`: 80 characters of the code
  // face, `maxWidth: none`). Whatever holds the measure for a table must leave
  // that alone — which is the mistake this section nearly shipped.
  const code = [
    '```python',
    'def a_line_of_code_written_to_eighty_columns(argument, another, third):  # and a comment',
    '    return argument + another + third  # eighty columns is the point of the width',
    '```',
  ].join('\n')
  const root = await week([
    `Before the table, a sentence long enough to show where the measure is.\n\n${table}\n\n${code}\n\nAnd after it, another sentence of ordinary prose that should wrap at the measure.\n`,
  ])
  const r = report(await launch('wide', root, { timeoutMs: 60_000, shotDelay: 25_000 }))

  check('the table renders as a table', r.tableRendered === true, String(r.tableRendered))
  check(
    // **The failure, stated as the check.** `.cm-content` is a flex item with an
    // explicit width, and a flex item's automatic minimum is its content's
    // min-content size — so a wide table grew the column despite the width, and
    // `min-width: 0` is what lets the width mean what it says.
    'A WIDE TABLE DOES NOT WIDEN THE COLUMN',
    typeof r.measure === 'number' && typeof r.columnWidth === 'number' &&
      Math.abs(r.columnWidth - r.measure) <= 1,
    `measure ${r.measure}px · column ${r.columnWidth}px`,
  )
  check(
    // **The guard, and the check that actually catches the reported bug.**
    // CodeMirror writes `flex-basis` inline on `.cm-content` from its own
    // widest-content measurement — `1510px` in the notebook that reported this —
    // and for a flex item that beats `width`, so the measure was overruled by
    // the content it exists to constrain. This does what CodeMirror does and
    // asserts the column does not move.
    //
    // **The trigger is not reproducible here and the guard is**, which is why it
    // is tested this way: the same table in the same notebook never made this
    // build measure wide, so a check that waited for the symptom would pass
    // while the bug was live — as an earlier version of this section did.
    'AND THE MEASURE HOLDS when something asks for a wider column',
    r.forcedStuck !== 'cleared by CodeMirror' &&
      typeof r.forcedColumn === 'number' && Math.abs(r.forcedColumn - r.measure) <= 1 &&
      r.forcedProseOverflow === 0,
    `asked for ${r.forcedStuck} → column ${r.forcedColumn}px, prose ${r.forcedProseOverflow}px past it`,
  )
  check(
    // **Words stay whole in a cell.** CodeMirror's wrapping sets `overflow-wrap:
    // anywhere` on its content and it inherited into cells, which broke
    // *Property* across two lines as *Prop / erty* — reported from use, and at
    // its worst in a table because a column is narrow by nature.
    'a cell breaks at spaces, not mid-word',
    typeof r.cellWrapping === 'string' && r.cellWrapping.startsWith('normal/normal'),
    String(r.cellWrapping),
  )
  check(
    // **Reported from use**: a cell reading `**Property**` showed its asterisks.
    // A widget's DOM is outside the decoration machinery that conceals marks in
    // a line, and the cell was assigned `textContent` — the one place in this
    // surface where markdown was rendered as its own source.
    'AND A CELL DRAWS ITS MARKS rather than showing them',
    r.cellMarks !== null && typeof r.cellMarks === 'object' &&
      r.cellMarks.tags.includes('strong') && r.cellSource === false,
    `${JSON.stringify(r.cellMarks)} · any literal marks left: ${r.cellSource}`,
  )
  check(
    'and the prose still ends at the measure',
    r.proseOverflow === 0,
    `${r.proseOverflow}px past the column`,
  )
  check(
    // **The two claims that read as a conflict and are not one** (D86). Code is
    // written to eighty columns and wrapping it narrower destroys the one thing
    // its layout carries; prose wraps at a reading measure and must not be
    // dragged wider by anything. Solved rather than traded off: the block's size
    // is derived so that eighty columns of the code face IS the prose measure.
    //
    // Before this, a code block took `maxWidth: none` and reached past the
    // column — into the band the annotation gutter lives in — and the mechanism
    // that let it do so is the one that let a table drag the prose out with it.
    'A CODE BLOCK GETS EIGHTY COLUMNS AND STAYS IN THE COLUMN',
    r.codeLine !== null && typeof r.codeLine === 'object' &&
      Math.abs(r.codeLine.width - r.measure) <= 2 && r.codeLine.pastColumn <= 1,
    JSON.stringify(r.codeLine),
  )
  check('nothing errored on the way', r.appError === 'none', String(r.appError))
}

// ── a wrapped line never begins with a space (note 72) ────────────────────
console.log('\n— wrapping —')
{
  // **Words of every length from one to twelve, cycled**, so the line ends land
  // all over the last word-width and some of them within a space of the margin
  // — which is the only case that shows the defect. Forty-odd visual lines make
  // a miss vanishingly unlikely; the computed style is asserted as well, since
  // it is the mechanism and the thing a CodeMirror upgrade would move.
  // **Aperiodic, and that is load-bearing.** The first cut cycled the words
  // with a fixed stride, and a periodic sequence wraps in a repeating pattern:
  // thirty-eight lines with a handful of distinct end positions, none within a
  // space of the margin, so the property passed WITHOUT the fix. A small LCG
  // scatters the line ends across the last word-width, and a hundred lines make
  // a miss a one-in-a-hundred-thousand event.
  const words = ['a', 'of', 'the', 'four', 'seven', 'twelve', 'reading', 'notebook',
    'alignment', 'typography', 'consistency', 'hyphenation']
  let seed = 7
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed >>> 16
  }
  // **Punctuated like prose**, because the other claim this fixture carries is
  // about punctuation at a row's END (D95): a paragraph of bare words has one
  // period in twelve hundred, and nothing to hang. Commas and full stops fall
  // where the generator puts them, so they land at row ends by chance — which
  // is how they land in writing.
  const prose = Array.from({ length: 1200 }, () => {
    const word = words[next() % words.length]
    const mark = next() % 9
    return mark === 0 ? `${word},` : mark === 1 ? `${word}.` : word
  }).join(' ')
  // **A paragraph that opens with a quotation**, which is what hangs (D95), and
  // one that does not, so the check can tell the difference.
  // **The quoted paragraph LAST**, because the stream opens at the append
  // position and only rendered lines can be measured — with it first, the check
  // found nothing and said so, which cost a run to work out.
  const root = await week([`${prose}.\n\n\u201C${prose}.\u201D\n`])
  // **Justified, because that is the condition.** Left-aligned, Chromium lets a
  // trailing space overflow the margin even under `break-spaces`, and a hundred
  // wrapped lines showed nothing; justified, the line must end AT the margin, so
  // the space is pushed to the next line and drawn there — five of a hundred
  // and five, on the same paragraph, the moment the theme was applied. The
  // notebook that reported this runs justified. A partial theme file falls back
  // field by field, so one key is the whole theme.
  await mkdir(join(root, 'config', 'themes'), { recursive: true })
  await writeFile(join(root, 'config', 'themes', 'justified.json'), '{ "justify": true }\n')
  await mkdir(join(root, '.tephra'), { recursive: true })
  await writeFile(join(root, '.tephra', 'ui-state.json'), JSON.stringify({
    version: 1,
    windows: [{ location: { kind: 'today' }, cursor: null, bounds: { x: 60, y: 60, width: 1400, height: 950 } }],
    theme: 'justified', listView: 'time', searchWidth: 380,
  }))
  const r = report(await launch('wrap', root, { timeoutMs: 60_000, shotDelay: 20_000 }))
  check(
    'the paragraph is set justified, which is the only setting that shows the defect',
    r.textAlign === 'justify',
    `text-align is ${JSON.stringify(r.textAlign)}`,
  )
  check(
    // Reported from use: *occasionally a line seems to get started with a
    // space, breaking alignment on the left margin.* CodeMirror wraps with
    // `break-spaces`, under which a space that does not fit at the end of a line
    // moves to the start of the next one and is drawn there.
    'THE MECHANISM: wrapped content hangs its spaces (pre-wrap, not break-spaces)',
    r.whiteSpace === 'pre-wrap',
    `white-space is ${JSON.stringify(r.whiteSpace)}`,
  )
  check(
    'and across a paragraph that wraps dozens of times, no visual line starts with a space',
    typeof r.visualLines === 'number' && r.visualLines >= 60 &&
      Array.isArray(r.spaceStarts) && r.spaceStarts.length === 0,
    `${r.visualLines} wrapped lines · started with a space: ${JSON.stringify(r.spaceStarts)}`,
  )
  check(
    // Reported from use, with a photograph of a printed page: *quotation marks
    // at the left margin hang, so alignment is to the text rather than to the
    // quote.* Chromium has no `hanging-punctuation` at all, so this is a
    // measured negative margin (D95).
    'A PARAGRAPH OPENING WITH A QUOTE HANGS IT, out past the margin',
    r.hungCount === 1 && r.allHangOut === true,
    `${r.hungCount} hung at ${JSON.stringify(r.hungLefts)}, margin ${r.margin}`,
  )
  check(
    // The point of hanging rather than nudging: the words start where every
    // other line starts, and the mark is the only thing outside.
    'and the words after it begin AT the margin, within a pixel',
    Array.isArray(r.textAtMargin) && r.textAtMargin.every(one => typeof one === 'number' && Math.abs(one) <= 1),
    `offsets from the margin: ${JSON.stringify(r.textAtMargin)}`,
  )
  check('and nothing errored on the way', r.appError === 'none')
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
