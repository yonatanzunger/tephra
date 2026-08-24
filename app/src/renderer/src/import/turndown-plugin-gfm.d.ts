// `turndown-plugin-gfm` ships no types. Declared rather than pulled from
// DefinitelyTyped: the whole surface used here is three plugin functions, and a
// second package to describe them would be more dependency than description.
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'
  type Plugin = TurndownService.Plugin
  export const gfm: Plugin
  export const tables: Plugin
  export const strikethrough: Plugin
  export const taskListItems: Plugin
}
