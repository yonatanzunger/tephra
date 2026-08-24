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

import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PrintJob } from '../shared/ipc.ts'
import { dayDir, LOCAL } from './w/layout.ts'

/**
 * Render a passage and show it, ready to print or save.
 *
 * Returns false when the job could not be rendered at all, so Z can say so
 * rather than leaving a reader believing something is on its way to a printer.
 */
export async function printPassage(root: string, job: PrintJob): Promise<boolean> {
  // Relative links resolve from the day the passage came from — an attachment
  // is written as `../../../attachments/…` relative to its day file. Without
  // this every image in a printed passage silently fails to load, which is
  // Spike B's fourth trap and belongs to the document rather than to the shell.
  const base = pathToFileURL(join(root, dayDir(job.segment)) + '/').href

  const document = `<!doctype html>
<html><head><meta charset="utf-8"><base href="${base}">
<title>${escape(job.title)}</title>
<style>${job.css}</style>
</head><body><main>
<header><div class="who">Tephra &middot; ${escape(job.title)}</div></header>
${job.html}
</main></body></html>`

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
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    await viewer.loadURL(pathToFileURL(at).href)
    viewer.show()
    return true
  } finally {
    offscreen.destroy()
  }
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
