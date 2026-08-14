// Temporary: launch the production build and read the renderer's own report.
import { spawn } from 'node:child_process'
const child = spawn('./node_modules/.bin/electron', ['out/main/index.js'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', TEPHRA_VERIFY: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
child.stdout.on('data', d => { out += d })
child.stderr.on('data', d => { out += d })
setTimeout(() => { child.kill(); console.log(out.trim() || '(no output)'); process.exit(0) }, 9000)
