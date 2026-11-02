// CSV as apb-catalog writes its catalogue tables (RFC 4180): a header row, comma-separated
// fields, quoted with '"' when they hold a comma, a quote or a line break, quotes doubled inside.

export type Row = Record<string, string>

export interface Table {
  columns: string[]
  rows: Row[]
}

// The header and every row of a CSV text, each row keyed by its column.
export function parseCsv(text: string): Table {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index)
    if (quoted) {
      if (char !== '"') field += char
      else if (text.charAt(index + 1) === '"') {
        field += '"'
        index += 1
      } else quoted = false
    } else if (char === '"') quoted = true
    else if (char === ',') {
      record.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(index + 1) === '\n') index += 1
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else field += char
  }
  if (quoted) throw new Error('a quoted CSV field is not closed')
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  const [columns = [], ...body] = records
  const rows = body.map((values, number) => {
    if (values.length !== columns.length) {
      throw new Error(`CSV row ${number + 2} has ${values.length} fields, not ${columns.length}`)
    }
    return Object.fromEntries(columns.map((column, at) => [column, values[at] ?? '']))
  })
  return { columns, rows }
}
