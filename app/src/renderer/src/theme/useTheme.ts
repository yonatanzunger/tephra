// The active theme, and the live edits made to it (D41).
//
// The shape here is deliberate: **the app always renders the draft.** Moving a
// slider changes what you are reading immediately, and saving is a separate,
// explicit act that writes the file. The alternative — apply on save — turns
// choosing a measure into a guessing game, and the whole reason these are
// parameters rather than constants is that the four arrangements could only be
// judged by looking at them.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  builtInTheme,
  defaultTheme,
  themeTokens,
  type Theme,
} from '../../../shared/theme.ts'
import type { Typography } from '../editor/theme'

/**
 * The Hebrew range: the block itself, presentation forms, and the two
 * directional marks that travel with it. Anything outside this falls through to
 * the theme's own stack untouched, which is the whole point of doing it with
 * `unicode-range` rather than by tagging text with a language.
 */
const HEBREW_RANGE = 'U+0590-05FF, U+FB1D-FB4F, U+200F, U+200E'

/**
 * A family name that changes whenever the parameters do.
 *
 * This is not cosmetic. A `@font-face` rule is cached by family name, so
 * rewriting the rule for the SAME name with a different `size-adjust` does not
 * re-resolve — the old metrics stay. Folding the parameters into the name makes
 * every distinct setting a distinct family, which is what makes the slider work
 * at all.
 */
function hebrewFamily(face: string, scale: number): string {
  return `Tephra Hebrew ${Math.round(scale)} ${face.replace(/[^a-z0-9]+/gi, '-')}`
}

export interface ThemeControl {
  /**
   * The font stack to actually use: the generated Hebrew family first, then the
   * theme's own. First is deliberate — the browser tries each family in turn per
   * character, and the generated one only claims the Hebrew range.
   */
  readonly face: string
  /** Everything in `config/themes/`, plus the built-ins if the read failed. */
  readonly themes: readonly Theme[]
  /** What is on screen right now: the saved theme plus any unsaved edits. */
  readonly draft: Theme
  /** True when the draft differs from what is on disk. */
  readonly dirty: boolean
  readonly saving: boolean
  select(name: string): void
  update(change: Partial<Theme>): void
  revert(): void
  save(): void
}

export function useTheme(activeName: string, onSelect: (name: string) => void): ThemeControl {
  const [themes, setThemes] = useState<readonly Theme[]>([])
  const [draft, setDraft] = useState<Theme>(() => builtInTheme(activeName) ?? defaultTheme())
  const [saving, setSaving] = useState(false)

  // Load once. A failed read leaves the built-ins in place rather than an empty
  // list: an app with no themes at all has no way back to a readable state.
  useEffect(() => {
    void (async () => {
      try {
        const loaded = await window.tephra.doc.listThemes()
        if (loaded.length > 0) setThemes(loaded)
      } catch {
        // Left to the built-in fallback below.
      }
    })()
  }, [])

  const saved = useMemo(
    () => themes.find(theme => theme.name === activeName) ?? builtInTheme(activeName) ?? defaultTheme(),
    [themes, activeName],
  )

  // Follow the saved theme whenever the selection changes or the files arrive.
  // Keyed on identity, so a load that returns the same theme does not discard
  // edits made while it was in flight.
  useEffect(() => setDraft(saved), [saved])

  // Per-script sizing (D41). Hebrew reads uncomfortably small beside Latin at
  // the same nominal size: almost every letter sits at x-height, giving the eye
  // no size cue, and several differ only in fine detail — ב from כ, ד from ר,
  // ה from ח — so the reader needs more actual pixels to tell them apart.
  //
  // Done with `unicode-range` and `size-adjust` rather than by tagging text with
  // a language, so it needs no markup and no detection: the browser applies it
  // per character, and everything outside the range falls through untouched.
  //
  // THE TRAP, learned in the proof sheet: naming a face here REPLACES the
  // natural fallback for that range. The first version listed 'Arial Hebrew'
  // first and silently swapped a serif for a sans — the size was right and the
  // page looked worse. Whatever is named must be chosen for how it looks beside
  // the Latin face, not for having Hebrew in its name.
  const face = useMemo(() => {
    const family = hebrewFamily(draft.hebrewFace, draft.hebrewScale)
    return `'${family}', ${draft.face}`
  }, [draft.hebrewFace, draft.hebrewScale, draft.face])

  useEffect(() => {
    const id = 'tephra-hebrew'
    const style =
      document.getElementById(id) ??
      document.head.appendChild(Object.assign(document.createElement('style'), { id }))
    style.textContent = `@font-face {
  font-family: '${hebrewFamily(draft.hebrewFace, draft.hebrewScale)}';
  src: local('${draft.hebrewFace}');
  unicode-range: ${HEBREW_RANGE};
  size-adjust: ${draft.hebrewScale}%;
}`
  }, [draft.hebrewFace, draft.hebrewScale])

  // Paint. Tokens go on the root element rather than into a stylesheet so that
  // every rule already written against `rgb(var(--text))` picks them up with no
  // second definition to keep in step.
  useEffect(() => {
    const root = document.documentElement
    for (const [name, value] of Object.entries(themeTokens(draft))) {
      root.style.setProperty(name, value)
    }
    root.style.setProperty('--font-body', face)
    root.dataset.theme = draft.name
  }, [draft, face])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  )

  const select = useCallback(
    (name: string) => {
      onSelect(name)
    },
    [onSelect],
  )

  const update = useCallback((change: Partial<Theme>) => {
    setDraft(previous => ({ ...previous, ...change }))
  }, [])

  const revert = useCallback(() => setDraft(saved), [saved])

  const save = useCallback(() => {
    setSaving(true)
    void (async () => {
      try {
        await window.tephra.doc.saveTheme(draft)
        setThemes(previous => {
          const without = previous.filter(theme => theme.name !== draft.name)
          return [...without, draft].sort((a, b) => a.label.localeCompare(b.label))
        })
      } finally {
        setSaving(false)
      }
    })()
  }, [draft])

  return { face, themes: themes.length > 0 ? themes : [saved], draft, dirty, saving, select, update, revert, save }
}

/**
 * The editor's view of a theme. One source, two consumers.
 *
 * `face` is passed in rather than read off the theme because the effective
 * stack has the generated Hebrew family in front of it, and the editor must lay
 * out with the same stack the rest of the page uses or the two disagree about
 * how wide a character is — which is exactly the quantity the frame's
 * arithmetic depends on.
 */
export function typographyOf(theme: Theme, face: string): Typography {
  return {
    font: face,
    size: theme.size,
    measure: theme.measure,
    gutter: theme.gutter,
    gutterGap: theme.gutterGap,
    leading: theme.leading,
    paragraphSpace: theme.paragraphSpace,
    blankLine: theme.blankLine,
  }
}
