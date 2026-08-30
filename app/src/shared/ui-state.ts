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

/**
 * One window: what it was showing, and where it sat.
 *
 * **The unit of restoring is a WINDOW, not the app.** Someone who left a note
 * open beside the stream left an arrangement, and reopening only the last one
 * they touched throws the arrangement away (D54, MC6).
 */
export interface WindowState {
  readonly location: NavTarget
  readonly cursor: StoredCursor | null
  /** Where the window sat on screen. Absent when the platform did not say. */
  readonly bounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

export interface UiState {
  readonly version: 1
  /**
   * Every window that was open, in the order they were opened.
   *
   * Never empty when written; an empty set on read means "no session to
   * restore", and the app opens the one window it opens on a first run.
   */
  readonly windows: readonly WindowState[]
  /** Vim on or off, which is a setting and not a position (D15). */
  readonly vim: boolean
  /**
   * The active theme's name. Machine-local on purpose (D41): which rendering
   * suits depends on the screen and the light in the room, so definitions are
   * authored and durable while selection is soft state.
   */
  readonly theme: string
}

export const defaultWindowState: WindowState = { location: { kind: 'today' }, cursor: null }

export const defaultUiState: UiState = {
  version: 1,
  windows: [defaultWindowState],
  vim: false,
  theme: DEFAULT_THEME_NAME,
}

/** Lenient: a corrupt or older file means "start fresh", never a crash. */
export function parseUiState(text: string | null): UiState {
  if (text === null) return defaultUiState
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return defaultUiState
    const candidate = parsed as Partial<UiState> & Partial<WindowState>
    if (candidate.version !== 1) return defaultUiState

    // **A file from before windows were a set still opens the window it named.**
    // The alternative is losing the reader's place to a schema change, which is
    // the one thing soft state is not allowed to cost.
    const windows =
      Array.isArray(candidate.windows) && candidate.windows.length > 0
        ? candidate.windows.filter(isWindowState)
        : candidate.location !== undefined
          ? [{ location: candidate.location, cursor: candidate.cursor ?? null }]
          : []
    if (windows.length === 0) return defaultUiState

    return {
      version: 1,
      windows,
      vim: candidate.vim === true,
      theme: typeof candidate.theme === 'string' && candidate.theme !== '' ? candidate.theme : DEFAULT_THEME_NAME,
    }
  } catch {
    return defaultUiState
  }
}

/** Lenient in the same way: one unreadable entry loses one window, not the set. */
function isWindowState(value: unknown): value is WindowState {
  return typeof value === 'object' && value !== null && 'location' in value
}
