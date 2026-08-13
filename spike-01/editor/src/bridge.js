// The page half of Spike B, written once and held fixed so that the only thing
// varying between shells is shell-side code. Everything here works in a plain
// browser too, via the fallbacks — which is itself part of the finding.

// ── markdown → printable HTML ───────────────────────────────────────────────
// Deliberately small. The hypothesis under test is that rendering a range for
// print belongs in the web layer in every shell, and that the shell contributes
// only the print panel and the page setup.
import katex from 'katex'

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

function inline(s) {
  let out = esc(s)
  out = out.replace(/\$([^$\n]+?)\$/g, (m, tex) => {
    try { return katex.renderToString(tex, { throwOnError: false, output: 'html' }) } catch (e) { return m }
  })
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => `<img src="${src}" alt="${esc(alt)}">`)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '<em>$1</em>')
  return out
}

export function markdownToHtml(md) {
  const lines = md.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i++; continue }

    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue }

    const dm = line.match(/^\s*\$\$(.+)\$\$\s*$/)
    if (dm) {
      try { out.push(`<div class="eq">${katex.renderToString(dm[1].trim(), { displayMode: true, throwOnError: false, output: 'html' })}</div>`) }
      catch (e) { out.push(`<pre>${esc(line)}</pre>`) }
      i++; continue
    }

    if (line.trimStart().startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]{3,}\|?\s*$/.test(lines[i + 1])) {
      const rows = []
      while (i < lines.length && lines[i].trimStart().startsWith('|')) rows.push(lines[i++])
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const body = rows
        .filter((r, n) => n !== 1)
        .map((r, n) => '<tr>' + cells(r).map(c => `<${n ? 'td' : 'th'}>${inline(c)}</${n ? 'td' : 'th'}>`).join('') + '</tr>')
        .join('')
      out.push(`<table>${body}</table>`)
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*]\s+/, ''))}</li>`)
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    out.push(`<p>${inline(line)}</p>`)
    i++
  }
  return out.join('\n')
}

const PRINT_CSS = `
  @page { size: letter; margin: 0.9in 0.85in; }
  body { font: 11.5pt/1.55 Georgia, 'Lora', serif; color: #1c1917; margin: 0; }
  h1 { font-size: 1.7em; margin: 0 0 .5em; } h2 { font-size: 1.35em; margin: 1.2em 0 .4em; }
  h3 { font-size: 1.15em; margin: 1em 0 .3em; }
  p { margin: 0 0 .75em; orphans: 3; widows: 3; }
  img { max-width: 100%; }
  table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: .92em; }
  th, td { border-bottom: 1px solid #d6d3d1; padding: .3em .6em; text-align: left; }
  th { border-bottom-width: 1.5px; }
  .eq { text-align: center; margin: 1em 0; }
  h1, h2, h3 { break-after: avoid; } table, .eq, img { break-inside: avoid; }
  .src { font-size: 8.5pt; color: #78716c; border-top: 1px solid #e7e5e4; margin-top: 2em; padding-top: .5em; }
`

export function buildPrintDocument(markdown, { title = 'Tephra', note = '' } = {}) {
  // An explicit base is not optional. Each shell renders this document somewhere
  // other than where the page lives — Electron writes it to a temp file, so every
  // relative image silently 404s without this line.
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<base href="${new URL('.', location.href).href}">
<link rel="stylesheet" href="${new URL('vendor/katex/katex.min.css', location.href).href}">
<style>${PRINT_CSS}</style></head><body>
${markdownToHtml(markdown)}
${note ? `<div class="src">${esc(note)}</div>` : ''}
</body></html>`
}

// ── the shell interface ─────────────────────────────────────────────────────
// A shell injects window.tephra before the page loads. Everything below works
// without one; the difference is what it costs the shell to do it better.
export const shell = {
  get name() { return window.tephra?.name || 'browser' },
  get present() { return !!window.tephra },
}

export async function printSelection(view) {
  const sel = view.state.selection.main
  const range = sel.empty ? null : view.state.sliceDoc(sel.from, sel.to)
  const md = range ?? view.state.sliceDoc(0, Math.min(view.state.doc.length, 4000))
  const note = range
    ? `Tephra — selection of ${range.length} characters`
    : 'Tephra — no selection; first 4 000 characters'
  const html = buildPrintDocument(md, { note })

  const t0 = performance.now()
  if (window.tephra?.print) {
    const r = await window.tephra.print(html)
    return { via: shell.name, ms: Math.round(performance.now() - t0), ...r }
  }
  // Browser fallback: a hidden iframe, because window.print() on the live page
  // would try to paginate the entire stream.
  return new Promise(resolve => {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    document.body.appendChild(frame)
    frame.srcdoc = html
    frame.onload = () => {
      setTimeout(() => {
        frame.contentWindow.focus()
        frame.contentWindow.print()
        setTimeout(() => frame.remove(), 1000)
        resolve({ via: 'browser iframe', ms: Math.round(performance.now() - t0) })
      }, 120)
    }
  })
}

// Paste. The shell path reads the system pasteboard natively — no base64 round
// trip, and it sees what the source app actually put there. The web path is the
// fallback and is what a shell-less build is stuck with.
export async function pasteImage(view, evt) {
  if (window.tephra?.pasteImage) {
    const r = await window.tephra.pasteImage()
    if (r && r.markdown) { insert(view, r.markdown); return { via: shell.name, ...r } }
    return null
  }
  const items = evt?.clipboardData?.items
  if (!items) return null
  for (const it of items) {
    if (!it.type.startsWith('image/')) continue
    const file = it.getAsFile()
    if (!file) continue
    const url = URL.createObjectURL(file)          // a browser cannot write a file
    insert(view, `![pasted image](${url})`)
    return { via: 'browser blob', bytes: file.size, note: 'blob URL — nothing was written to disk' }
  }
  return null
}

function insert(view, text) {
  const sel = view.state.selection.main
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length } })
  view.focus()
}
