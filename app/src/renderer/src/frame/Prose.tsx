// A line of the corpus, drawn with its links live.
//
// **One renderer, because there was nearly a second one.** The task list drew
// links in its rows (MT3) and the link directory needed the same thing for the
// sentence a link was written in — and the two would have differed in exactly
// the way `shared/links.ts` exists to prevent, since the todo copy followed a
// link through `openLink`, which resolves paths *inside the notebook* and
// answers null for a URL. A URL in a task row did nothing at all.
//
// **`nav.open` is the dispatcher**: browser, OS, or a document in the corpus,
// and it says which happened. Following a link is main's job — what a target
// means, and whether it is inside the notebook, is a question about the
// notebook.

import { scanLinks } from '../../../shared/links.ts'
import { referenceOf } from '../../../shared/fileset.ts'
import type { DocumentId } from '../../../shared/document-api.ts'

export function Prose({
  text,
  from,
  onOpenDocument,
}: {
  text: string
  /** The file it was written in, which is what a relative target is relative to. */
  from?: string
  /** A link into the corpus is this app's to open, not the desktop's (D54). */
  onOpenDocument?: (id: DocumentId) => void
}): React.JSX.Element {
  // Images are embedded rather than gone to, so they are not links to follow.
  const links = scanLinks(text).filter(link => !link.image)
  if (links.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let at = 0
  links.forEach((link, i) => {
    if (link.from > at) parts.push(text.slice(at, link.from))
    parts.push(
      <a
        key={`link:${i}`}
        className="tx-link"
        href={link.target}
        title={link.target}
        onClick={e => {
          e.preventDefault()
          // **Stopped**, because this often sits inside something else that is
          // also clickable — a directory row whose sentence goes to where it
          // was written. Two answers to one click is one too many.
          e.stopPropagation()
          const reference = referenceOf(link.target)
          if (reference === null) return
          void window.tephra.nav.open(reference, from).then(how => {
            if (typeof how === 'object') onOpenDocument?.(how.document)
          })
        }}
      >
        {link.label}
      </a>,
    )
    at = link.to
  })
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}
