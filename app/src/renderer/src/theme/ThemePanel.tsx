// The theme panel: everything a theme is, editable while you look at it (D41).
//
// This exists because the four proof-sheet arrangements could only be judged by
// looking at them, and the same is true of the numbers between them. Every
// control here moves the text underneath immediately; saving is separate and
// explicit, and writes a plain JSON file into `config/themes/`.
//
// It is a panel and not a modal on purpose: you are choosing a measure by
// reading, so the reading must stay visible while you choose. The same argument
// applies to colour twice over — a ground is judged against the text on it.
//
// **Everything a theme HAS is here.** It began as typography alone, which meant
// the palette could only be changed by editing JSON by hand, and the one colour
// the chrome most needed — the panel's own ground — could not be changed at all
// because it was derived in code. A control panel that can reach half of what
// it names is a worse instrument than none: it teaches you the other half is
// not adjustable.

import type { Theme } from '../../../shared/theme.ts'
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
  const { themes, draft, dirty, saving, builtIn } = control

  return (
    <aside className="theme-panel" aria-label="Theme">
      <header>
        <span>Theme</span>
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

      {/* **Duplicate, not New.** A theme is twenty numbers; starting from blank
          is twenty decisions before you can read a line, and starting from what
          is on screen is one. */}
      <div className="theme-manage">
        <button type="button" onClick={() => control.duplicate(`${draft.label} copy`)}>
          Duplicate
        </button>
        <button
          type="button"
          className="link"
          onClick={control.remove}
          disabled={builtIn}
          title={
            builtIn
              ? 'A built-in theme is written back the next time Tephra starts, so deleting it would not stay deleted. Duplicate it and edit the copy.'
              : `Delete ${draft.label}`
          }
        >
          Delete
        </button>
      </div>

      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={draft.label}
          spellCheck={false}
          onChange={e => control.update({ label: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Note</span>
        <input
          type="text"
          value={draft.note}
          placeholder="What this theme is for"
          onChange={e => control.update({ note: e.target.value })}
        />
      </label>

      {/* ── colour ────────────────────────────────────────────────────────
          Named for what each one IS on the page rather than for its token, so
          that choosing them is a design decision and not a CSS one. */}
      <h3 className="theme-heading">Colour</h3>
      <Swatch label="Paper" hint="the page itself" value={draft.palette.paper}
        onChange={paper => control.paint({ paper })} />
      <Swatch label="Panel" hint="the sidebar and title bar" value={draft.palette.panel}
        onChange={panel => control.paint({ panel })} />
      <Swatch label="Panel text" hint="words on the panel" value={draft.palette.panelInk}
        onChange={panelInk => control.paint({ panelInk })} />
      <Swatch label="Ink" hint="body text" value={draft.palette.ink}
        onChange={ink => control.paint({ ink })} />
      <Swatch label="Headings" hint="titles, and what leads" value={draft.palette.head}
        onChange={head => control.paint({ head })} />
      <Swatch label="Quiet" hint="counts, dates, asides" value={draft.palette.faint}
        onChange={faint => control.paint({ faint })} />
      <Swatch label="Rules" hint="lines and edges" value={draft.palette.rule}
        onChange={rule => control.paint({ rule })} />
      <Swatch label="Accent" hint="where you are" value={draft.palette.accent}
        onChange={accent => control.paint({ accent })} />

      {/* A subject's HUE comes from its name and never changes; these two decide
          whether that hue reads as a quiet mark on cream or a legible line on
          black, which is a property of the page (D44). */}
      <Slider label="Tag depth" unit="%" min={0} max={100} step={1}
        value={draft.tagSaturation}
        onChange={tagSaturation => control.update({ tagSaturation })} />
      <Slider label="Tag lightness" unit="%" min={0} max={100} step={1}
        value={draft.tagLightness}
        onChange={tagLightness => control.update({ tagLightness })} />
      <p className="theme-tags">
        {[0, 1, 2, 3, 4, 5, 6, 7].map(slot => (
          <span key={slot} className="theme-tag" style={{ background: `rgb(var(--tag-${slot}))` }} />
        ))}
      </p>

      <h3 className="theme-heading">Type</h3>
      <label className="field">
        <span>Face</span>
        <input
          type="text"
          value={draft.face}
          spellCheck={false}
          onChange={e => control.update({ face: e.target.value })}
        />
      </label>

      {/* A switch, not a slider: there are two ways to set a column and no
          continuum between them. */}
      <label className="field toggle-field">
        <span>
          Justified
          <em>{draft.justify ? 'flush both edges, hyphenated' : 'ragged right'}</em>
        </span>
        <input
          type="checkbox"
          checked={draft.justify}
          onChange={e => control.update({ justify: e.target.checked })}
        />
      </label>
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
      {/* Up to three lines: this is now the WHOLE gap between paragraphs, not
          the smaller of two numbers that added into one. */}
      <Slider
        label="Between paragraphs"
        unit="em"
        min={0}
        max={3}
        step={0.05}
        value={draft.paragraphSpace}
        onChange={paragraphSpace => control.update({ paragraphSpace })}
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

/**
 * One colour, as a swatch you can click and a hex you can type.
 *
 * Both, because they are different acts: the picker is for finding a colour and
 * the field is for using one you already have — a value out of a palette
 * somebody else made, or the one from the theme next to this.
 */
function Swatch({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="field swatch">
      <span>
        {label}
        <em>{hint}</em>
      </span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} aria-label={label} />
      <input
        type="text"
        className="hex"
        value={value}
        spellCheck={false}
        onChange={e => onChange(e.target.value)}
      />
    </label>
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
