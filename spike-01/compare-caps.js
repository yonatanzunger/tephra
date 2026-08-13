// Fold the collected capability reports into one table.
import fs from 'node:fs'
const files = process.argv.slice(2)
const runs = files.map(f => ({ label: f.replace(/.*caps-/, '').replace('.json', ''), data: JSON.parse(fs.readFileSync(f, 'utf8')) }))
const keys = [...new Set(runs.flatMap(r => Object.keys(r.data)))].filter(k => !k.startsWith('_'))
const w = Math.max(...keys.map(k => k.length)) + 2
const cw = Math.max(18, ...runs.map(r => r.label.length + 2))
const cell = v => v === true ? 'yes' : v === false ? 'NO' : String(v)
console.log('capability'.padEnd(w) + runs.map(r => r.label.padStart(cw)).join(''))
console.log('─'.repeat(w + cw * runs.length))
for (const k of keys) {
  console.log(k.padEnd(w) + runs.map(r => cell(r.data[k]).padStart(cw)).join(''))
}
