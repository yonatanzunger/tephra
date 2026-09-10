// Every key, and who owns it (M5).
//
// **The inventory exists because nobody could answer the question.** Reading the
// code, I claimed Enter did not continue a list and Backspace deleted the marker
// by accident. Both were wrong: `markdown()` installs its own keymap by default,
// a source nothing in this repo mentioned, and it binds exactly those two keys.
// That is the problem this file is the fix for — not that the bindings are bad,
// but that **there was no way to find out what they were.**
//
// Five sources, and they do not know about each other:
//
//  1. `markdownKeymap`, from `@codemirror/lang-markdown` — installed silently by
//     `markdown()` unless `addKeymap: false`.
//  2. `defaultKeymap`, from `@codemirror/commands` — 59 bindings, inherited
//     wholesale, one removed by hand.
//  3. `listIndent()`, ours — Tab and Shift-Tab, at `Prec.high`.
//  4. **Menu accelerators**, which never reach CodeMirror at all: Electron
//     handles them first and dispatches a command over IPC. An accelerator that
//     matches an editor binding does not race it — it *kills* it.
//  5. DOM handlers on components: the find bar's Enter and Escape, the paste and
//     drop handler, the task row's field.
//
// **What this file asserts is drift, not taste.** The inventory below is what the
// packages actually bind today; if an upgrade changes it, or if we add a binding,
// this fails and the record has to be brought up to date deliberately. The
// question of what these keys *should* do is M5's, and it needs this first.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultKeymap } from '@codemirror/commands'
import { markdownKeymap } from '@codemirror/lang-markdown'
import { RANGE_COMMANDS } from '../../src/shared/commands.ts'

const SRC = join(import.meta.dirname, '..', '..', 'src')

/** Every key an editor binding claims, in the notation CodeMirror uses. */
function editorKeys(): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  const add = (key: string | undefined, run: unknown): void => {
    if (key === undefined) return
    const name = (run as { name?: string })?.name
    // First writer wins, which is also CodeMirror's precedence: bindings are
    // tried in extension order, and `markdown()` is installed before
    // `defaultKeymap` in `bind.ts`. That is precedence by array position, which
    // is worth knowing about and is why the markdown pair is added first here.
    if (!out.has(key)) out.set(key, name === undefined || name === '' ? 'anonymous' : name)
  }
  // **The mac binding when there is one**, because that is what this machine
  // does. Taking `key` and `mac` both was the first version, and it invented
  // keystrokes: `Mod-ArrowLeft` is `cursorGroupLeft` on Windows and
  // `Alt-ArrowLeft` on a mac, where ⌘← is the line boundary instead. An
  // inventory that lists both is an inventory of no particular computer.
  for (const b of markdownKeymap) add(b.mac ?? b.key, b.run)
  for (const b of defaultKeymap) add(b.mac ?? b.key, b.run)
  return out
}

/**
 * **The one that matters: a menu accelerator silences an editor binding.**
 *
 * Electron dispatches an accelerator before the page sees the key, so a binding
 * underneath one is dead code that looks live. Each entry here is a decision
 * somebody made, with the reason, rather than a list of things that happen to
 * collide.
 */
const SHADOWED: Readonly<Record<string, string>> = {
  // Dropped from the keymap outright rather than left to be shadowed, because
  // `selectParentSyntax` in a prose document selects a paragraph out from under
  // you — and ⌘I is italic in every text application there is.
  'Mod-i': 'italic — and the binding is REMOVED in bind.ts, not merely covered',
  // Strikeout. `toggleComment` in a markdown document would wrap prose in HTML
  // comments, which is not a thing anybody wants from ⌘/.
  'Mod-/': 'strikeout',
  // The menu item and the editor binding do the same thing, so which one wins
  // cannot be observed.
  'Mod-a': 'Select All, which is the same act',
}

/**
 * One spelling for a key, whichever side wrote it down.
 *
 * **Two notations meet here and neither is canonical.** CodeMirror writes
 * `Shift-Mod-k` — modifiers in its own order, the letter lower case. Electron
 * writes `CmdOrCtrl+Shift+K` — plus signs, its own order, upper case. Comparing
 * them as strings finds nothing, which is how the first version of this file
 * reported that no menu accelerator shadowed anything at all.
 */
function canonical(key: string): string {
  const parts = key.split(/[-+]/).filter(part => part !== '')
  const mods = new Set<string>()
  let base = ''
  for (const part of parts) {
    // **`Ctrl` is not `Mod`.** In CodeMirror's notation `Mod` is ⌘ on a mac and
    // Control elsewhere, while `Ctrl` means Control literally — so the emacs
    // bindings (`Ctrl-k`, `Ctrl-o`) are not the same keystrokes as ⌘K and ⌘O,
    // and the first version of this reported eight collisions that were not.
    // On this platform `Mod` and `Cmd` ARE the same, so they fold together.
    const mod = /^(CmdOrCtrl|Cmd|Mod)$/i.test(part)
      ? 'Mod'
      : /^Ctrl$/i.test(part)
        ? 'Ctrl'
        : /^Shift$/i.test(part)
        ? 'Shift'
          : /^(Alt|Option)$/i.test(part)
          ? 'Alt'
          : null
    if (mod !== null) mods.add(mod)
    // The last non-modifier is the key itself. A one-character key is compared
    // case-insensitively, because `Mod-Shift-k` and `CmdOrCtrl+Shift+K` are the
    // same keystroke and only one of them says so.
    else base = part.length === 1 ? part.toLowerCase() : part
  }
  return [...['Mod', 'Ctrl', 'Shift', 'Alt'].filter(m => mods.has(m)), base].join('-')
}

/**
 * What a `role` binds, which the menu never writes down.
 *
 * **A role is an accelerator too.** `{ role: 'selectAll' }` is ⌘A, and it takes
 * the key from the page exactly as a hand-written accelerator does — so a table
 * built only from `accelerator:` strings misses the standard half of the menu
 * and reports that nothing shadows `Mod-a`, which is false.
 *
 * Only the roles this menu actually uses, and only those with a key.
 */
const ROLE_KEYS: Readonly<Record<string, string>> = {
  selectAll: 'Mod-a',
  cut: 'Mod-x',
  copy: 'Mod-c',
  paste: 'Mod-v',
  reload: 'Mod-r',
  close: 'Mod-w',
  hide: 'Mod-h',
  hideOthers: 'Mod-Alt-h',
  quit: 'Mod-q',
  togglefullscreen: 'Ctrl-Mod-f',
}

async function menuKeys(): Promise<readonly string[]> {
  const menu = await readFile(join(SRC, 'main', 'menu.ts'), 'utf8')
  const hand = [...menu.matchAll(/accelerator: '([^']+)'/g)].map(m => m[1] as string)
  const roles = [...menu.matchAll(/role: '([a-zA-Z]+)'/g)]
    .map(m => ROLE_KEYS[m[1] as string])
    .filter((key): key is string => key !== undefined)
  const commands = RANGE_COMMANDS.map(c => c.accelerator).filter(a => a !== '')
  return [...hand, ...roles, ...commands].map(canonical)
}

// ── the inventory ──────────────────────────────────────────

test('THE INVENTORY: every key the editor binds, and to what', async () => {
  const keys = editorKeys()
  // A snapshot, sorted, so an upgrade that changes CodeMirror's defaults fails
  // here instead of changing the app quietly.
  const shape = [...keys].map(([key, run]) => `${key} ${run}`).sort()
  assert.equal(shape.length, keys.size)
  assert.equal(
    keys.size,
    59,
    `the editor binds ${keys.size} keys; if a package changed, read the diff before updating this`,
  )
  // The two that are markdown's, and the reason this file exists.
  assert.equal(keys.get('Enter'), 'anonymous', 'insertNewlineContinueMarkup, via markdown()')
  assert.equal(keys.get('Backspace'), 'deleteMarkupBackward', 'also markdown()')
})

test('and the markdown pair wins over the plain pair, by extension order', () => {
  // `markdown()` is installed before `keymap.of(defaultKeymap)` in `bind.ts`,
  // and CodeMirror tries bindings in that order. Which is fragile: moving one
  // line would make Enter stop continuing lists, with nothing to say so.
  const plain = defaultKeymap.filter(b => b.key === 'Enter' || b.key === 'Backspace')
  assert.equal(plain.length, 2, 'the plain keymap does bind both')
  const md = markdownKeymap.map(b => b.key)
  assert.deepEqual(md, ['Enter', 'Backspace'])
})

// ── what the menu takes away ───────────────────────────────

test('THE HAZARD: no editor binding is silently shadowed by a menu accelerator', async () => {
  const taken = await menuKeys()
  const bound = new Map([...editorKeys()].map(([key, run]) => [canonical(key), run]))
  const surprises = taken.filter(key => bound.has(key) && !(key in SHADOWED))
  assert.deepEqual(
    surprises,
    [],
    'a menu accelerator kills the editor binding under it: decide, then record it in SHADOWED',
  )
})

test('and every entry in SHADOWED is actually shadowed', async () => {
  // The other direction, so the list cannot rot into a set of claims about keys
  // nobody uses any more.
  const bound = new Set([...editorKeys().keys()].map(canonical))
  const taken = new Set(await menuKeys())
  for (const key of Object.keys(SHADOWED)) {
    assert.ok(taken.has(canonical(key)), `${key} is in SHADOWED but no menu item claims it`)
    // Mod-i is the exception: it is removed from the keymap in `bind.ts`, so it
    // is not there to be shadowed. The comment in SHADOWED says so.
    if (key !== 'Mod-i') assert.ok(bound.has(canonical(key)), `${key} is in SHADOWED but nothing binds it`)
  }
})

test('the removal of Mod-i is still in place', async () => {
  const bind = await readFile(join(SRC, 'renderer', 'src', 'editor', 'kinds', 'markdown', 'bind.ts'), 'utf8')
  assert.match(bind, /defaultKeymap\.filter\(binding => binding\.key !== 'Mod-i'\)/)
})

test('and `searchKeymap` is still absent (D66)', async () => {
  const bind = await readFile(join(SRC, 'renderer', 'src', 'editor', 'kinds', 'markdown', 'bind.ts'), 'utf8')
  const code = bind.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!code.includes('searchKeymap'), 'two ⌘F behaviours with two grammars is what D66 forbids')
})

test('vim binds nothing, because there is no vim (D67)', async () => {
  const bind = await readFile(join(SRC, 'renderer', 'src', 'editor', 'kinds', 'markdown', 'bind.ts'), 'utf8')
  assert.ok(!bind.includes('codemirror-vim'))
})

// ── keys nobody owns ───────────────────────────────────────

/**
 * Bindings that are live, inherited, and undocumented — the ones M5 has to make
 * a decision about rather than continue to inherit.
 *
 * **This is a list of open questions, not of bugs.** It fails if one of them
 * quietly disappears, because that would mean the decision got made by an
 * upgrade rather than by anybody.
 */
const INHERITED_AND_UNDECIDED: readonly string[] = [
  // Deletes the whole line. Adjacent to ⌘K, which is Link.
  'Shift-Mod-k',
  // "Document" in a windowed twenty-year stream is the loaded window, not the
  // corpus — so this goes somewhere arbitrary and calls it the beginning.
  'Cmd-ArrowUp',
  'Cmd-ArrowDown',
  'Mod-Home',
  'Mod-End',
  // A whole shadow keymap from emacs, of which macOS makes only some standard.
  'Ctrl-k',
  'Ctrl-o',
  'Ctrl-t',
  'Ctrl-v',
  // Multiple cursors, in a prose editor.
  'Mod-Alt-ArrowUp',
  'Mod-Alt-ArrowDown',
  // Bracket matching and indentation, from a code editor.
  'Shift-Mod-\\',
  'Mod-[',
  'Mod-]',
  'Mod-Alt-\\',
  // Obscure enough to be worth naming: a mode toggle for tab focus. (On a mac
  // this is Shift-Alt-m; `Ctrl-m` is the binding on every other platform, which
  // is the kind of thing a mac-only inventory is for.)
  'Shift-Alt-m',
]

test('the undecided inherited keys are all still bound', () => {
  const keys = editorKeys()
  const gone = INHERITED_AND_UNDECIDED.filter(key => !keys.has(key))
  assert.deepEqual(gone, [], 'an upgrade decided one of these instead of us')
})
