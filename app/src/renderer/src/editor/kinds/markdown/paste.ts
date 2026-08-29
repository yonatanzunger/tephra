// Pasting rich content keeps its structure.
//
// **Paste and import are different acts, and both should convert.** Import
// (⇧⌘V) additionally keeps the original bytes in `attachments/` and writes a
// provenance line, because what it produces is meant to be cited (R28, D47).
// Paste is just "these words, here" — but a pasted article whose headings and
// lists have been flattened is not the same words, and the structure is exactly
// what makes a long passage annotatable section by section.
//
// No IPC: a paste event carries the clipboard's flavours with it, so this needs
// nothing from main.

import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { markdownFromHtml } from '../../../import/html.ts'

export function richPaste(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const html = event.clipboardData?.getData('text/html') ?? ''
      if (html.trim() === '') return false // plain text; the default is right

      let markdown: string | null = null
      try {
        markdown = markdownFromHtml(html)
      } catch {
        // Whatever arrived defeated the converter. Falling through to the
        // default paste puts the words in, which is far better than refusing —
        // this is the most ordinary gesture there is.
        return false
      }
      if (markdown === null) return false

      const plain = event.clipboardData?.getData('text/plain') ?? ''
      // Nothing gained when the conversion says the same thing as the text
      // flavour: macOS synthesises HTML for a plain-text copy, and converting
      // it back produces the same characters plus escapes nobody asked for.
      if (markdown === plain.trim()) return false

      event.preventDefault()
      view.dispatch(view.state.replaceSelection(markdown), { scrollIntoView: true })
      return true
    },
  })
}
