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
} from '@shared/theme.ts'
import type { Typography } from '../editor/theme'

export interface ThemeControl {
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

  // Paint. Tokens go on the root element rather than into a stylesheet so that
  // every rule already written against `rgb(var(--text))` picks them up with no
  // second definition to keep in step.
  useEffect(() => {
    const root = document.documentElement
    for (const [name, value] of Object.entries(themeTokens(draft))) {
      root.style.setProperty(name, value)
    }
    root.style.setProperty('--font-body', draft.face)
    root.dataset.theme = draft.name
  }, [draft])

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

  return { themes: themes.length > 0 ? themes : [saved], draft, dirty, saving, select, update, revert, save }
}

/** The editor's view of a theme. One source, two consumers. */
export function typographyOf(theme: Theme): Typography {
  return {
    font: theme.face,
    size: theme.size,
    measure: theme.measure,
    gutter: theme.gutter,
    gutterGap: theme.gutterGap,
    leading: theme.leading,
    paragraphSpace: theme.paragraphSpace,
    blankLine: theme.blankLine,
  }
}
