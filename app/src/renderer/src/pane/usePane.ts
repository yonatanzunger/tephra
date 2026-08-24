// Binding React to the Pane.
//
// Through useSyncExternalStore against the Pane's OWN subscription API, not by
// mirroring its state into React state. Mirroring would create a second source
// of truth, which is the thing this design refuses everywhere else and would
// refuse here for the same reason (D39).

import { useSyncExternalStore } from 'react'
import type { Pane } from './pane'
import type { BoundaryState, NavTarget } from '../../../shared/pane-api.ts'
import type { DocumentWindow } from '../../../shared/document-api.ts'

export function usePaneWindow(pane: Pane | null): DocumentWindow | null {
  return useSyncExternalStore(
    onChange => (pane === null ? () => undefined : pane.onWindowChanged(onChange)),
    () => pane?.window ?? null,
  )
}

export function usePaneLocation(pane: Pane | null): NavTarget | null {
  return useSyncExternalStore(
    onChange => (pane === null ? () => undefined : pane.onLocationChanged(onChange)),
    () => pane?.location ?? null,
  )
}

/**
 * Cached, because useSyncExternalStore compares snapshots by identity and
 * `pane.boundary` builds a fresh object each call — returning a new one every
 * render is an infinite loop, not a subtle inefficiency.
 */
let boundaryCache: { earlier: BoundaryState; later: BoundaryState } | null = null
let boundaryKey = ''

export function usePaneBoundary(pane: Pane | null): { earlier: BoundaryState; later: BoundaryState } | null {
  return useSyncExternalStore(
    onChange => (pane === null ? () => undefined : pane.onBoundaryChanged(onChange)),
    () => {
      if (pane === null) return null
      const next = pane.boundary
      const key = JSON.stringify(next)
      if (key !== boundaryKey) {
        boundaryKey = key
        boundaryCache = next
      }
      return boundaryCache
    },
  )
}
