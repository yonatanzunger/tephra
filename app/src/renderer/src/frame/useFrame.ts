// The frame's live measurements. D42's arithmetic, connected to a real window.
//
// Everything decidable without the DOM lives in `metrics.ts` and is tested
// there. This file does only the two things that need a browser: watch the
// frame's width, and convert the typographic `ch` quantities into pixels.

import { useEffect, useMemo, useState } from 'react'
import type { Typography } from '../editor/theme'
import { gutterFits, streamOcclusion, streamWidth, type ReadingNeed } from './metrics'

/**
 * The width of one `ch` for a given font, measured rather than assumed. The
 * measure and the gutter are both specified in characters — they are
 * typographic quantities — but every comparison in `metrics.ts` is in pixels,
 * so the conversion has to happen somewhere real.
 *
 * It lives here rather than beside the arithmetic because that module states it
 * touches no DOM, and for a while it did anyway. Keeping it pure is what lets
 * the rules be tested under Node at widths no screen can produce.
 *
 * Measured from a probe rather than from `.cm-content`'s own width, which is
 * the *result* of this arithmetic and would make the input depend on the output.
 */
function measureCh(font: string, sizePx: number): number {
  const probe = document.createElement('span')
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:${font};font-size:${sizePx}px`
  probe.textContent = '0'.repeat(100)
  document.body.appendChild(probe)
  const width = probe.getBoundingClientRect().width / 100
  probe.remove()
  return width
}

/**
 * The nav's column width. Reserved whether or not the nav is drawn — that is
 * precisely what Reserved means (D42), and it is why toggling the nav cannot
 * move the text. Declared once here and handed to CSS as a custom property, so
 * the layout and the arithmetic cannot drift apart.
 */
export const NAV_WIDTH = 248

/** Breathing room either side of the reading area. 0.3in at 96dpi, total. */
export const READING_PADDING = 29 * 2

export interface FrameMetrics {
  /** How wide the capture stream is. Always positive — it is always available. */
  readonly streamMax: number
  /** How much of the text and gutter the stream covers. Zero when it lands on slack. */
  readonly streamOcclusion: number
  /** Whether the annotation gutter fits beside the text, or must fold beneath it. */
  readonly gutterFits: boolean
  /** The text measure in px, for the editor to lay out against. */
  readonly measurePx: number
  /** The reserved annotation gutter in px, including its gap. */
  readonly gutterPx: number
}

export function useFrameMetrics(
  frame: HTMLElement | null,
  typography: Typography,
): FrameMetrics {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (frame === null) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(frame)
    setWidth(frame.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [frame])

  return useMemo(() => {
    // Measured, not assumed: `ch` depends on the face as well as the size, and
    // the face is a theme parameter (D41). Taking it from `.cm-content`'s own
    // width would make the input to this arithmetic depend on its output.
    const ch = measureCh(typography.font, typography.size)
    const need: ReadingNeed = {
      measure: typography.measure * ch,
      gutter: typography.gutter * ch,
      gap: typography.gutterGap * ch,
      padding: READING_PADDING,
    }
    return {
      streamMax: streamWidth(width),
      streamOcclusion: streamOcclusion(width, NAV_WIDTH, need),
      gutterFits: gutterFits(width, NAV_WIDTH, need),
      measurePx: need.measure,
      gutterPx: need.gutter + need.gap,
    }
  }, [width, typography])
}
