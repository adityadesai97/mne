export type FileAttachment = {
  type: 'csv' | 'pdf' | 'image'
  filename: string
  /** CSV: raw text content. Binary files: base64-encoded content (no data-URL prefix). */
  content: string
  mediaType?: string
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/** Extracts plain text from a PDF using pdfjs-dist (lazy loaded). */
async function extractPdfText(base64: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  // Set up the worker — use the bundled fake worker for simplicity
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const doc = await pdfjs.getDocument({ data: bytes }).promise
  const pages: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    pages.push(content.items.map((item: any) => ('str' in item ? item.str : '')).join(' '))
  }
  return pages.join('\n')
}

/**
 * Parses a File into a FileAttachment.
 * - CSV: reads as text
 * - PDF: reads as base64; also pre-extracts text for Groq fallback
 */
export async function parseFileAttachment(file: File): Promise<FileAttachment & { extractedText?: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'csv') {
    const content = await readAsText(file)
    return { type: 'csv', filename: file.name, content }
  }
  if (ext === 'pdf') {
    const dataUrl = await readAsDataURL(file)
    // Strip the "data:application/pdf;base64," prefix
    const base64 = dataUrl.split(',')[1]
    return { type: 'pdf', filename: file.name, content: base64, mediaType: 'application/pdf' }
  }
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') {
    const dataUrl = await readAsDataURL(file)
    const [prefix, base64] = dataUrl.split(',')
    const mediaType = prefix.match(/^data:([^;]+);base64$/)?.[1] || file.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`
    return { type: 'image', filename: file.name, content: base64, mediaType }
  }
  throw new Error(`Unsupported file type: .${ext ?? 'unknown'}. Please upload a .csv, .pdf, or image file.`)
}

/**
 * Extracts text from a PDF attachment (for Groq provider that can't read document blocks).
 * Lazy-loads pdfjs-dist so it doesn't bloat the main bundle for Claude users.
 */
export async function extractTextFromPdf(attachment: FileAttachment & { content: string }): Promise<string> {
  if (attachment.type !== 'pdf') throw new Error('Not a PDF attachment')
  return extractPdfText(attachment.content)
}
