// Headless probe: the parts of Spike A that a machine can judge.
// Vim-over-widget behaviour is checked as assertions; latency is measured but
// the authoritative latency/feel judgement is the human at a real window.
import puppeteer from 'puppeteer-core'

const URL_ = process.env.SPIKE_URL || 'http://localhost:8321/'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const results = []
const rec = (name, pass, detail) => {
  results.push({ name, pass, detail })
  const tag = pass === true ? ' PASS' : pass === false ? ' FAIL' : ' ····'
  console.log(`${tag}  ${name}${detail ? '\n        ' + String(detail).replace(/\n/g, '\n        ') : ''}`)
}
const head = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADFUL ? false : true,
  args: ['--window-size=1400,1000', '--force-device-scale-factor=1'],
  defaultViewport: { width: 1400, height: 1000 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()) })
page.on('requestfailed', r => { if (!/favicon/.test(r.url())) errors.push(`request failed: ${r.url()}`) })

head('load')
const t0 = Date.now()
await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 60000 })
await page.waitForFunction('window.view && window.view.state.doc.length > 500000', { timeout: 60000 })
const loadMs = Date.now() - t0
const docLen = await page.evaluate('view.state.doc.length')
rec('loads a 1 MB corpus into a live editor', true,
  `${loadMs} ms to interactive; ${(docLen / 1e6).toFixed(2)} MB, ${await page.evaluate('view.state.doc.lines')} lines`)
rec('initial whole-document block-widget scan', true, `${await page.evaluate('spikeMetrics.initialBlockScan.toFixed(1)')} ms`)
rec('no JS errors on load', errors.length === 0, errors.slice(0, 5).join('\n') || 'clean')

// ── helpers ────────────────────────────────────────────────────────────────
const ev = (fn, ...a) => page.evaluate(fn, ...a)
const settle = () => ev(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

async function setDoc(text) {
  await ev(t => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t }, selection: { anchor: 0 } }), text)
  await settle()
}
async function setOpts(o) {
  await ev(o => { Object.assign(window.spikeOpts, o); window.spikeRebuild() }, o)
  await settle()
}
// place the cursor by (text on the line, column) — no line-number arithmetic
async function cursorAt(needle, c) {
  const ok = await ev((needle, c) => {
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const ln = view.state.doc.line(n)
      if (ln.text.includes(needle)) {
        view.dispatch({ selection: { anchor: ln.from + (c < 0 ? ln.text.length + 1 + c : c) }, scrollIntoView: true })
        return true
      }
    }
    return false
  }, needle, c)
  if (!ok) throw new Error(`cursorAt: no line containing ${JSON.stringify(needle)}`)
  await settle()
}
async function keys(seq) {
  for (const k of seq) await page.keyboard.press(k, { delay: 14 })
  await settle()
}
const doc = () => ev('view.state.doc.toString()')
const lineWith = needle => ev(n => {
  for (let i = 1; i <= view.state.doc.lines; i++) if (view.state.doc.line(i).text.includes(n)) return view.state.doc.line(i).text
  return null
}, needle)
const col = () => ev(() => { const h = view.state.selection.main.head; return h - view.state.doc.lineAt(h).from })

const L = {
  alpha: 'Alpha line with prose only',
  beta: 'Beta has an equation',
  gamma: 'Gamma has an image',
  omega: 'Omega closing line',
}
const FIXTURE = [
  'Alpha line with prose only, nothing rendered on it at all.',
  'Beta has an equation $E = mc^2$ in the middle and prose after it.',
  'Gamma has an image ![p](img/plot.png) inline and prose after it.',
  '',
  '$$P(A \\mid B) = \\frac{P(B \\mid A)P(A)}{P(B)}$$',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '| 3 | 4 |',
  '',
  'Omega closing line of the fixture.',
].join('\n')
const BETA = FIXTURE.split('\n')[1]
const EQ = '$E = mc^2$'
const EQ_FROM = BETA.indexOf(EQ), EQ_TO = EQ_FROM + EQ.length

await page.focus('.cm-content')
await setDoc(FIXTURE)
await cursorAt(L.alpha, 0)

head('widgets')
const counts = await ev(() => ({
  math: document.querySelectorAll('.tx-math').length,
  img: document.querySelectorAll('.tx-img').length,
  table: document.querySelectorAll('.tx-table').length,
  katex: document.querySelectorAll('.katex').length,
  tableRows: document.querySelectorAll('.tx-table tr').length,
}))
rec('inline math, inline image, display math and table all render',
  counts.math >= 2 && counts.img >= 1 && counts.table >= 1 && counts.katex >= 2,
  JSON.stringify(counts))

// ═══ the vim matrix, in the configuration that works ══════════════════════
// reveal ON + adjacency reveal ON + inline widgets atomic + block widgets NOT
// atomic. The section after this one records why each of those is forced.
for (const reveal of [true]) {
  head('vim over widgets — working configuration')
  await setOpts({ reveal: true, revealAdjacent: true, atomic: true, atomicBlocks: false, widgets: true })

  // dd + u
  await setDoc(FIXTURE)
  await cursorAt(L.beta, 0)
  await keys(['d', 'd'])
  const ddGone = !(await doc()).includes(L.beta)
  await keys(['u'])
  const ddBack = (await doc()) === FIXTURE
  rec('dd removes the whole equation line; u restores it byte-for-byte', ddGone && ddBack,
    `deleted=${ddGone} restored=${ddBack}`)

  // l-motion across the equation
  await setDoc(FIXTURE)
  await cursorAt(L.beta, 0)
  const visited = []
  for (let i = 0; i < 34; i++) { await page.keyboard.press('l', { delay: 5 }); visited.push(await col()) }
  const inside = visited.filter(c => c > EQ_FROM && c < EQ_TO)
  rec('l-motion walks into the equation, which unrenders as the cursor arrives',
    inside.length > 0,
    `equation occupies columns [${EQ_FROM},${EQ_TO}); stops inside = ${inside.length}; path …${visited.slice(15, 27).join(',')}…`)

  // x at the start of the construct
  await setDoc(FIXTURE)
  await cursorAt(L.beta, EQ_FROM)
  await keys(['x'])
  const afterX = await lineWith('Beta has an equation')
  const whole = afterX && !afterX.includes('$')
  const oneChar = afterX && afterX.includes('E = mc^2$') && !afterX.includes('$E')
  rec('x on the construct behaves predictably', whole || oneChar,
    `${whole ? 'deletes the entire construct' : oneChar ? 'deletes one $ and leaves the source revealed' : 'UNEXPECTED'} → ${JSON.stringify(afterX)}`)
  await keys(['u'])
  rec('u after x restores', (await doc()) === FIXTURE)

  // visual select spanning the widget
  await setDoc(FIXTURE)
  await cursorAt(L.beta, 0)
  await keys(['v', '$'])
  const selLen = await ev(() => { const s = view.state.selection.main; return s.to - s.from })
  await keys(['d'])
  const betaGone = !(await doc()).includes('E = mc')
  rec('v$ selects across the widget and d deletes the line contents',
    selLen >= BETA.length - 1 && betaGone,
    `selection ${selLen} chars of a ${BETA.length}-char line`)
  await keys(['u'])
  rec('u after visual delete restores', (await doc()) === FIXTURE)

  // cw on the word before the widget
  await setDoc(FIXTURE)
  await cursorAt(L.beta, BETA.indexOf('equation'))
  await keys(['c', 'w'])
  await page.keyboard.type('formula', { delay: 8 })
  await page.keyboard.press('Escape')
  const afterCW = await lineWith('Beta has an')
  rec('cw immediately before a widget changes only the word',
    afterCW.includes('formula $E = mc^2$'), JSON.stringify(afterCW))

  // yank + put a line containing a widget
  await setDoc(FIXTURE)
  await cursorAt(L.beta, 0)
  await keys(['y', 'y', 'p'])
  const dup = (await doc()).split('\n').filter(l => l.includes('E = mc^2')).length
  rec('yy / p duplicates a line containing a widget', dup === 2, `${dup} copies`)
  await keys(['u'])

  // dd on a source row inside a rendered table
  await setDoc(FIXTURE)
  await cursorAt('| 1 | 2 |', 0)
  const before = (await doc()).split('\n').length
  await keys(['d', 'd'])
  const after = (await doc()).split('\n').length
  rec('dd on a table row removes exactly one source row', before - after === 1, `${before} → ${after} lines`)
  await keys(['u'])
  rec('u after table dd restores', (await doc()) === FIXTURE)

  // j down a column, into and through the block widgets
  await setDoc(FIXTURE)
  await cursorAt(L.gamma, 0)
  const jPath = []
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('j', { delay: 12 })
    jPath.push(await ev(() => view.state.doc.lineAt(view.state.selection.main.head).number))
  }
  const monotone = jPath.every((n, i) => i === 0 || n >= jPath[i - 1])
  rec('j reaches every source line, including inside the display block and the table',
    monotone && jPath.includes(5) && jPath.includes(7) && jPath.includes(9),
    `lines ${jPath.join(' → ')} (5 = display math, 7–10 = table rows)`)

  // and landing there reveals the source when reveal is on
  await setDoc(FIXTURE)
  await cursorAt('| 1 | 2 |', 1)
  const tablesRendered = await ev(() => document.querySelectorAll('.tx-table').length)
  rec('a cursor inside the table unrenders it to source rows',
    tablesRendered === 0,
    `${tablesRendered} tables rendered with the cursor in one`)

  // insert immediately after the widget
  await setDoc(FIXTURE)
  await cursorAt(L.beta, EQ_TO)
  await keys(['i'])
  await page.keyboard.type('XYZ', { delay: 8 })
  await page.keyboard.press('Escape')
  const afterIns = await lineWith('Beta has an equation')
  rec('typing directly after a widget inserts at the cursor',
    /\$E = mc\^2\$XYZ/.test(afterIns), JSON.stringify(afterIns))
  await keys(['u'])

  // compound undo
  await setDoc(FIXTURE)
  await cursorAt(L.beta, 0)
  await keys(['d', 'd', 'd', 'd', 'u', 'u'])
  rec('two deletes and two undos round-trip exactly', (await doc()) === FIXTURE)
}

head('why that configuration is forced, not chosen')

// (a) vim's horizontal motion ignores CodeMirror's atomic ranges
await setOpts({ reveal: false, atomic: true, atomicBlocks: true, widgets: true })
await setDoc('prose before $E = mc^2$ prose after')
await cursorAt('prose before', 13)
const stuck = await ev(async () => {
  const out = []
  for (let i = 0; i < 6; i++) {
    view.dispatch({ selection: { anchor: view.state.selection.main.head + 1 } })
    await new Promise(r => requestAnimationFrame(r))
    const c = document.querySelector('.cm-cursor-primary')
    out.push(c ? Math.round(c.getBoundingClientRect().x) : null)
  }
  const w = document.querySelector('.tx-math').getBoundingClientRect()
  return { cursorX: out, widgetLeft: Math.round(w.x), widgetRight: Math.round(w.right) }
})
const pinned = new Set(stuck.cursorX).size === 1
rec('with the widget left rendered, the cursor freezes at its edge while vim walks the hidden source',
  pinned, `cursor x at six successive offsets: ${stuck.cursorX.join(',')}; widget spans x ${stuck.widgetLeft}–${stuck.widgetRight}`)
rec('→ reveal-on-cursor is therefore mandatory, not a preference', pinned,
  'atomicRanges constrains CodeMirror\'s own motion commands; @replit/codemirror-vim does its own offset arithmetic and never consults them')

// (b) block widgets must not be atomic, and must reveal on adjacency
await setDoc(FIXTURE)
const jUnder = async o => {
  await setOpts(o)
  await cursorAt(L.alpha, 0)
  const path = [1]
  for (let i = 0; i < 11; i++) { await page.keyboard.press('j', { delay: 14 }); await settle(); path.push(await ev(() => view.state.doc.lineAt(view.state.selection.main.head).number)) }
  return path
}
const pathPlain = await jUnder({ reveal: true, revealAdjacent: false, atomic: true, atomicBlocks: false, widgets: true })
const pathAdj = await jUnder({ reveal: true, revealAdjacent: true, atomic: true, atomicBlocks: false, widgets: true })
const reaches = p => [5, 7, 8, 9, 10].every(n => p.includes(n))
rec('without an adjacency reveal, j skips every block widget outright', !reaches(pathPlain),
  `j path ${pathPlain.join('→')} — lines 5 and 7–10 (display math, table) never visited`)
rec('with it, j reaches every source line inside the blocks', reaches(pathAdj),
  `j path ${pathAdj.join('→')}`)

head('search')
await setOpts({ reveal: true, revealAdjacent: true, atomic: true, atomicBlocks: false })
await setDoc(FIXTURE)
await cursorAt(L.alpha, 0)
await page.keyboard.press('Slash', { delay: 10 })
await page.keyboard.type('Omega', { delay: 10 })
await page.keyboard.press('Enter', { delay: 10 })
await settle()
const landed = await ev(() => view.state.doc.lineAt(view.state.selection.main.head).text)
rec('/ search jumps past widgets to its match', landed.includes('Omega'), JSON.stringify(landed))
await page.keyboard.press('Escape')

// ═══ performance on the real corpus ════════════════════════════════════════
head('performance (headless Chrome — indicative; real feel is judged at a window)')
await page.reload({ waitUntil: 'networkidle2' })
await page.waitForFunction('window.view && window.view.state.doc.length > 500000')
await page.focus('.cm-content')
await ev(() => { view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight * 0.5 })
await new Promise(r => setTimeout(r, 700))
await ev(() => {
  const pos = view.posAtCoords({ x: 500, y: 500 }) || Math.floor(view.state.doc.length / 2)
  view.dispatch({ selection: { anchor: view.state.doc.lineAt(pos).from } })
})
await page.keyboard.press('o')          // open a line below, into insert mode
const SENTENCE = 'The measurement exists so that nobody has to talk themselves into a bad number. '
for (let round = 0; round < 5; round++) for (const ch of SENTENCE) await page.keyboard.type(ch, { delay: 46 })
const stats = await ev(() => {
  const m = window.spikeMetrics
  const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] }
  const row = a => ({ n: a.length, p50: +pct(a, 50).toFixed(1), p95: +pct(a, 95).toFixed(1), p99: +pct(a, 99).toFixed(1), max: +Math.max(0, ...a).toFixed(1) })
  return {
    toPaint_rAF: row(m.paint), toPaint_eventTiming_8ms_buckets: row(m.eventTiming),
    inputDelay: row(m.inputDelay), jsHandler: row(m.processing),
    inlineWidgetRescan: row(m.inlineSamples), blockWidgetUpdate: row(m.blockSamples),
    initialBlockScanMs: +m.initialBlockScan.toFixed(1), longTasks: m.longTasks, maxKeystrokeQueue: m.maxQueue,
    widgetsInViewport: document.querySelectorAll('.tx-math,.tx-img,.tx-table').length,
  }
})
rec('typing 400 characters mid-corpus', null, JSON.stringify(stats, null, 1))
rec('keystrokes do not queue', stats.maxKeystrokeQueue <= 2, `max queue depth ${stats.maxKeystrokeQueue} (1–2 is one frame of batching)`)
rec('no long tasks over 50 ms while typing', stats.longTasks === 0, `${stats.longTasks} long tasks`)

const scrollProbe = await ev(async () => {
  const sc = view.scrollDOM
  const samples = []
  for (const frac of [0, 0.25, 0.5, 0.75, 0.98]) {
    sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * frac
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const h = view.state.selection.main.head
    view.dispatch({ changes: { from: h, insert: 'x' } })
    view.dispatch({ changes: { from: h, to: h + 1 } })
    samples.push({ frac, inlineMs: +window.spikeMetrics.lastInline.toFixed(2), blockMs: +window.spikeMetrics.lastBlock.toFixed(2) })
  }
  return samples
})
const worst = Math.max(...scrollProbe.flatMap(s => [s.inlineMs, s.blockMs]))
rec('widget rebuild cost is flat across document position', worst < 5, JSON.stringify(scrollProbe))

const storm = await ev(async () => {
  const sc = view.scrollDOM
  sc.scrollTop = 0
  let frames = 0, worstFrame = 0, last = performance.now()
  const start = last
  await new Promise(res => {
    const tick = () => {
      const now = performance.now()
      worstFrame = Math.max(worstFrame, now - last); last = now; frames++
      sc.scrollTop += 1200
      if (now - start < 4000 && sc.scrollTop < sc.scrollHeight - sc.clientHeight) requestAnimationFrame(tick)
      else res()
    }
    requestAnimationFrame(tick)
  })
  return { frames, worstFrameMs: +worstFrame.toFixed(1), reachedBottom: sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 2 }
})
rec('scrolling the whole corpus never stalls', storm.worstFrameMs < 100, JSON.stringify(storm))

rec('no JS errors during the whole run', errors.length === 0, errors.slice(0, 8).join('\n') || 'clean')

await ev(() => { const h = document.getElementById('hud'); if (h) h.style.display = 'none'; view.scrollDOM.scrollTop = 0 })
await settle()
await page.screenshot({ path: process.env.SHOT || 'probe-shot.png' })
await browser.close()

const fails = results.filter(r => r.pass === false)
console.log(`\n${results.filter(r => r.pass === true).length} passed, ${fails.length} failed`)
if (fails.length) console.log(fails.map(f => '  ✗ ' + f.name).join('\n'))
process.exit(fails.length ? 1 : 0)
