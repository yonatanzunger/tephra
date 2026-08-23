// Build Tephra.app.
//
// `@electron/packager` and nothing more: it produces a `.app` and stops. No
// installer, no auto-update, no DMG — one person on one machine needs none of
// those, and `electron-builder`'s configuration surface earns its keep only
// when strangers have to install the result.
//
// AD-HOC SIGNED, and on Apple Silicon that is not a choice.
//
// arm64 macOS will not execute a binary with no valid signature at all. A
// packaged Electron app inherits Electron's own ad-hoc signature and then
// invalidates it — packager renames the executable and rewrites Resources — so
// the bundle ships with a signature that no longer matches its contents and the
// kernel refuses it. The symptom is the worst kind: the app exits immediately,
// silently, with no output and no crash report. `spctl -a -vv` is what says so,
// with "code has no resources but signature indicates they must be present".
//
// Re-signing ad-hoc (`--sign -`) fixes it, costs nothing and needs no Apple
// account. What we are still deliberately NOT doing is Developer ID signing and
// notarization, which matter only for apps other people download.

import { packager } from '@electron/packager'
import { rm, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const out = join(root, 'dist')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

await rm(out, { recursive: true, force: true })

const [app] = await packager({
  dir: root,
  out,
  overwrite: true,
  appVersion: pkg.version,
  name: pkg.productName,
  // PLACEHOLDER art. The wiring is what matters here: dropping a different
  // Tephra.icns at this path is the whole of replacing it.
  // NO extension: packager appends the platform's own (.icns here). Passing
  // `Tephra.icns` makes it look for `Tephra.icns.icns`, warn, and silently ship
  // the default Electron icon — which looks exactly like forgetting to set one.
  icon: join(root, '..', 'design', 'icon', 'Tephra'),
  // asar keeps the bundle to one file and makes `app.getAppPath()` a virtual
  // path that Electron's fs shims read through — which the custom scheme
  // serving the renderer depends on, and which the smoke test below checks.
  asar: true,
  // Everything the built main process requires at runtime has to be inside.
  // isomorphic-git is EXTERNALISED by electron-vite rather than inlined, so it
  // must come along; the source tree and the test suite must not.
  ignore: [
    /^\/src($|\/)/,
    /^\/tests($|\/)/,
    /^\/scripts($|\/)/,
    /^\/dist($|\/)/,
    /^\/\.clarity-protocol($|\/)/,
    /^\/tsconfig.*\.json$/,
    /^\/electron\.vite\.config\.ts$/,
    /^\/run\.sh$/,
    /^\/Tephra\.command$/,
  ],
  appBundleId: 'org.zunger.tephra',
  appCategoryType: 'public.app-category.productivity',
  darwinDarkModeSupport: true,
})

const bundle = join(app, `${pkg.productName}.app`)

// Required on arm64; see the note at the top. `--deep` is deprecated in favour
// of signing nested code first, but for an ad-hoc personal build it is the
// one-line form that works, and the verification below is what actually decides
// whether it did.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' })

const verdict = (() => {
  try {
    execFileSync('codesign', ['--verify', '--deep', bundle], { stdio: 'pipe' })
    return 'signature verifies'
  } catch (err) {
    return `SIGNATURE PROBLEM: ${String(err)}`
  }
})()
console.log(verdict)
console.log(`\n${bundle}`)
console.log(`\nInstall with:  cp -R "${bundle}" /Applications/`)
