// Which surface shows which kind — one table, and one line per kind (D54).
//
// **Data rather than a switch someone has to find.** `architecture.md` puts the
// surface among the four artifacts a kind needs, precisely so that adding a kind
// is adding files: the implementation in main, the forwarder in the renderer,
// and the surface here.
//
// Markdown is the DEFAULT rather than an entry. Every kind in the corpus is a
// markdown file underneath — a stream, a note, a fileset, a todo list — so a
// kind nobody has written a surface for still opens as the text it is, which is
// R26 applied to this app's own future.

import type { ComponentType } from 'react'
import { MarkdownSurface } from './Markdown.tsx'
import type { SurfaceProps } from '../surface.ts'
import type { DocumentKind } from '../../../../shared/document-api.ts'

const SURFACES: Partial<Record<DocumentKind, ComponentType<SurfaceProps>>> = {
  // stream, markdown, todo and fileset are all running text today. The first
  // entry here will be the first kind that is shown as something else — a todo
  // list with checkboxes to click, or a fileset as a list to drag.
}

export function surfaceFor(kind: DocumentKind): ComponentType<SurfaceProps> {
  return SURFACES[kind] ?? MarkdownSurface
}
