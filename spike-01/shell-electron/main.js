// Spike B — Electron shell, the control arm.
//
// Same two operations, same page, same three load modes as the Swift shell, so
// the only thing being compared is what each shell costs. Sections are marked
// so tools/count.sh can attribute lines per operation.

const { app, BrowserWindow, ipcMain, protocol, clipboard, net, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

// MARK: begin infrastructure — window, app lifecycle, menus (out of scope per the plan)

const MODE = process.argv.find(a => ['localhost', 'file', 'scheme'].includes(a)) || 'localhost'
const PAGE = process.env.TEPHRA_PAGE || 'index.html'
const PUBLIC = process.env.TEPHRA_PUBLIC || path.resolve(__dirname, '../editor/public')
const NOTES = process.env.TEPHRA_NOTES || path.join(__dirname, 'notes')
const SELFTEST = !!process.env.TEPHRA_SELFTEST

let win

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 950,
    title: `Tephra — spike B (electron, ${MODE})`,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false },
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' },
  ]))
  win.loadURL(startURL())
}

// MARK: end infrastructure

// MARK: begin loadmode — serving the app's own assets three ways

// Electron requires the privilege declaration before app-ready; `secure: true`
// is the explicit opt-in that WKWebView has no equivalent for (and, as it turns
// out, does not need).
protocol.registerSchemesAsPrivileged([{
  scheme: 'tephra',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

function registerScheme() {
  protocol.handle('tephra', req => {
    const url = new URL(req.url)
    const rel = url.pathname === '/' ? '/' + PAGE : url.pathname
    return net.fetch(pathToFileURL(path.join(PUBLIC, rel)).toString())
  })
}

function startURL() {
  if (MODE === 'file') return pathToFileURL(path.join(PUBLIC, PAGE)).toString()
  if (MODE === 'scheme') return `tephra://app/${PAGE}`
  return `http://localhost:8321/${PAGE}`
}

// MARK: end loadmode

// MARK: begin bridge — exposing native operations to the page
// (the other half is preload.js, counted with it)

ipcMain.handle('tephra:print', (_e, html) => doPrint(html))
ipcMain.handle('tephra:pasteImage', () => pasteImageFromClipboard())
ipcMain.handle('tephra:report', (_e, json) => { process.stdout.write('CAPS ' + json + '\n'); return { ok: true } })

// MARK: end bridge

// MARK: begin print — render the range's HTML in an offscreen window and print it

async function doPrint(html) {
  const printer = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
  const tmp = path.join(app.getPath('temp'), `tephra-print-${Date.now()}.html`)
  fs.writeFileSync(tmp, html)
  await printer.loadFile(tmp)

  const pdfPath = process.env.TEPHRA_PDF
  if (pdfPath) {                       // test-only branch
    const data = await printer.webContents.printToPDF({
      pageSize: 'Letter', printBackground: true,
      margins: { marginType: 'custom', top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
    })
    fs.writeFileSync(pdfPath, data)
    printer.destroy(); fs.unlinkSync(tmp)
    return { ok: true, pdf: pdfPath, bytes: data.length }
  }

  // Electron's print dialog has no preview; the native panel does. Rendering to
  // PDF first and showing it in Chromium's own PDF viewer buys the preview back,
  // and the viewer already carries a print button of its own.
  const data = await printer.webContents.printToPDF({
    pageSize: 'Letter', printBackground: true,
    margins: { marginType: 'custom', top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
  })
  printer.destroy(); fs.unlinkSync(tmp)
  const pdf = path.join(app.getPath('temp'), `tephra-preview-${Date.now()}.pdf`)
  fs.writeFileSync(pdf, data)

  const preview = new BrowserWindow({ width: 760, height: 940, title: 'Print preview' })
  await preview.loadFile(pdf)
  previewShot(preview)
  return { ok: true, preview: true, pages: data.length }
}

async function previewShot(win) {          // test-only verification
  if (!process.env.TEPHRA_PREVIEW_SHOT) return
  await new Promise(r => setTimeout(r, 2500))
  const img = await win.capturePage()
  fs.writeFileSync(process.env.TEPHRA_PREVIEW_SHOT, img.toPNG())
  console.log('PREVIEW captured', process.env.TEPHRA_PREVIEW_SHOT)
}

// MARK: end print

// MARK: begin paste — read the system clipboard, write a file, return a link

function pasteImageFromClipboard() {
  const img = clipboard.readImage()
  if (!img || img.isEmpty()) return null
  const bytes = img.toPNG()
  fs.mkdirSync(NOTES, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..*/, '')
  const dest = path.join(NOTES, `pasted-${stamp}.png`)
  fs.writeFileSync(dest, bytes)
  return { path: dest, bytes: bytes.length, markdown: `![pasted image](${dest})` }
}

// MARK: end paste

// MARK: begin infrastructure2 — wiring and the test driver

app.whenReady().then(() => {
  registerScheme()
  createWindow()
  if (!SELFTEST) return
  win.webContents.once('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 2500))
    const js = async code => win.webContents.executeJavaScript(code)
    try {
      console.log('SELFTEST selected', await js('window.spikeSelect(0, 1400)'), 'chars')
      console.log('SELFTEST print ->', JSON.stringify(await js('window.spikePrint()')))
      console.log('SELFTEST paste ->', JSON.stringify(await js('window.spikePaste()')))
    } catch (e) {
      console.log('SELFTEST failed:', e.message)
    }
    setTimeout(() => app.quit(), process.env.TEPHRA_PREVIEW_SHOT ? 7000 : 800)
  })
})
app.on('window-all-closed', () => app.quit())

// MARK: end infrastructure2
