// The app serves itself from a custom scheme (D17, T8).
//
// Not file://, which WKWebView blocks from fetching siblings and which Chromium
// gives an opaque origin. Not a localhost server, which is reachable by every
// other process on the machine — and this corpus holds other people's
// information. A custom scheme needs no port and has no listener.

import { protocol, net } from 'electron'
import { resolve } from 'node:path'
import { resolveWithinRoot } from './paths.ts'
import { pathToFileURL } from 'node:url'
import { SCHEME } from '../shared/scheme.ts'

export { APP_ORIGIN, NOTEBOOK_ORIGIN, SCHEME } from '../shared/scheme.ts'

/**
 * MUST be called before app.whenReady(). Electron requires the privilege
 * declaration up front; `secure: true` is what makes the origin a secure
 * context, and without `standard: true` relative URLs do not resolve.
 */
export function declareScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ])
}

/**
 * Serve the built renderer, and the notebook's own files beside it.
 *
 * **One handler, two hosts**, because a scheme gets one handler: `app` is the
 * bundle and `notebook` is the corpus (R7). The notebook root arrives later than
 * the renderer's — it is not known until a notebook is opened — so it is a thunk
 * rather than a path.
 */
export function serveRenderer(rendererDir: string, notebookRoot: () => string | null): void {
  const root = resolve(rendererDir)

  protocol.handle(SCHEME, req => {
    const url = new URL(req.url)
    const base = url.host === 'notebook' ? notebookRoot() : root
    if (base === null) return new Response('no notebook', { status: 404 })
    const target = resolveWithinRoot(resolve(base), decodeURIComponent(url.pathname))
    if (target === null) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(target).toString())
  })
}
