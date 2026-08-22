// The frame's width arithmetic (D42).
//
// One calculation, deliberately. The frame studies got this wrong once in a way
// worth remembering: availability asked "does the stream's minimum fit?" in one
// place while a CSS clamp chose the actual width in another. At 1440px they
// disagreed — the check waved it through at 210px, the clamp took 288px, and the
// annotation gutter went 58px off the right edge. Two computations of the same
// quantity is the bug, not the arithmetic. So `streamWidth` returns both answers
// at once: zero means refused, and anything else is exactly the width to use.
//
// Nothing here touches the DOM, so the rules can be tested at widths no screen
// on this desk has.

/** What the reading area must have to lay out text and its annotation gutter. */
export interface ReadingNeed {
  /** The text measure, in px. */
  measure: number
  /** The reserved annotation gutter, in px. */
  gutter: number
  /** Space between the two, in px. */
  gap: number
  /** Breathing room either side of the reading area, in px, total. */
  padding: number
}

export interface StreamBounds {
  /** The narrowest useful capture column; the overlay is never thinner. */
  min: number
  /** Its preferred width; more space than this goes to slack, not to the stream. */
  max: number
}

export const STREAM_BOUNDS: StreamBounds = { min: 210, max: 300 }

/** Never let the stream take more than this share of a small window. */
const STREAM_MAX_SHARE = 0.42

export function readingNeed(need: ReadingNeed): number {
  return need.measure + need.gap + need.gutter + need.padding
}

/**
 * How wide the capture stream is. **It is always available** — see the note on
 * occlusion below.
 *
 * The earlier rule refused to open it when there was no slack, on the grounds
 * that the annotation gutter must never yield. That protected the wrong thing.
 * The invariant this frame exists to keep is that **nothing moves**, and the
 * gutter yielding would have meant *reflow* — every line rewrapping, which is
 * unrecoverable and is what makes text unreadable. Occlusion is not reflow: the
 * overlay covers pixels, moves nothing, and closing it puts everything back
 * exactly where it was.
 *
 * It also matched the wrong use. This surface exists to be typed into almost
 * blindly while reading something else, so a laptop — where it was refused at
 * every width the screen can produce — is precisely where it is most wanted.
 */
export function streamWidth(frameWidth: number, bounds: StreamBounds = STREAM_BOUNDS): number {
  if (frameWidth <= 0) return bounds.min
  const share = Math.floor(frameWidth * STREAM_MAX_SHARE)
  return Math.max(bounds.min, Math.min(bounds.max, share))
}

/**
 * How much of the text and its gutter the stream covers, in px. Zero when the
 * window is wide enough that the overlay lands on empty paper — which is what
 * makes one mechanism serve both cases without a mode to switch between.
 */
export function streamOcclusion(
  frameWidth: number,
  navWidth: number,
  need: ReadingNeed,
  bounds: StreamBounds = STREAM_BOUNDS,
): number {
  const slack = frameWidth - navWidth - readingNeed(need)
  return Math.max(0, streamWidth(frameWidth, bounds) - Math.max(0, slack))
}

/**
 * Whether the annotation gutter fits beside the text at all. Below this the
 * gutter collapses and marginal notes fold beneath the paragraph they belong
 * to — position is the right thing to give up first, and legibility is not.
 *
 * This band existed unhandled in the frame studies: the layout stopped fitting
 * around 1211px while the collapse rule only fired at 860px, so for 350px of
 * width the gutter simply hung off the right edge in every arrangement.
 */
export function gutterFits(frameWidth: number, navWidth: number, need: ReadingNeed): boolean {
  return frameWidth - navWidth >= readingNeed(need)
}
