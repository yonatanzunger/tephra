// Writing a link destination that will survive being read back.

/**
 * A destination, in a form the parser will return whole.
 *
 * **A bare URL containing a space or a bracket ends early**, and the rest of it
 * becomes prose sitting next to a broken link — quietly, and in the file. Angle
 * brackets are CommonMark's provision for exactly this and every renderer
 * understands them, so they are used whenever the plain form would not survive.
 *
 * `<` and `>` inside the URL are removed rather than escaped: they cannot
 * appear in a valid URL, angle brackets have no escape inside a destination,
 * and a link that silently ends in the middle is worse than one missing a
 * character it should not have had.
 */
export function destination(target: string): string {
  const url = target.trim()
  if (url === '') return ''
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, '')}>` : url
}
