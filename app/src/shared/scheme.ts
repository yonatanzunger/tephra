// The app's own URL scheme (D17), and what it means for a picture (R7).
//
// **Shared, because three sides speak it.** Main registers the scheme and serves
// both hosts; the renderer points `<img>` elements at the notebook host; and the
// origin check that keeps a stray link from navigating the app away compares
// against `APP_ORIGIN`. The names were in main, which meant the renderer knew
// the string by having it written out again.
//
// Not `file://`, which WKWebView blocks from fetching siblings and which
// Chromium gives an opaque origin. Not a localhost server, which every other
// process on the machine can reach — and this corpus holds other people's
// information. A custom scheme needs no port and has no listener.

export const SCHEME = 'tephra'

/** The renderer bundle. */
export const APP_ORIGIN = `${SCHEME}://app`

/**
 * The corpus's own files, served read-only and rooted (R7).
 *
 * **A second host, not a second scheme**, because a scheme gets one handler. An
 * `<img>` in the editor points at a file in `attachments/`, and until this
 * existed there was nowhere for it to point: a relative src resolved against the
 * bundle, so every inline image in the app was a broken one. Inline image
 * rendering has been listed as v1 since `features.md` was written and had never
 * once worked.
 */
export const NOTEBOOK_ORIGIN = `${SCHEME}://notebook`

/**
 * A markdown image src as something an `<img>` can load.
 *
 * **Relative links stay relative in the FILE and become absolute on screen**
 * (format-spec keeps every link in the corpus relative, so the directory can be
 * moved, synced, or read by anything else). The renderer is served from
 * `tephra://app`, so a relative src resolves against the bundle — which is why
 * every inline image in this app was broken until the corpus got a host of its
 * own.
 *
 * Anything already absolute is left exactly as it is: an `http` image, or a
 * `data:` URI, is not the notebook's file to serve.
 */
export function imageSrc(src: string, base: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return src
  const parts = src.startsWith('/') ? [] : base.split('/').filter(p => p !== '')
  for (const piece of src.replace(/^\//, '').split('/')) {
    if (piece === '' || piece === '.') continue
    if (piece === '..') parts.pop()
    else parts.push(piece)
  }
  return `${NOTEBOOK_ORIGIN}/${parts.map(encodeURIComponent).join('/')}`
}
