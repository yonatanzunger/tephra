// Where this machine is (D63).
//
// Barely testable by nature — the answer is whatever the machine is set to, and
// a test cannot set it. What CAN be checked is the property the interface
// depends on: that the name read off the operating system is one the date code
// can actually compute in. A zone `Intl` rejects would take the offer out of
// the interface entirely and silently, which is the failure mode worth a test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { systemZone } from '../../../src/main/system-zone.ts'
import { isKnownZone } from '../../../src/shared/dates.ts'

test('the machine\'s zone is a zone this build knows', () => {
  assert.ok(isKnownZone(systemZone()), `${systemZone()} is not a zone Intl accepts`)
})

test('and it names a place, not an offset', () => {
  // `Etc/GMT+8` survives nothing: a country changing its rules moves the zone
  // and not the offset. The symlink names a place, and this is the check that
  // the parse kept it.
  assert.match(systemZone(), /^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/)
})
