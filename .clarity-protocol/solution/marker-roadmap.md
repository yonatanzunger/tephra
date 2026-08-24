# Markers out of the buffer, and what ranges look like

Two phases. The first introduces the mechanism and tests it alone; the second
spends it. M2's remaining bullets resume afterwards.

## MA — markers leave the buffer

1. **`x/prose.ts`, pure and tested on its own.** Given a body and its markers
   with their prose widths, produce the prose text and map offsets both ways.
   The awkward cases are the whole point, so they are the tests: a position
   inside a marker, a range spanning one, adjacent markers, a marker at the very
   start or end of a body, and a round trip through every offset of a body that
   has several.
2. **`Segment` reports its markers with widths.** It already scans them.
3. **`StreamWindow` maps through.** `text` is prose; `toDocument`/`toBuffer`
   cross the two coordinate systems; `spans()` reports prose positions.
4. **Edits.** An edit that removes a handle becomes `untag` / `removeAnchor`
   (D44). An edit that would otherwise delete a boundary marker is split around
   it, so no ordinary edit can orphan one. A tag whose content is left empty is
   dropped, which is `normalise`'s existing rule.
5. **The concealment path in `widgets.ts` goes away.** There is nothing left to
   conceal: no `TEPHRA_MARKER` regex, no `MarkerWidget` over raw bytes.
6. **Tests that would have caught the four bugs D44 lists**, plus cursor restore
   across a marker and a copy that cannot carry one.

## MB — what a tagged range looks like

1. **Palette.** Six to eight hues per theme, chosen to work on that ground and to
   be told apart from each other; the subject's hash picks a slot, so a subject
   keeps its colour forever and every colour was chosen by a person.
2. **The mark.** Drawn in CSS, not a dingbat: a symbol font in the middle of a
   serif face brings foreign metrics and too much ink.
3. **The extent.** Stacked thin underlines rather than a tint — they compose
   honestly for overlapping subjects, where two tints multiply into a third
   colour that means nothing, and they need not stay legible behind text, so
   they can be properly saturated. Capped at three deep; the rest live in the
   mark's popover.
4. **The mark's popover:** the name, rename *this span* (renaming a subject
   across the corpus is a different and much larger operation), and remove.
5. **`removeAnchor`**, which currently throws.
6. **The trailing-boundary rule:** typing at the end of a tagged range extends
   it. The caret has one visual place there and two document positions, so this
   is decided rather than discovered. The leading boundary needs no rule, because
   the mark is visible and you can see which side of it you are on.

## Then

M2 resumes at bullet 4, print.
