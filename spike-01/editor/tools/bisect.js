// "It types fine but something is off." Measure each plausible cause, in a real
// window, typing in the place that actually stresses layout: inside a long
// wrapped paragraph rather than at the end of a fresh line.
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = process.env.SPIKE_URL || 'http://localhost:8321/'

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false,
  args: ['--window-size=1500,1000', '--window-position=40,40'], defaultViewport: null,
})
const page = (await browser.pages())[0]
await page.goto(URL_, { waitUntil: 'networkidle2' })
await page.waitForFunction('window.view && window.spikeSetFeature')
await page.evaluate(() => document.getElementById('hud').classList.add('mini'))
const ev = (f, ...a) => page.evaluate(f, ...a)

const ALL = ['vim', 'drawnCaret', 'syntax', 'markdownParser', 'selMatch', 'brackets', 'wrap', 'smoothing']
const SENTENCE = 'the measurement exists so that nobody talks themselves into a bad number, '

async function run({ label, off = [], widgets = true, where = 'short', chars = 170, wpm = 130 }) {
  await ev(a => { for (const n of a) window.spikeSetFeature(n, true) }, ALL)
  await ev(w => window.spikeSetWidgets(w), widgets)
  await ev(a => { for (const n of a) window.spikeSetFeature(n, false) }, off)
  const note = await ev(k => window.spikeGoto(k), where)
  await new Promise(r => setTimeout(r, 500))
  await page.focus('.cm-content')
  await page.keyboard.press('i')            // insert mode, at the cursor
  await ev(() => window.spikeClearStats())
  const gap = 60000 / (wpm * 5)
  for (let i = 0; i < chars; i++) await page.keyboard.type(SENTENCE[i % SENTENCE.length], { delay: gap })
  await ev(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const s = await ev(() => {
    const m = window.spikeMetrics
    const pct = (a, p) => { if (!a.length) return NaN; const q = [...a].sort((x, y) => x - y); return q[Math.min(q.length - 1, Math.floor(p / 100 * q.length))] }
    const row = a => [+pct(a, 50).toFixed(1), +pct(a, 95).toFixed(1), +pct(a, 99).toFixed(1), +Math.max(0, ...a).toFixed(1)]
    return { low: row(m.paintLow), high: row(m.paint), proc: row(m.processing), delay: row(m.inputDelay), long: m.longTasks, queue: m.maxQueue }
  })
  await page.keyboard.press('Escape')
  return { label, note, ...s }
}

const rows = []
rows.push(await run({ label: 'everything on', where: 'short' }))
rows.push(await run({ label: 'everything on', where: 'head' }))
rows.push(await run({ label: 'everything on', where: 'tail' }))
rows.push(await run({ label: 'vim off', where: 'head', off: ['vim'] }))
rows.push(await run({ label: 'native caret', where: 'head', off: ['drawnCaret'] }))
rows.push(await run({ label: 'no match highlight', where: 'head', off: ['selMatch'] }))
rows.push(await run({ label: 'no syntax / no parser', where: 'head', off: ['syntax', 'markdownParser'] }))
rows.push(await run({ label: 'bare text, nothing on', where: 'head', off: ALL.filter(n => n !== 'wrap'), widgets: false }))

const pad = (s, n) => String(s).padEnd(n), num = (s, n) => String(s).padStart(n)
console.log(`\nkeystroke → paint, real window, 1.05 MB, 130 wpm; bracketed [painting frame .. the frame after]\n`)
console.log(pad('condition', 24) + pad('where', 34) + num('p50', 14) + num('p95', 14) + num('p99', 14) + num('js p99', 9) + num('long', 6))
console.log('─'.repeat(115))
for (const r of rows) {
  console.log(pad(r.label, 24) + pad(r.note, 34) +
    num(`${r.low[0]}–${r.high[0]}`, 14) + num(`${r.low[1]}–${r.high[1]}`, 14) +
    num(`${r.low[2]}–${r.high[2]}`, 14) + num(r.proc[2], 9) + num(r.long, 6))
}
await browser.close()
