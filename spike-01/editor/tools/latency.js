// Keystroke-to-paint in a real window with a real compositor.
// Opens a visible Chrome window; do not touch the keyboard while it runs.
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = process.env.SPIKE_URL || 'http://localhost:8321/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--window-size=1500,1000', '--window-position=40,40'],
  defaultViewport: null,
})
const page = (await browser.pages())[0]
await page.goto(URL_, { waitUntil: 'networkidle2' })
await page.waitForFunction('window.view && window.view.state.doc.length > 500000')
await page.evaluate(() => { document.getElementById('hud').classList.add('mini') })

const ev = (f, ...a) => page.evaluate(f, ...a)
const settle = () => ev(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

async function run({ label, widgets, wpm, where, chars = 240 }) {
  await ev(w => { window.spikeOpts.widgets = w; window.spikeRebuild() }, widgets)
  await ev(f => {
    const sc = view.scrollDOM
    sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * f
  }, where)
  await new Promise(r => setTimeout(r, 700))
  await page.focus('.cm-content')
  await ev(() => {
    const pos = view.posAtCoords({ x: 500, y: 450 }) ?? Math.floor(view.state.doc.length / 2)
    view.dispatch({ selection: { anchor: view.state.doc.lineAt(pos).from } })
  })
  await page.keyboard.press('o')                 // open a line, enter insert mode
  await ev(() => {
    const m = window.spikeMetrics
    for (const k of ['paint', 'eventTiming', 'inputDelay', 'processing', 'inlineSamples', 'blockSamples']) m[k].length = 0
    m.longTasks = 0; m.maxQueue = 0
  })

  const gap = 60000 / (wpm * 5)                  // 5 chars per word
  const SENTENCE = 'The measurement exists so that nobody talks themselves into a bad number, and the prose is ordinary on purpose. '
  for (let i = 0; i < chars; i++) await page.keyboard.type(SENTENCE[i % SENTENCE.length], { delay: gap })
  await settle()

  const s = await ev(() => {
    const m = window.spikeMetrics
    const pct = (a, p) => { if (!a.length) return NaN; const q = [...a].sort((x, y) => x - y); return q[Math.min(q.length - 1, Math.floor(p / 100 * q.length))] }
    const row = a => [a.length, +pct(a, 50).toFixed(1), +pct(a, 95).toFixed(1), +pct(a, 99).toFixed(1), +Math.max(0, ...a).toFixed(1)]
    return {
      paint: row(m.paint), evt: row(m.eventTiming), delay: row(m.inputDelay),
      inline: row(m.inlineSamples), block: row(m.blockSamples),
      long: m.longTasks, queue: m.maxQueue,
      widgets: document.querySelectorAll('.tx-math,.tx-img,.tx-table').length,
    }
  })
  await page.keyboard.press('Escape')
  await ev(() => { for (let i = 0; i < 200; i++) view.dispatch({ effects: [] }) })   // no-op settle
  return { label, wpm, ...s }
}

const rows = []
rows.push(await run({ label: 'widgets off, top of document', widgets: false, wpm: 130, where: 0.02 }))
rows.push(await run({ label: 'widgets on, top of document', widgets: true, wpm: 130, where: 0.02 }))
rows.push(await run({ label: 'widgets on, mid-document', widgets: true, wpm: 130, where: 0.5 }))
rows.push(await run({ label: 'widgets on, end of document', widgets: true, wpm: 130, where: 0.95 }))
rows.push(await run({ label: 'widgets on, burst 300 wpm', widgets: true, wpm: 300, where: 0.5, chars: 320 }))
rows.push(await run({ label: 'widgets on, abuse 600 wpm', widgets: true, wpm: 600, where: 0.5, chars: 320 }))

const pad = (s, n) => String(s).padEnd(n)
const num = (s, n) => String(s).padStart(n)
console.log('\nkeystroke → paint, real window, 1.05 MB document')
console.log(`ua: ${await page.evaluate('navigator.userAgent')}\n`)
console.log(pad('condition', 30) + num('n', 5) + num('p50', 7) + num('p95', 7) + num('p99', 7) + num('max', 7) +
  num('delay p99', 11) + num('long', 6) + num('queue', 7) + num('widgets', 9))
console.log('─'.repeat(96))
for (const r of rows) {
  console.log(pad(r.label, 30) + num(r.paint[0], 5) + num(r.paint[1], 7) + num(r.paint[2], 7) +
    num(r.paint[3], 7) + num(r.paint[4], 7) + num(r.delay[3], 11) + num(r.long, 6) + num(r.queue, 7) + num(r.widgets, 9))
}
console.log('\nsame runs, browser Event Timing (hardware event → presentation, 8 ms buckets)')
console.log(pad('condition', 30) + num('p50', 7) + num('p95', 7) + num('p99', 7) + num('max', 7))
console.log('─'.repeat(58))
for (const r of rows) console.log(pad(r.label, 30) + num(r.evt[1], 7) + num(r.evt[2], 7) + num(r.evt[3], 7) + num(r.evt[4], 7))
console.log('\nwidget decoration cost (ms): inline rescan p99 / block field p99')
for (const r of rows) console.log(`  ${pad(r.label, 30)} ${r.inline[3]} / ${r.block[3]}`)

await browser.close()
