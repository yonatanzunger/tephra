// **Shell tier.** Wiring, and nothing else.
//
// Every channel the renderer can reach is *declared* by the service that owns it
// and *registered* here (D83). What is in this file is the loop that walks the
// declarations, one entry point per composition root, and the per-window sink
// that carries pushed messages to a renderer.
//
// **The one decision it still makes** is which door a channel is registered at:
// `ipcMain.handle` answers an `invoke` and is deaf to a `send`, and a service
// says which it is (`serves.ts`, `told`).

import { BrowserWindow, ipcMain } from 'electron'
import { claim, type Serves } from '../services/serves.ts'
import type { NotebookService } from '../services/notebook-service.ts'

/**
 * Register what the services declare (D83).
 *
 * **Nothing here decides anything.** A service says which channels it answers
 * on; this walks the declarations and hands each to Electron. The duplicate
 * check is `claim`'s, so *each channel belongs to exactly one service* fails at
 * startup rather than being a sentence in a design document.
 *
 * Called once per composition root, because the two are ready at different
 * moments: the notebook's services exist as soon as the notebook is open, and the
 * shell's need a window factory.
 */
export function wire(services: readonly Serves[]): void {
  for (const [channel, served] of claim(services)) {
    // **Told or asked, and it has to be one or the other.** `ipcMain.handle` is
    // deaf to `ipcRenderer.send` and `ipcMain.on` cannot reply, so a channel
    // registered at the wrong door fails in total silence (`serves.ts`, `told`).
    if (served.told === true) {
      ipcMain.on(channel, (event, ...args: unknown[]) => {
        if (served.wantsAsker === true) served.answer(event.sender.id, ...args)
        else served.answer(...args)
      })
      continue
    }
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      // **The asker is a number, and only when asked for.** A service may not
      // import Electron, so the one thing it can be told about the caller is an
      // id — which is all anybody needs: it says *which window*, and a window is
      // what a search cursor belongs to.
      served.wantsAsker === true
        ? served.answer(event.sender.id, ...args)
        : served.answer(...args),
    )
  }
}

/**
 * Carry pushed messages to one renderer, for as long as its window lives.
 *
 * The other direction of the boundary: `wire` is what the renderer asks, this is
 * what main says without being asked. A sink rather than a channel list, because
 * the bus does not know or care what it is pushing (D83).
 */
export function attachWindow(service: NotebookService, window: BrowserWindow): void {
  const detach = service.addSink({
    send: (channel, message) => {
      if (!window.isDestroyed()) window.webContents.send(channel, message)
    },
  })
  window.on('closed', detach)
}
