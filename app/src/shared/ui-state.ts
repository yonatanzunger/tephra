// What survives a restart. Pane state, serialised (pane-api.md).
//
// R1.2 asks that scroll position, cursor and the open view survive app
// switches and crashes. This is the concrete form of that for v1.
//
// THE CURSOR IS STORED AS (segment, offset), NOT as a buffer offset. A buffer
// offset is meaningless across sessions — the next window may load a different
// range, so the same number would name different text. D11 forbids positional
// addressing for anything durable, with one deliberate exception: soft state
// like this, "precisely because being wrong is cheap and self-correcting". The
// reader lands slightly off and scrolls.
//
// MACHINE-LOCAL for v1 (D30). R1.2's "device changes" implies some of this
// should sync, which contradicts `.tephra/` being machine-local; that is left
// open deliberately, and v1 has no sync to force the question.

import type { DateKey } from './document-api.ts'
import type { NavTarget } from './pane-api.ts'
import { DEFAULT_THEME_NAME } from './theme.ts'

export interface StoredCursor {
  readonly segment: DateKey
  readonly offset: number
}

export interface UiState {
  readonly version: 1
  readonly location: NavTarget
  readonly cursor: StoredCursor | null
  /** Vim on or off, which is a setting and not a position (D15). */
  readonly vim: boolean
  /**
   * The active theme's name. Machine-local on purpose (D41): which rendering
   * suits depends on the screen and the light in the room, so definitions are
   * authored and durable while selection is soft state.
   */
  readonly theme: string
}

export const defaultUiState: UiState = {
  version: 1,
  location: { kind: 'today' },
  cursor: null,
  vim: false,
  theme: DEFAULT_THEME_NAME,
}

/** Lenient: a corrupt or older file means "start fresh", never a crash. */
export function parseUiState(text: string | null): UiState {
  if (text === null) return defaultUiState
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return defaultUiState
    const candidate = parsed as Partial<UiState>
    if (candidate.version !== 1 || candidate.location === undefined) return defaultUiState
    return {
      version: 1,
      location: candidate.location,
      cursor: candidate.cursor ?? null,
      vim: candidate.vim === true,
      theme: typeof candidate.theme === 'string' && candidate.theme !== '' ? candidate.theme : DEFAULT_THEME_NAME,
    }
  } catch {
    return defaultUiState
  }
}
