// Putting a passage on paper.
//
// Spike B measured this in both shells and the finding was that the work lives
// in the web layer — markdown to HTML plus a print stylesheet — while the shell
// contributes a window and a panel. So this file is deliberately small: it is
// the shell's whole contribution.
//
// **It shows a PDF rather than opening the print dialog directly**, which is
// the one place the spike found Electron behind the native shell: macOS's print
// panel previews the document and Chromium's does not. Rendering to PDF and
// handing it to Chromium's own viewer gets the preview back — with page
// thumbnails, zoom, and a print button — for a few lines, and the spike
// recorded it as the answer before this was built.

import { app, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PrintJob } from '../shared/ipc.ts'
import { dayDir, LOCAL } from './w/layout.ts'
import { verifyMode } from './verify-mode.ts'

/**
 * Render a passage and show it, ready to print or save.
 *
 * Returns false when the job could not be rendered at all, so Z can say so
 * rather than leaving a reader believing something is on its way to a printer.
 */
/**
 * paged.js, read from the package and inlined into the print document.
 *
 * **Inlined rather than linked, and read here rather than bundled.** The print
 * document is written to a temp file and loaded from `file://`; a `<script
 * src>` would have to resolve against that, and the renderer bundle has no way
 * to hand over a library as text. Reading the dist file in main is the one
 * place that can. It is also why this is confined to the print path — a
 * megabyte of pagination has no business in the editor's bundle.
 */
function pagedPolyfill(): string | null {
  for (const candidate of [
    join(process.cwd(), 'node_modules/pagedjs/dist/paged.polyfill.min.js'),
    join(app.getAppPath(), 'node_modules/pagedjs/dist/paged.polyfill.min.js'),
  ]) {
    try {
      return readFileSync(candidate, 'utf8')
    } catch {
      continue
    }
  }
  return null // printing without pagination is a worse page, not a failure
}

export async function printPassage(root: string, job: PrintJob): Promise<boolean> {
  // Relative links resolve from the day the passage came from — an attachment
  // is written as `../../../attachments/…` relative to its day file. Without
  // this every image in a printed passage silently fails to load, which is
  // Spike B's fourth trap and belongs to the document rather than to the shell.
  const base = pathToFileURL(join(root, dayDir(job.segment)) + '/').href

  // Pagination is only asked for when something needs it — a footnote has to
  // know which page its anchor fell on, and nothing else here does.
  const polyfill = job.paginate === true ? pagedPolyfill() : null
  const paginated = polyfill !== null

  const document = `<!doctype html>
<html><head><meta charset="utf-8"><base href="${base}">
<title>${escape(job.title)}</title>
<style>${job.css}</style>
</head><body><main>
<header><div class="who">Tephra &middot; ${escape(job.title)}</div></header>
${job.html}
</main>${
    // **`auto: false`, and this is not a detail.** The polyfill paginates by
    // itself as soon as it loads; calling `preview()` afterwards then ran it a
    // SECOND time, over its own output — which produced pages (so the check
    // for pages passed) with the footnotes flattened back into the flow. One
    // run, started by us, so there is something to await.
    paginated ? `<script>window.PagedConfig = { auto: false }</script><script>${polyfill}</script>` : ''
  }</body></html>`

  const offscreen = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  try {
    // **Written to a file and loaded as one, not handed over as a data: URL.**
    // A data: URL has an opaque origin, so the `<base href>` above resolves to
    // nothing it is allowed to fetch and every image in the passage arrives
    // broken — the same failure Spike B recorded, wearing a different hat. From
    // a file:// origin the base resolves and the images load.
    const source = join(root, LOCAL.printSource)
    await writeFile(source, document)
    await offscreen.loadURL(pathToFileURL(source).href)
    // KaTeX and any images have to have finished before the page is measured.
    await offscreen.webContents.executeJavaScript(
      'document.fonts.ready.then(() => Promise.all([...document.images].map(' +
        'i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r }))))',
    )

    // **Wait for the pages to exist, rather than for a moment to pass.**
    // paged.js rewrites the whole document into page boxes asynchronously; a
    // PDF taken before it finishes is the unpaginated flow, which looks almost
    // right and has no footnotes in it.
    if (paginated) {
      const report = (await offscreen.webContents.executeJavaScript(
        `(async () => {
           const done = window.PagedPolyfill?.preview?.()
           if (done !== undefined) await done
           const areas = [...document.querySelectorAll('.pagedjs_footnote_area')]
           const note = document.querySelector("[data-note='footnote']")
           return {
             pages: document.querySelectorAll('.pagedjs_page').length,
             marked: document.querySelectorAll('[data-note]').length,
             areas: areas.length,
             feet: areas.filter(a => a.textContent.trim() !== '').length,
             sample: areas.map(a => a.textContent.trim()).find(t => t !== '')?.slice(0, 60) ?? '',
             where: note === null ? 'none' : (note.closest('[class*=pagedjs]')?.className ?? 'loose'),
             note: note === null ? 'none' : note.innerHTML.slice(0, 90),
             area: areas[0]?.innerHTML.slice(0, 120) ?? 'none',
           }
         })()`,
      )) as {
        pages: number
        marked: number
        areas: number
        feet: number
        sample: string
        where: string
        note: string
        area: string
      }
      if (verifyMode()) {
        console.log(
          `VERIFY-MAIN pagedPages=${report.pages} footnoteAreas=${report.feet} ` +
            `marked=${report.marked} areas=${report.areas} where=${report.where} ` +
            `sample=${JSON.stringify(report.sample)} note=${JSON.stringify(report.note)} ` +
            `area=${JSON.stringify(report.area)}`,
        )
      }
    }

    const pdf = await offscreen.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    })
    const at = join(root, LOCAL.print)
    await writeFile(at, pdf)

    const viewer = new BrowserWindow({
      width: 860,
      height: 1000,
      title: job.title,
      show: false,
      paintWhenInitiallyHidden: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    await viewer.loadURL(pathToFileURL(at).href)
    // **Not shown in verification mode**, and this was the last way an
    // acceptance run could reach across and take the machine: the main windows
    // are hidden for the whole run, but the print preview made its own window
    // and it both surfaced AND took focus — over whatever the person at the
    // keyboard was doing, several times per suite. The PDF is written either
    // way, which is what the suites actually assert.
    if (!verifyMode()) viewer.show()
    return true
  } finally {
    offscreen.destroy()
  }
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
