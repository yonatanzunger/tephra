// Format anomalies: the degradation table, made visible.
//
// `format-spec.md` promises that every anomaly is **reported, never silent**,
// and that none of them loses content. The first half of that promise had no
// implementation — the behaviours were all correct, and all invisible. This is
// the shared vocabulary for reporting them.
//
// **None of these is an error.** Every one has a defined, safe behaviour that
// has already happened by the time it is reported: the tag was bounded to its
// day, the anchor's first use won, the unreadable frontmatter was left exactly
// as it was. The report says what was done, so that a file can be repaired by
// someone who wants to — not that anything needs fixing now. That is why the
// surface is non-modal and why nothing here blocks.

export type AnomalyKind =
  | 'unterminated-tag'
  | 'orphan-tag-end'
  | 'duplicate-anchor'
  | 'unparseable-frontmatter'
  | 'missing-frontmatter'
  | 'date-mismatch'

export interface Anomaly {
  readonly kind: AnomalyKind
  /** The file it was found in, relative to the notebook root. */
  readonly file: string
  /** The date segment, when there is one — the unit a reader navigates by. */
  readonly date: string | null
  /** 1-based, for a person reading the file in another editor. */
  readonly line: number | null
  /** The tag, anchor or key involved, when there is one. */
  readonly subject: string | null
}

/** What happened, in a sentence, in the terms the file's author would use. */
export function describeAnomaly(anomaly: Anomaly): string {
  const subject = anomaly.subject ?? ''
  switch (anomaly.kind) {
    case 'unterminated-tag':
      return `The tag “${subject}” was opened and never closed, so it covers the rest of this day.`
    case 'orphan-tag-end':
      return `A closing marker for “${subject}” has no opening one, and was ignored.`
    case 'duplicate-anchor':
      return `The bookmark “${subject}” is defined more than once here; the first one is the one that resolves.`
    case 'unparseable-frontmatter':
      return 'The frontmatter uses YAML this app cannot round-trip, so it is being treated as absent — and this file will never be rewritten.'
    case 'missing-frontmatter':
      return 'There is no frontmatter; the date was taken from the filename.'
    case 'date-mismatch':
      return `The frontmatter says ${subject}, which is not what the filename says. Frontmatter wins.`
  }
}

/** A short label for the list. Nouns, not warnings. */
export function labelAnomaly(kind: AnomalyKind): string {
  switch (kind) {
    case 'unterminated-tag':
      return 'Unclosed tag'
    case 'orphan-tag-end':
      return 'Stray tag end'
    case 'duplicate-anchor':
      return 'Repeated bookmark'
    case 'unparseable-frontmatter':
      return 'Unreadable frontmatter'
    case 'missing-frontmatter':
      return 'No frontmatter'
    case 'date-mismatch':
      return 'Date disagreement'
  }
}
