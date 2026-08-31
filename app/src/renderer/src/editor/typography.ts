// How text is set: the measurements the whole app lays out from.
//
// **Not the editor's, though the editor is where it shows.** The frame sizes its
// gutters from these numbers and the theme picker edits them live, so they sit
// above any one surface — a kind that draws something other than running text
// still renders inside the same page (D41).

export interface Typography {
  font: string
  size: number
  /** The text measure, in characters. */
  measure: number
  /** The reserved annotation gutter, in characters (D42, R27). */
  gutter: number
  /** Space between the measure and the gutter, in characters. */
  gutterGap: number
  /** Line height within a paragraph. */
  leading: number
  /** Extra space at a paragraph's end, in ems. */
  paragraphSpace: number
  /** Justified, with hyphenation — or ragged right. */
  justify: boolean
}

export const defaultTypography: Typography = {
  font: "'Lora', Georgia, serif",
  size: 18,
  measure: 74,
  gutter: 19,
  gutterGap: 3,
  leading: 1.55,
  paragraphSpace: 0.5,
  justify: false,
}
