// Control experiment: type the same text, on the same machine and display,
// into a plain <textarea> and into the spike editor. The difference between
// the two is the editor's contribution; the rest is the platform's floor.
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.SPIKE_URL || 'http://localhost:8321/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--window-size=1500,1000', '--window-position=40,40'],
  defaultViewport: null,
})
const page = (await browser.pages())[0]

const SENTENCE = 'The measurement exists so that nobody talks themselves into a bad number, and the prose is ordinary on purpose. '

async function measure(url, prepare, chars = 260, wpm = 130) {
  await page.goto(url, { waitUntil: 'networkidle2' })
  await page.waitForFunction('window.view && window.view.state.doc.length > 500000')
  if (prepare) await prepare()
  await new Promise(r => setTimeout(r, 600))
  await page.evaluate(() => {
    const m = window.spikeMetrics
    for (const k of ['paint', 'paintLow', 'eventTiming', 'inputDelay', 'processing']) m[k].length = 0
    m.longTasks = 0; m.maxQueue = 0
  })
  const gap = 60000 / (wpm * 5)
  for (let i = 0; i < chars; i++) await page.keyboard.type(SENTENCE[i % SENTENCE.length], { delay: gap })
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  return page.evaluate(() => {
    const m = window.spikeMetrics
    const pct = (a, p) => { if (!a.length) return NaN; const q = [...a].sort((x, y) => x - y); return q[Math.min(q.length - 1, Math.floor(p / 100 * q.length))] }
    const row = a => [a.length, +pct(a, 50).toFixed(1), +pct(a, 95).toFixed(1), +pct(a, 99).toFixed(1), +Math.max(0, ...a).toFixed(1)]
    return { paintLow: row(m.paintLow), paint: row(m.paint), evt: row(m.eventTiming), delay: row(m.inputDelay), proc: row(m.processing), long: m.longTasks, queue: m.maxQueue }
  })
}

const results = []
results.push(['plain <textarea>, 1.05 MB', await measure(BASE + 'baseline.html', async () => {
  await page.focus('#t')
  await page.evaluate(() => { const t = document.getElementById('t'); t.selectionStart = t.selectionEnd = Math.floor(t.value.length / 2); t.blur(); t.focus() })
})])
results.push(['CodeMirror + vim + widgets', await measure(BASE, async () => {
  await page.evaluate(() => { document.getElementById('hud').classList.add('mini') })
  await page.evaluate(() => { view.scrollDOM.scrollTop = (view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight) * 0.5 })
  await page.focus('.cm-content')
  await new Promise(r => setTimeout(r, 500))
  await page.evaluate(() => {
    const pos = view.posAtCoords({ x: 500, y: 450 }) ?? Math.floor(view.state.doc.length / 2)
    view.dispatch({ selection: { anchor: view.state.doc.lineAt(pos).from } })
  })
  await page.keyboard.press('o')
})])

// display refresh rate, so the frame quantisation in the numbers is legible
const hz = await page.evaluate(() => new Promise(res => {
  const ts = []
  const tick = t => { ts.push(t); ts.length < 40 ? requestAnimationFrame(tick) : res(+(1000 / ((ts.at(-1) - ts[0]) / (ts.length - 1))).toFixed(1)) }
  requestAnimationFrame(tick)
}))

const pad = (s, n) => String(s).padEnd(n), num = (s, n) => String(s).padStart(n)
console.log(`\ndisplay refresh: ${hz} Hz  (one frame = ${(1000 / hz).toFixed(1)} ms)`)
console.log(`\nkeystroke → paint, bracketed: [frame that paints it .. the frame after]\n`)
console.log(`${pad('surface', 30)}${num('n', 5)}${num('p50', 16)}${num('p95', 16)}${num('p99', 16)}${num('delay p99', 11)}${num('js p99', 9)}`)
console.log('─'.repeat(93))
const br = (a, b, i) => `${a[i]}–${b[i]}`
for (const [label, r] of results) {
  console.log(pad(label, 30) + num(r.paint[0], 5) + num(br(r.paintLow, r.paint, 1), 16) + num(br(r.paintLow, r.paint, 2), 16) + num(br(r.paintLow, r.paint, 3), 16) + num(r.delay[3], 11) + num(r.proc[3], 9))
}
console.log('\nsame runs, browser Event Timing (8 ms buckets)')
console.log(`${pad('surface', 30)}${num('p50', 8)}${num('p95', 8)}${num('p99', 8)}`)
console.log('─'.repeat(54))
for (const [label, r] of results) console.log(pad(label, 30) + num(r.evt[1], 8) + num(r.evt[2], 8) + num(r.evt[3], 8))

const [, base] = results[0], [, cm] = results[1]
console.log(`\neditor over the platform floor — lower bound p50 ${(cm.paintLow[1] - base.paintLow[1]).toFixed(1)} ms, p99 ${(cm.paintLow[3] - base.paintLow[3]).toFixed(1)} ms`)
console.log(`                              upper bound p50 ${(cm.paint[1] - base.paint[1]).toFixed(1)} ms, p99 ${(cm.paint[3] - base.paint[3]).toFixed(1)} ms`)
await browser.close()
