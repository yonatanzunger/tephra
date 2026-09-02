// Where this machine is, asked of the machine rather than of this process.
//
// **This is why two windows disagreed.** `Intl.DateTimeFormat().resolvedOptions()`
// answers with the zone the JavaScript context was created in — V8 resolves the
// host zone once and caches it — so a window opened before somebody changed the
// system setting and a window opened after it give different answers, forever.
// Two Tephra windows sat side by side offering to move the notebook in opposite
// directions. The zone is offered and never applied (D63), but an offer that
// contradicts itself is worse than no offer at all.
//
// **So main asks, and main tells**, which is the rule the published `zone`
// already follows and for the same reason: a renderer working out its own idea
// of where it is, while main files by another, is exactly the disagreement this
// arrangement exists to prevent.

import { readlinkSync } from 'node:fs'

/** `/etc/localtime` points into the zone database, and the tail is the name. */
const ZONEINFO = /\/zoneinfo\/(.+)$/

/**
 * The zone this machine is set to, right now.
 *
 * On darwin and linux the setting is a symlink, and reading it goes to the
 * operating system every time — which is the whole point, since the question is
 * only ever interesting when the answer has just changed. Anywhere else, and
 * anywhere the link is a copied file instead, the cached answer is what there
 * is: stale at worst, and stale-but-consistent is what the caller needs.
 */
export function systemZone(): string {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try {
      const named = ZONEINFO.exec(readlinkSync('/etc/localtime'))?.[1]
      if (named !== undefined) return named
    } catch {
      // No symlink to read. Fall through to what this process was told.
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
