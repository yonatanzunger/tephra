// The page half of the Electron bridge. Mirrors the WKUserScript the Swift
// shell injects, so the editor sees the same window.tephra either way.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tephra', {
  name: 'electron',
  print: html => ipcRenderer.invoke('tephra:print', html),
  pasteImage: () => ipcRenderer.invoke('tephra:pasteImage'),
  report: json => ipcRenderer.invoke('tephra:report', json),
})
