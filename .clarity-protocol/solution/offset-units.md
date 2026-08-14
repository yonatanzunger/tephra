# Offset units — options and analysis

**Resolved as D24: opaque `Offset`, unit UTF-16 code units.** Kept for its reasoning, and for the runner-up's revisit condition.

## Where offsets actually appear

| Position | Consumer | Native unit of that consumer |
|---|---|---|
| `BufferPosition` | CodeMirror, in a loaded window | UTF-16 code units |
| `DocumentPosition.offset` | The API surface; spans; journal records | none — ours to choose |
| `StoragePosition.offset` | Locating a date's content within files | none — ours to choose |
| File I/O | Reading and writing files | UTF-8 bytes |

## Two facts that reframe the question

**1. Nothing durable holds an offset, by construction.** D11 already forbids it: bookmarks and tags are markers in the text, section entries reference names, links resolve by lookup. **The only serialised offsets anywhere are inside the journal**, which is a transient write-ahead log, discarded at quiescence, written and read by one build of one app. So "we would be serialising UTF-16" is a much smaller claim than it sounds — and it is also slightly mis-stated: the journal is UTF-8 JSON containing integers. We would never write UTF-16 *as an encoding* to disk. We would write a number whose semantics happen to be a count of UTF-16 code units.

**2. The document↔storage boundary is file-granular, not offset-granular.** Writes are whole-file atomic replacements; reads load whole files. At measured volume a day file is around 100 KB, so nothing ever needs to seek into an undecoded file. Byte offsets are therefore never *required* as an addressing unit — bytes appear only in operations that take no offsets at all.

Together these dissolve most of the case for bytes and most of the case against UTF-16.

**The remaining structural fact:** conversion is nearly free when it is a byproduct of a bulk transcode you are already doing — decoding a file on load, encoding it on save. It is expensive when it must be maintained incrementally against a buffer being edited at 130 WPM.

## The options

### 1. UTF-16 code units everywhere

Buffer, document and storage positions all in UTF-16; bytes confined to file I/O.

- **For:** zero conversion at the only boundary crossed on the hot path. Native to both target platforms — JavaScript and Kotlin alike. Simplest possible mental model: one unit, one invariant.
- **Against:** a JS/Java-era artifact promoted to a domain concept. If a future implementation is Rust or Swift, its native string type is UTF-8 and every position needs converting.
- **Cost of being wrong:** low, because no durable artifact records an offset.

### 2. Unicode code points everywhere

- **For:** principled and representation-independent.
- **Against:** **pays at both boundaries and gains none.** Code point↔UTF-16 needs surrogate counting; code point↔byte needs a scan. Nothing consumes code points natively. This is the worst of the three uniform options and is listed for completeness.

### 3. UTF-8 bytes everywhere

- **For:** matches disk, matches every external tool, matches Rust. Portable by default.
- **Against:** puts an incrementally-maintained conversion on the hot path. Every editor edit must translate UTF-16→bytes, which needs a prefix-sum structure over the buffer maintained under edits — a Fenwick tree or equivalent, O(log n) per operation, plus the code to keep it correct. Buys portability we have no consumer for, since rule 4 keeps search inside the Document API rather than handing it to ripgrep.

### 4. Split: UTF-16 in the buffer, bytes in document and storage

- **For:** the API's serialised form is portable; the storage boundary is free.
- **Against:** the *hot* boundary is the one that pays, which is exactly backwards. Same Fenwick-tree cost as option 3, for the same non-existent consumer.

### 5. Split: UTF-16 in buffer and document, bytes in storage only

- **For:** hot path free; conversion happens only during whole-file transcode, where it is a byproduct.
- **Against:** given fact 2 above, `StoragePosition` never actually needs byte semantics — files are decoded whole. So this option is **option 1 with an extra unit that earns nothing.**

### 6. Line-based document positions — `(date, line, column)`

The one genuinely different shape, and it deserves consideration rather than dismissal.

- **For:** lines are the granularity of merge — append-union and textual merge3 are both line-based — so positions would align with reconciliation instead of cutting across it. Line indices are stable under edits *within* other lines, which is better locality than character offsets. Columns are short, so any column-unit conversion is genuinely free. And it matches how this corpus is actually measured: "40–50 thousand lines a month."
- **Against:** a three-component position with lexicographic comparison, in an API where two-component positions were already the compromise. Line indices still shift when lines are added or removed, so it reduces rather than removes invalidation. And the locality argument is largely already won by the date partition — a single date holds roughly 1500 lines, so offsets within it are small numbers that shift rarely.
- **Verdict:** the merge alignment is a real argument and the only one that would justify the complexity. It is worth revisiting if the format spec finds that merge wants line addresses anyway.

### 7. Opaque `Offset` — orthogonal to all of the above

Make `Offset` a branded type with no public arithmetic: callers get spans from the API (`snap`, `read`, search results, selections) and combine them through Document helpers rather than doing sums.

- **For:** the unit becomes reversible. Given how much of this design has been revised under new information — twice today by a single fact — buying reversibility on a decision with no strong winner is worth something.
- **Against:** manual arithmetic is occasionally natural and would need helpers. Probably a small cost, since callers rarely construct offsets from nothing.

## Resolution — D24

**Option 1, with option 7 layered over it: UTF-16 code units, behind an opaque `Offset` type.**

The two reframing facts remove the objections that made bytes attractive — nothing durable records an offset, and the storage boundary takes no offsets — while the hot-path argument for UTF-16 stands unopposed. Opacity keeps the door open at very low cost.

**The invariant, which every option needs equally:** no position may fall inside a character. In UTF-16 that means never between surrogates; in bytes it would mean never mid-sequence. Cheap to assert, and worth asserting at construction rather than discovering at a render.
