import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const pub = path.join(root, 'public')

// KaTeX ships its own CSS + fonts; copy them rather than inlining.
const kv = path.join(pub, 'vendor', 'katex')
fs.rmSync(kv, { recursive: true, force: true })
fs.cpSync(path.join(root, 'node_modules', 'katex', 'dist'), kv, { recursive: true })

const opts = {
  entryPoints: [path.join(root, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari15', 'chrome100'],
  outfile: path.join(pub, 'bundle.js'),
  sourcemap: true,
  minify: !process.argv.includes('--serve'),
  logLevel: 'info',
}

const serve = process.argv.includes('--serve')
if (!serve) {
  await esbuild.build(opts)
  const { size } = fs.statSync(opts.outfile)
  console.log(`bundle.js: ${(size / 1024).toFixed(0)} KB`)
} else {
  const ctx = await esbuild.context(opts)
  await ctx.watch()

  const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
  }
  const PORT = 8321
  http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/') p = '/index.html'
    const file = path.join(pub, path.normalize(p).replace(/^(\.\.[/\\])+/, ''))
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      res.end(data)
    })
  }).listen(PORT, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address)
    console.log(`\n  Spike A:  http://localhost:${PORT}`)
    for (const ip of ips) console.log(`  on phone: http://${ip}:${PORT}`)
    console.log()
  })
}
