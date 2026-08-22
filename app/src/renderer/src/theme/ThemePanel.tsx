// Live typographic controls (D41).
//
// This exists because the four proof-sheet arrangements could only be judged by
// looking at them, and the same is true of the numbers between them. Every
// control here moves the text underneath immediately; saving is separate and
// explicit, and writes a plain JSON file into `config/themes/`.
//
// It is a panel and not a modal on purpose: you are choosing a measure by
// reading, so the reading must stay visible while you choose.

import type { Theme } from '@shared/theme.ts'
import type { ThemeControl } from './useTheme'

/** What the stream would cover at this measure, for the note at the foot. */
export interface OcclusionNote {
  readonly covering: number
}

export function ThemePanel({
  control,
  occlusion,
  onClose,
}: {
  control: ThemeControl
  occlusion: OcclusionNote
  onClose: () => void
}): React.JSX.Element {
  const { themes, draft, dirty, saving } = control

  return (
    <aside className="theme-panel" aria-label="Typography">
      <header>
        <span>Typography</span>
        <button type="button" className="link" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <label className="field">
        <span>Theme</span>
        <select value={draft.name} onChange={e => control.select(e.target.value)}>
          {themes.map(theme => (
            <option key={theme.name} value={theme.name}>
              {theme.label}
            </option>
          ))}
        </select>
      </label>
      {draft.note !== '' && <p className="theme-note">{draft.note}</p>}

      <Slider
        label="Measure"
        unit="ch"
        min={30}
        max={100}
        step={1}
        value={draft.measure}
        onChange={measure => control.update({ measure })}
      />
      <Slider
        label="Size"
        unit="px"
        min={12}
        max={32}
        step={1}
        value={draft.size}
        onChange={size => control.update({ size })}
      />
      <Slider
        label="Leading"
        min={1.2}
        max={2.2}
        step={0.02}
        value={draft.leading}
        onChange={leading => control.update({ leading })}
      />
      <Slider
        label="Paragraph"
        unit="em"
        min={0}
        max={2}
        step={0.05}
        value={draft.paragraphSpace}
        onChange={paragraphSpace => control.update({ paragraphSpace })}
      />
      <Slider
        label="Blank line"
        min={0}
        max={1.5}
        step={0.05}
        value={draft.blankLine}
        onChange={blankLine => control.update({ blankLine })}
      />
      <Slider
        label="Gutter"
        unit="ch"
        min={0}
        max={40}
        step={1}
        value={draft.gutter}
        onChange={gutter => control.update({ gutter })}
      />

      {/* Per-script sizing (D41). A face and a percentage, because the right
          answer depends on which Latin face it sits beside — and the face
          matters as much as the size, since naming one here replaces the
          natural fallback for the whole script. */}
      <div className="theme-group">
        <span className="theme-group-label">Hebrew</span>
        <label className="field">
          <span>Face</span>
          <input
            type="text"
            className="theme-text"
            value={draft.hebrewFace}
            spellCheck={false}
            onChange={e => control.update({ hebrewFace: e.target.value })}
          />
        </label>
        <Slider
          label="Scale"
          unit="%"
          min={100}
          max={180}
          step={1}
          value={draft.hebrewScale}
          onChange={hebrewScale => control.update({ hebrewScale })}
        />
        <p className="theme-sample" lang="he" dir="rtl">
          בראשית ברא — Hebrew beside Latin
        </p>
      </div>

      {/* The measure is not only a matter of taste: it decides how much room is
          left, and therefore whether the capture stream lands on empty paper or
          covers the margin where commentary lives (D42, R27). Saying so here
          means the trade is visible while it is being made. */}
      <p className="theme-consequence">
        {occlusion.covering > 0 ? (
          <>
            At this width the stream would cover{' '}
            <b>{Math.round(occlusion.covering)}px</b> of the margin. Narrow the
            measure or the gutter to buy that back.
          </>
        ) : (
          <>The capture stream fits beside the text at this width, covering nothing.</>
        )}
      </p>

      <div className="theme-actions">
        <button type="button" onClick={control.save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="link" onClick={control.revert} disabled={!dirty}>
          Revert
        </button>
        <span className="theme-where">config/themes/{draft.name}.json</span>
      </div>
    </aside>
  )
}

function Slider({
  label,
  unit = '',
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  unit?: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="field slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <output>
        {step < 1 ? value.toFixed(2) : Math.round(value)}
        {unit}
      </output>
    </label>
  )
}

export type { Theme }
