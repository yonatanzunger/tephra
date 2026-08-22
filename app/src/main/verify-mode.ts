// One gate for every self-check affordance.
//
// The scenes, the screenshot writer, the oversized window, the menu-clicking
// IPC and the abrupt-exit lever are all genuinely useful, and they are all back
// doors: an environment variable that makes the app write a PNG to any path,
// drive its own menu bar, or terminate without saving. Individually each is
// small. Collectively they are a surface that grows every time a test needs
// something, and nobody audits a surface that has no name.
//
// So they get a name, and one switch.
//
// **`app.isPackaged` is the outer gate, and it is not overridable.** A shipped
// application has no verification affordances at all, whatever the environment
// says — which is the property worth having, because the environment is exactly
// what an attacker who can launch the app controls. Inside development, the
// switch still has to be asked for explicitly, so an ordinary `./run.sh` is
// also free of them.

import { app } from 'electron'

/**
 * True only in an unpackaged build that explicitly asked for it.
 *
 * Read once at module load: this must not be something that can be turned on
 * halfway through a session by a later `process.env` assignment.
 */
export const VERIFY_MODE: boolean =
  !app.isPackaged && process.env['TEPHRA_VERIFY_MODE'] === '1'

/**
 * Read a verification environment variable, or `undefined` when verification is
 * off — so a call site cannot accidentally honour one by forgetting the check.
 *
 * `TEPHRA_ROOT` deliberately does NOT go through here. Choosing which notebook
 * to open is ordinary configuration, not an affordance for testing, and it is
 * how `run.sh --scratch` works.
 */
export function verifyEnv(name: string): string | undefined {
  if (!VERIFY_MODE) return undefined
  return process.env[name]
}
