// Themes: named parameter sets (D41).
//
// Four arrangements were judged against real prose in `design/type-specimen.html`
// and all four were liked, which is the finding that produced this file: there
// is no single right answer, so the answer is a set you can name, edit and keep.
//
// **These live in `config/`, inside the notebook, not in `.tephra/`.** `.tephra/`
// is machine-local and disposable — deleting it must cost nothing but a rebuild
// (D7, D30). A theme somebody crafted is authored work, and losing it on a new
// machine would be a real loss, so it belongs in the synced tree in plain files
// for the same reason the corpus does (R26).
//
// **Which theme is active is machine-local**, and lives in `ui-state.json`.
// Which rendering suits depends on the screen and the light in the room;
// definitions are durable, selection is soft state (D41).

/** Colours, as hex. Hex because a person edits these files by hand (R26). */
import { hslTriple, TAG_HUES } from './tags.ts'

export interface ThemePalette {
  readonly paper: string
  readonly ink: string
  readonly head: string
  readonly faint: string
  readonly rule: string
  readonly accent: string
  /**
   * The chrome's ground: the sidebar, the title bar, the stream panel.
   *
   * **Authored, because it was the one thing a person could not fix.** It was
   * derived as paper mixed toward ink, which gives every light theme a slightly
   * grey panel whether or not that suits it — and no amount of editing the
   * theme could change it, because the number was in the code. A panel is a
   * design decision about the app's furniture, so it is a colour somebody
   * chooses.
   *
   * **Always a real colour.** A file that omits it is given one when it is
   * READ, derived from its own paper and ink; a "derive it later" empty string
   * would have to be understood by everything downstream — the painter, the
   * swatch, and every copy made from it — forever, to save writing six
   * characters once.
   */
  readonly panel: string
  /**
   * Text ON the panel, which is not the same question as text on the page.
   *
   * **The ink is chosen against the paper.** A panel much darker than the page
   * — which is the whole reason `panel` is authorable — leaves the sidebar's
   * words set in a colour picked for a surface they are no longer on, and the
   * darker the panel the worse it gets, until the chrome is unreadable while
   * the text beside it is perfect.
   *
   * One colour, not three: the heading, body and quiet tiers are mixed from it
   * toward the panel, so they stay in step with each other and with whatever
   * ground they are on.
   */
  readonly panelInk: string
}

export interface Theme {
  readonly version: 1
  /** Slug; matches the filename, and is what `ui-state.json` stores. */
  readonly name: string
  readonly label: string
  readonly note: string

  readonly face: string
  /** Body size in px. */
  readonly size: number
  /** The text column's width, in characters. */
  readonly measure: number
  /** The reserved annotation gutter, in characters (R27, D42). */
  readonly gutter: number
  /** Space between measure and gutter, in characters. */
  readonly gutterGap: number
  readonly leading: number
  /**
   * The gap between paragraphs, in ems — which is the height of a blank line.
   *
   * **One quantity, because a reader sees one gap.** There used to be two knobs
   * either side of it: extra padding under the last line of a paragraph, and a
   * height for the blank line itself. The space you actually saw was their sum,
   * so neither number meant anything on its own and moving one to fix the gap
   * moved the other's meaning too.
   */
  readonly paragraphSpace: number
  /**
   * Whether prose is justified, or set ragged right.
   *
   * **A choice, because there is no right answer.** A justified column is the
   * book page this app takes its margins from and reads as a finished object;
   * ragged right is easier on a screen and never opens a river of white down
   * the middle of a paragraph. Which one wins depends on the measure, the face
   * and the person, and all three are already theirs to set.
   *
   * Justification brings hyphenation with it rather than leaving it a second
   * switch: unhyphenated justified text at this measure is what gives
   * justification its bad name, and nobody wants one without the other.
   */
  readonly justify: boolean
  /*
   * `lineSpace` was here, and is gone on purpose.
   *
   * It put a gap after every source line, which is right if a newline breaks a
   * paragraph and wrong if it continues one. **Markdown says it continues one**,
   * and Tephra follows markdown: consecutive lines are one paragraph, so a gap
   * between them is a gap inside a paragraph. What is left of that idea is
   * `leading`, which is how far apart the lines of one paragraph sit.
   */

  // Per-script sizing (D41). Hebrew reads uncomfortably small beside Latin at
  // the same nominal size: its letters all sit at x-height, so the eye gets no
  // size cue, and several differ only in fine detail. Carried in the format from
  // the start so adding the mechanism does not change the file shape.
  readonly hebrewFace: string
  /** Percentage applied via `size-adjust`. 100 leaves Hebrew alone. */
  readonly hebrewScale: number

  /**
   * How a tag's underline is coloured on this ground (D44, MB.1). The HUE comes
   * from the subject and never changes; these two decide whether it reads as a
   * quiet mark on cream or as a legible line on black — which is a property of
   * the page, not of the subject.
   */
  readonly tagSaturation: number
  readonly tagLightness: number

  readonly palette: ThemePalette
}

/**
 * The default. Aldine is 54ch, which on a 1512px laptop leaves enough slack
 * that the capture stream's overlay lands on empty paper rather than covering
 * the annotation gutter (D42) — and the Aldine page is the lineage the margin
 * came from in the first place (R27).
 */
export const DEFAULT_THEME_NAME = 'aldine'

export const BUILT_IN_THEMES: readonly Theme[] = [
  {
    version: 1,
    name: 'aldine',
    label: 'Aldine',
    note: 'Wide margins, a narrow measure, old-style figures. The 15th-century page this app takes its margins from.',
    face: "'Hoefler Text', Baskerville, Georgia, serif",
    size: 20,
    // 62ch, settled by reading real prose rather than sample paragraphs. It
    // costs about 96px of margin to the capture stream's overlay on a 1512px
    // laptop, which the panel showed at the time and which was judged worth it.
    measure: 62,
    gutter: 19,
    gutterGap: 3,
    leading: 1.72,
    paragraphSpace: 1.65,
    justify: false,
    hebrewFace: 'Times New Roman',
    hebrewScale: 130,
    tagSaturation: 46,
    tagLightness: 40,
    palette: {
      paper: '#faf7f0',
      ink: '#23201b',
      head: '#14120f',
      faint: '#8a8175',
      rule: '#c9c0b1',
      accent: '#7a6a4f',
      panel: '#f2ece0',
      panelInk: '#23201b',
    },
  },
  {
    version: 1,
    name: 'sage',
    label: 'Sage',
    note: 'The Clarity lineage: warm stone, an emerald accent, a moderate measure. Closest to what the app has been.',
    face: "'Iowan Old Style', Palatino, Georgia, serif",
    size: 18,
    measure: 66,
    gutter: 19,
    gutterGap: 3,
    leading: 1.58,
    paragraphSpace: 1.37,
    justify: false,
    hebrewFace: 'Times New Roman',
    hebrewScale: 130,
    tagSaturation: 42,
    tagLightness: 38,
    palette: {
      paper: '#faf9f8',
      ink: '#292524',
      head: '#44403c',
      faint: '#8a8380',
      rule: '#d6d3d1',
      accent: '#059669',
      panel: '#f1f0ee',
      panelInk: '#292524',
    },
  },
  {
    version: 1,
    name: 'night',
    label: 'Night',
    note: 'For a dark room. Charter holds up at low contrast better than a high-stroke-contrast face.',
    face: "Charter, 'Bitstream Charter', 'Iowan Old Style', Georgia, serif",
    size: 19,
    measure: 62,
    gutter: 19,
    gutterGap: 3,
    leading: 1.66,
    paragraphSpace: 1.51,
    justify: false,
    hebrewFace: 'Times New Roman',
    hebrewScale: 130,
    tagSaturation: 52,
    tagLightness: 62,
    palette: {
      paper: '#14161a',
      ink: '#d5d2cc',
      head: '#f0ede7',
      faint: '#7e8790',
      rule: '#333a42',
      accent: '#93a7bd',
      panel: '#1a1d22',
      panelInk: '#d5d2cc',
    },
  },
  {
    version: 1,
    name: 'broad',
    label: 'Broad',
    note: 'Large type, generous leading, a short measure. For tired eyes and for reading at a distance.',
    face: "ui-serif, 'New York', 'Iowan Old Style', Georgia, serif",
    size: 22,
    measure: 58,
    gutter: 19,
    gutterGap: 3,
    leading: 1.76,
    paragraphSpace: 1.77,
    justify: false,
    hebrewFace: 'Times New Roman',
    hebrewScale: 130,
    tagSaturation: 46,
    tagLightness: 40,
    palette: {
      paper: '#fbfbfa',
      ink: '#1f2124',
      head: '#101214',
      faint: '#7f858c',
      rule: '#cfd3d8',
      accent: '#3f6d8c',
      panel: '#eef1f4',
      panelInk: '#1f2124',
    },
  },
]

export function builtInTheme(name: string): Theme | null {
  return BUILT_IN_THEMES.find(theme => theme.name === name) ?? null
}

export function defaultTheme(): Theme {
  // Non-null by construction; the lookup keeps the two in step if either moves.
  return builtInTheme(DEFAULT_THEME_NAME) ?? (BUILT_IN_THEMES[0] as Theme)
}

/**
 * Lenient, like `parseUiState`: a theme file that has been hand-edited into
 * nonsense should cost a fallback value, never a crash on startup. Every field
 * falls back to the default theme's individually, so one bad number does not
 * discard a file somebody spent an evening on.
 */
export function parseTheme(text: string, name: string): Theme | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  // Array.isArray matters: an array is typeof 'object' and not null, so without
  // it `[]` parses as a theme in which every single field fell back to the
  // default — a valid-looking result from a file that is not a theme at all.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const raw = parsed as Partial<Theme> & { palette?: Partial<ThemePalette> }
  const base = defaultTheme()

  const num = (value: unknown, fallback: number, low: number, high: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(high, Math.max(low, value))
      : fallback
  const str = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() !== '' ? value : fallback

  // **Derived HERE, once, rather than everywhere it is used.** A theme written
  // before the panel was a colour omits it; giving it one at the moment it is
  // read means every consumer afterwards — the painter, the swatch, a duplicate
  // made from it — sees an ordinary colour and needs to know nothing.
  const paper = str(raw.palette?.paper, base.palette.paper)
  const ink = str(raw.palette?.ink, base.palette.ink)
  const panel = str(raw.palette?.panel, mixHex(paper, ink, 0.085))

  return {
    version: 1,
    name,
    label: str(raw.label, name),
    note: str(raw.note, ''),
    face: str(raw.face, base.face),
    tagSaturation: num(raw.tagSaturation, base.tagSaturation, 0, 100),
    tagLightness: num(raw.tagLightness, base.tagLightness, 0, 100),
    // Bounds are sanity rails, not taste: they keep a typo from producing a
    // layout with no visible text and no way back to the controls.
    size: num(raw.size, base.size, 9, 48),
    measure: num(raw.measure, base.measure, 20, 140),
    gutter: num(raw.gutter, base.gutter, 0, 60),
    gutterGap: num(raw.gutterGap, base.gutterGap, 0, 12),
    leading: num(raw.leading, base.leading, 1, 3),
    paragraphSpace: num(raw.paragraphSpace, base.paragraphSpace, 0, 4),
    justify: raw.justify === true,
    hebrewFace: str(raw.hebrewFace, base.hebrewFace),
    hebrewScale: num(raw.hebrewScale, base.hebrewScale, 50, 250),
    palette: {
      paper,
      ink,
      head: str(raw.palette?.head, base.palette.head),
      faint: str(raw.palette?.faint, base.palette.faint),
      rule: str(raw.palette?.rule, base.palette.rule),
      accent: str(raw.palette?.accent, base.palette.accent),
      // From this theme's OWN paper and ink, not the default theme's panel: a
      // dark theme that predates the field must not be handed a cream panel.
      panel,
      // The page's ink until somebody says otherwise, which is what every theme
      // looked like before the panel could differ from the paper.
      panelInk: str(raw.palette?.panelInk, ink),
    },
  }
}

/** Pretty-printed, because these files are meant to be opened and edited. */
export function serialiseTheme(theme: Theme): string {
  return `${JSON.stringify(theme, null, 2)}\n`
}

/**
 * Blend two hex colours. The stylesheet needs more tones than a person should
 * have to author — a ground behind the paper, a muted fill for hover — and
 * deriving them from the six authored colours keeps a theme coherent by
 * construction instead of asking for twelve values that have to agree.
 */
export function mixHex(a: string, b: string, t: number): string {
  const first = rgbTriple(a)?.split(' ').map(Number)
  const second = rgbTriple(b)?.split(' ').map(Number)
  if (first === undefined || second === undefined) return a
  const amount = Math.min(1, Math.max(0, t))
  const channel = (i: number): number =>
    Math.round((first[i] as number) * (1 - amount) + (second[i] as number) * amount)
  return `#${[0, 1, 2].map(i => channel(i).toString(16).padStart(2, '0')).join('')}`
}

/**
 * The full token set the stylesheet uses, derived from the six authored
 * colours. Values are the space-separated triples `rgb(var(--x) / a)` needs.
 */
export function themeTokens(theme: Theme): Readonly<Record<string, string>> {
  const { paper, ink, head, faint, rule, accent, panel, panelInk } = theme.palette
  const tokens: Record<string, string> = {
    '--surface': paper,
    '--surface-ground': mixHex(paper, ink, 0.045),
    '--surface-muted': mixHex(paper, ink, 0.11),
    /**
     * The CHROME's own ground — the sidebar, the title bar, the stream panel.
     *
     * Deeper than `--surface-ground`, which is barely off the paper. The panel
     * is a surface in its own right rather than a lightly tinted margin of the
     * page, and one derived colour is what says so on every theme at once: it
     * is mixed from the authored paper and ink, so a dark theme gets a lighter
     * panel and a light theme a darker one without either being written twice.
     */
    '--surface-panel': panel,
    /**
     * The chrome's three text tiers, mixed from one authored colour toward the
     * panel it sits on — so they hold their relationship to each other and to
     * the ground on a pale panel and a near-black one alike.
     */
    '--panel-text-heading': panelInk,
    '--panel-text': mixHex(panel, panelInk, 0.88),
    '--panel-text-muted': mixHex(panel, panelInk, 0.58),
    /**
     * A field ON the panel: an input, a select, a slider's trough.
     *
     * Lifted off the panel rather than borrowed from the page. Using the page's
     * paper here put a light field behind text mixed for a dark panel — white
     * on cream, which is not dim but genuinely unreadable — and it only shows
     * up once somebody makes a panel that differs from their paper, which is
     * the entire reason the colour is authorable.
     */
    '--panel-field': mixHex(panel, panelInk, 0.09),
    /**
     * The edge where chrome meets page: firmer than a rule inside a list.
     *
     * Mixed from the PANEL rather than the paper, so that a chosen panel colour
     * takes its own edge with it instead of keeping the page's.
     */
    '--border-strong': mixHex(panel, ink, 0.26),
    '--text': ink,
    '--text-heading': head,
    '--text-muted': faint,
    '--border': rule,
    '--accent': accent,
  }
  const out: Record<string, string> = {}
  for (const [name, hex] of Object.entries(tokens)) {
    const triple = rgbTriple(hex)
    if (triple !== null) out[name] = triple
  }
  TAG_HUES.forEach((hue, i) => {
    out[`--tag-${i}`] = hslTriple(hue, theme.tagSaturation, theme.tagLightness)
  })
  return out
}

/**
 * `#rrggbb` → `"r g b"`, the space-separated form the stylesheet needs so that
 * `rgb(var(--accent) / 0.16)` can vary alpha. Themes store hex because that is
 * what a person types; the conversion belongs here rather than in either
 * process's head.
 */
export function rgbTriple(hex: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (match === null) return null
  const digits = match[1] as string
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map(d => d + d)
          .join('')
      : digits
  const value = Number.parseInt(full, 16)
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`
}
