// Which quote a keystroke becomes (D87).
//
// **The rule is the whole feature**, and it is the part that has to be right in
// cases nobody thinks to try by hand — so it is a pure function, tested here,
// with the editor plumbing kept beside it in `quotes.ts` where a test cannot
// reach it without a DOM.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CURLY, curlFor } from '../../src/renderer/src/editor/kinds/markdown/quotes.ts'

test('A QUOTE OPENS at the start of things', () => {
  assert.equal(curlFor('"', ''), CURLY.openDouble)
  assert.equal(curlFor('"', ' '), CURLY.openDouble)
  assert.equal(curlFor('"', '\n'), CURLY.openDouble)
  assert.equal(curlFor("'", ''), CURLY.openSingle)
})

test('and closes against a word', () => {
  assert.equal(curlFor('"', 'd'), CURLY.closeDouble)
  assert.equal(curlFor('"', '.'), CURLY.closeDouble)
  assert.equal(curlFor('"', '!'), CURLY.closeDouble)
})

test('AN APOSTROPHE IS THE CLOSING SINGLE, which is the same character', () => {
  // *it's*, *don't*: an elision closes. One rule covers both because they are
  // the same act — which is why there is no apostrophe case in the function.
  assert.equal(curlFor("'", 't'), CURLY.closeSingle)
  assert.equal(curlFor("'", 's'), CURLY.closeSingle)
})

test('after something that itself opens, a quote opens', () => {
  for (const before of ['(', '[', '{', '—', '–', '“', '‘', '/']) {
    assert.equal(curlFor('"', before), CURLY.openDouble, before)
  }
})

test('THE KNOWN WRONG ANSWER: a leading elision gets an opening quote', () => {
  // `'90s` and `'tis` want a closing single and get an opening one, because the
  // rule sees only what is to the LEFT and the text to the right does not exist
  // when the key is pressed. Recorded rather than special-cased from a word
  // list: a rule that is right about what it can see beats one that guesses.
  assert.equal(curlFor("'", ' '), CURLY.openSingle)
})

test('and nothing else is touched', () => {
  assert.equal(curlFor('`', ' '), null)
  assert.equal(curlFor('"x"', ' '), null)
})
