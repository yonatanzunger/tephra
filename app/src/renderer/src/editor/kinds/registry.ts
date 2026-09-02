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
import { TodoSurface } from './Todo.tsx'
import type { SurfaceProps } from '../surface.ts'
import type { DocumentKind } from '../../../../shared/document-api.ts'

const SURFACES: Partial<Record<DocumentKind, ComponentType<SurfaceProps>>> = {
  // **The first entry, and the first thing in Tephra shown as something other
  // than running text** (MT3). A fileset will be the second, as a list to drag;
  // stream and markdown stay with the default, because they are prose.
  todo: TodoSurface,
}

export function surfaceFor(kind: DocumentKind): ComponentType<SurfaceProps> {
  return SURFACES[kind] ?? MarkdownSurface
}
