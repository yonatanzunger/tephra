// The query notation (MS2, D65, D66).
//
// **Built and tested before the engine**, so that MS1's tests can say
// `parse('foo #wombats')` instead of assembling a struct by hand — and so that
// when one of those goes red, the parser's own table is green beside it and the
// bug is where the engine is.
//
// The property this file exists to hold: **`format` then `parse` is the identity
// on queries.** Everything else is a case of it or a reason it might fail.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatQuery, parseQuery } from '../../../src/shared/query-text.ts'
import { EVERYWHERE, isEmpty, type Ordering, type Query, type QueryParams, type Scope } from '../../../src/shared/search-api.ts'
import type { DateKey, DocumentId } from '../../../src/shared/document-api.ts'

const NEWEST: Ordering = { kind: 'chronological', origin: 'now', direction: 'past' }
const PARAMS: QueryParams = { scope: EVERYWHERE, order: NEWEST, fold: 'auto' }

const parse = (text: string, params: QueryParams = PARAMS) => parseQuery(text, params)
const words = (q: Query): readonly string[] => q.find.of.map(term => term.text)
const d = (s: string): DateKey => s as DateKey

// ── the phrase ─────────────────────────────────────────────

test('a bare query is one phrase, in the order typed', () => {
  const { query, problems } = parse('call the surveyor')
  assert.deepEqual(words(query), ['call', 'the', 'surveyor'])
  assert.deepEqual(problems, [])
  assert.deepEqual(query.scope, EVERYWHERE, 'and nothing became scope')
})

test('THE POINT: term order is preserved, because a ranker will read it', () => {
  // v1 matches a phrase, so these differ for it too — but the rule outlives that:
  // an `and` would match the same lines and must still not sort its children,
  // since proximity scoring is made of order and adjacency.
  assert.notDeepEqual(words(parse('foo bar').query), words(parse('bar foo').query))
  assert.deepEqual(words(parse('bar foo').query), ['bar', 'foo'])
})

test('repeated words are kept, not deduped', () => {
  assert.deepEqual(words(parse('had had had').query), ['had', 'had', 'had'])
})

test('whitespace is not information', () => {
  assert.deepEqual(words(parse('   foo    bar  ').query), ['foo', 'bar'])
})

// ── tags ───────────────────────────────────────────────────

test('a tag becomes scope and not a word', () => {
  const { query } = parse('foo #wombats')
  assert.deepEqual(words(query), ['foo'])
  assert.deepEqual(query.scope.tags, ['wombats'])
})

test('the quoted spelling carries a tag with spaces', () => {
  const { query } = parse("survey #'house deal'")
  assert.deepEqual(words(query), ['survey'])
  assert.deepEqual(query.scope.tags, ['house deal'])
})

test('a tag is the subject key, so two spellings are one scope', () => {
  const { query } = parse("#House  #'  house '  #HOUSE")
  assert.deepEqual(query.scope.tags, ['house'], 'normalised, and deduped')
})

test('tags conjoin onto the scope the command handed in', () => {
  const scope: Scope = { ...EVERYWHERE, tags: ['house'] }
  const { query } = parse('#urgent', { ...PARAMS, scope })
  assert.deepEqual(query.scope.tags, ['house', 'urgent'])
})

test('a bare hash is a word, not a tag', () => {
  const { query } = parse('# 3')
  assert.deepEqual(words(query), ['#', '3'])
  assert.deepEqual(query.scope.tags, [])
})

// ── dates ──────────────────────────────────────────────────

test('THE CONVERSION: the notation is inclusive and the scope is half-open', () => {
  const { query } = parse('2026-03-01..2026-03-15')
  assert.deepEqual(query.scope.dates, { from: d('2026-03-01'), until: d('2026-03-16') })
})

test('a month is a month, and December does not fall off the end of the year', () => {
  assert.deepEqual(parse('2026-03').query.scope.dates, { from: d('2026-03-01'), until: d('2026-04-01') })
  assert.deepEqual(parse('2026-12').query.scope.dates, { from: d('2026-12-01'), until: d('2027-01-01') })
})

test('a bare day is that day', () => {
  assert.deepEqual(parse('2026-03-09').query.scope.dates, { from: d('2026-03-09'), until: d('2026-03-10') })
})

test('two ranges mean both of them, which is the intersection', () => {
  const { query } = parse('2026-03 2026-03-09..2026-04-20')
  assert.deepEqual(query.scope.dates, { from: d('2026-03-09'), until: d('2026-04-01') })
})

test('and ranges that do not overlap admit nothing, with no special case', () => {
  const { query } = parse('2026-03 2026-06')
  assert.ok(query.scope.dates !== null)
  assert.equal(query.scope.dates.from, query.scope.dates.until, 'an empty half-open range')
})

test('a date that cannot exist is said out loud AND still searched for', () => {
  // Dropping it would lose characters somebody typed, which is the one thing a
  // search box must never do.
  const { query, problems } = parse('2026-13-02')
  assert.equal(problems.length, 1)
  assert.deepEqual({ from: problems[0]?.from, to: problems[0]?.to }, { from: 0, to: 10 })
  assert.deepEqual(words(query), ['2026-13-02'])
  assert.equal(query.scope.dates, null)
})

test('a backwards range is a problem, not a silent swap', () => {
  const { query, problems } = parse('2026-03-15..2026-03-01')
  assert.equal(problems.length, 1)
  assert.deepEqual(words(query), ['2026-03-15..2026-03-01'])
})

// ── quoting ────────────────────────────────────────────────

test('quoting escapes a selector back into text', () => {
  const { query } = parse('"#wombats" "2026-03"')
  assert.deepEqual(words(query), ['#wombats', '2026-03'])
  assert.deepEqual(query.scope.tags, [])
  assert.equal(query.scope.dates, null)
})

test('a quoted run is several terms, exactly as an unquoted one would be', () => {
  assert.deepEqual(words(parse('"foo bar"').query), words(parse('foo bar').query))
})

test('an unclosed quote is a field being typed in, not an error', () => {
  const { query, problems } = parse('foo "bar baz')
  assert.deepEqual(words(query), ['foo', 'bar', 'baz'])
  assert.deepEqual(problems, [])
})

test('a regex is refused out loud rather than silently searched for slashes', () => {
  const { query, problems } = parse('/wombats?/')
  assert.equal(problems.length, 1)
  assert.match(problems[0]?.why ?? '', /regular expression/)
  assert.deepEqual(words(query), ['/wombats?/'], 'and the characters survive')
})

// ── case ───────────────────────────────────────────────────

test('auto folds a lower-case query and respects a capital', () => {
  assert.equal(parse('surveyor').query.fold, true)
  assert.equal(parse('Surveyor').query.fold, false)
})

test('auto reads the phrase, not the tags — a tag has no case to read', () => {
  assert.equal(parse('#House survey').query.fold, true)
})

test('and an explicit choice wins over the convention', () => {
  assert.equal(parse('Surveyor', { ...PARAMS, fold: 'insensitive' }).query.fold, true)
  assert.equal(parse('surveyor', { ...PARAMS, fold: 'sensitive' }).query.fold, false)
})

// ── empty ──────────────────────────────────────────────────

test('an empty field is a query that matches nothing, not everything', () => {
  assert.equal(isEmpty(parse('').query), true)
  assert.equal(isEmpty(parse('   ').query), true)
})

test('but a scope on its own is a whole query — that is the subject view', () => {
  assert.equal(isEmpty(parse('#wombats').query), false)
  assert.equal(isEmpty(parse('2026-03').query), false)
})

test('and so is a document handed in with no text at all', () => {
  const scope: Scope = { ...EVERYWHERE, document: 'notebook.stream' as DocumentId }
  assert.equal(isEmpty(parse('', { ...PARAMS, scope }).query), false)
})

// ── the inverse pair ───────────────────────────────────────

const ROUND_TRIP: readonly string[] = [
  'call the surveyor',
  'foo #wombats',
  "#'house deal' survey",
  '#house #urgent',
  '2026-03',
  '2026-12',
  '2026-03-09',
  '2026-03-01..2026-03-15',
  'foo #wombats 2026-03',
  '"#wombats"',
  '"2026-03-01"',
  'Surveyor',
  '',
  '#house #urgent 2026-03-01..2026-06-30 the survey came back',
]

test('THE PROPERTY: format then parse is the identity on queries', () => {
  for (const text of ROUND_TRIP) {
    const original = parse(text).query
    const { text: written, params } = formatQuery(original)
    assert.deepEqual(parseQuery(written, params).query, original, `${text} → ${written}`)
  }
})

test('parse then format is stable, though not always the text typed', () => {
  // A person may write one query many ways; there is one way to write it down.
  for (const text of ROUND_TRIP) {
    const once = formatQuery(parse(text).query)
    const twice = formatQuery(parseQuery(once.text, once.params).query)
    assert.deepEqual(twice, once, text)
  }
})

test('format moves scope INTO the text and out of the params', () => {
  // Otherwise the pair doubles rather than inverts: parsing the text back with
  // params that still carry the tags would add them twice.
  const { text, params } = formatQuery(parse('foo #wombats 2026-03').query)
  assert.match(text, /#wombats/)
  assert.deepEqual(params.scope.tags, [])
  assert.equal(params.scope.dates, null)
})

test('but the document stays in the params, because it has no spelling', () => {
  const scope: Scope = { ...EVERYWHERE, document: 'tasks.todo' as DocumentId }
  const query = parse('foo', { ...PARAMS, scope }).query
  const { text, params } = formatQuery(query)
  assert.equal(text, 'foo')
  assert.equal(params.scope.document, 'tasks.todo')
})

test('format never says auto, because auto is a rule for reading typing', () => {
  assert.equal(formatQuery(parse('Surveyor').query).params.fold, 'sensitive')
  assert.equal(formatQuery(parse('surveyor').query).params.fold, 'insensitive')
})

test('a term that would read back as a selector is quoted on the way out', () => {
  assert.equal(formatQuery(parse('"#wombats"').query).text, '"#wombats"')
  assert.equal(formatQuery(parse('"2026-03"').query).text, '"2026-03"')
})

test('even a range that admits nothing round-trips', () => {
  const empty = parse('2026-03 2026-06').query
  const { text, params } = formatQuery(empty)
  assert.deepEqual(parseQuery(text, params).query, empty)
})
