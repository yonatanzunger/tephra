// The app serves itself from a custom scheme (D17, T8).
//
// Not file://, which WKWebView blocks from fetching siblings and which Chromium
// gives an opaque origin. Not a localhost server, which is reachable by every
// other process on the machine — and this corpus holds other people's
// information. A custom scheme needs no port and has no listener.

import { protocol, net } from 'electron'
import { resolve } from 'node:path'
import { resolveWithinRoot } from './paths.js'
import { pathToFileURL } from 'node:url'

export const SCHEME = 'tephra'
export const APP_ORIGIN = `${SCHEME}://app`

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

/** Serve the built renderer. Call after app.whenReady(). */
export function serveRenderer(rendererDir: string): void {
  const root = resolve(rendererDir)

  protocol.handle(SCHEME, req => {
    const target = resolveWithinRoot(root, new URL(req.url).pathname)
    if (target === null) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(target).toString())
  })
}
