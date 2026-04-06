import { expect, test } from 'vitest'
import { parseFileAttachment } from '../lib/fileParser'

test('parses csv attachments as text', async () => {
  const file = new File(['symbol,shares\nAAPL,10\n'], 'positions.csv', { type: 'text/csv' })
  const parsed = await parseFileAttachment(file)

  expect(parsed).toEqual({
    type: 'csv',
    filename: 'positions.csv',
    content: 'symbol,shares\nAAPL,10\n',
  })
})

test('parses image attachments as base64', async () => {
  const file = new File(['fake image bytes'], 'note.png', { type: 'image/png' })
  const parsed = await parseFileAttachment(file)

  expect(parsed.type).toBe('image')
  expect(parsed.filename).toBe('note.png')
  expect(parsed.mediaType).toBe('image/png')
  expect(parsed.content.length).toBeGreaterThan(0)
})

test('rejects unsupported attachments', async () => {
  const file = new File(['{}'], 'data.json', { type: 'application/json' })

  await expect(parseFileAttachment(file)).rejects.toThrow(/\.csv, \.pdf, or image file/i)
})
