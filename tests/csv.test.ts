// The catalogue tables' CSV: quoted fields keep commas, doubled quotes and line breaks.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCsv } from '../src/csv.js'

test('quoted fields keep commas, doubled quotes and line breaks; empty cells stay empty', () => {
  const { columns, rows } = parseCsv('a,b\n"x, y","say ""hi""\nthen"\r\n,\n')
  assert.deepEqual(columns, ['a', 'b'])
  assert.deepEqual(rows, [
    { a: 'x, y', b: 'say "hi"\nthen' },
    { a: '', b: '' },
  ])
})

test('a header alone is a table without rows', () => {
  assert.deepEqual(parseCsv('set,producer\n'), { columns: ['set', 'producer'], rows: [] })
})

test('a row of another width or an unclosed quote is refused', () => {
  assert.throws(() => parseCsv('a,b\n1\n'), /CSV row 2 has 1 fields, not 2/)
  assert.throws(() => parseCsv('a\n"open\n'), /not closed/)
})
