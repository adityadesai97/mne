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

/**
 * Renders each page of a PDF to a JPEG image using pdfjs-dist.
 * At scale=1.5 (108 DPI) a letter-size page is ~918×1188 px ≈ 1,450 tokens —
 * far cheaper than a native document block while preserving full table layout.
 * Used for Claude provider where image vision gives accurate table reads.
 */
export async function renderPdfPages(
  base64: string,
  scale = 2.0,
): Promise<Array<{ data: string; mediaType: 'image/jpeg' }>> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const doc = await pdfjs.getDocument({ data: bytes }).promise
  const images: Array<{ data: string; mediaType: 'image/jpeg' }> = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    // JPEG at 0.85 quality keeps file size small without losing text legibility
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    images.push({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg' })
  }

  return images
}

/** Extracts plain text from a PDF using pdfjs-dist (lazy loaded).
 *  Groups text items by their y-coordinate so table rows are reconstructed
 *  correctly instead of all items being joined into one unreadable string.
 *  Used as a fallback for providers that cannot process image blocks (e.g. Groq).
 */
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

    // Each item's transform is [scaleX, skewY, skewX, scaleY, x, y].
    // Group by rounded y (row), sort rows top-to-bottom, sort items left-to-right.
    const rowMap = new Map<number, Array<{ x: number; text: string }>>()
    for (const item of content.items) {
      if (!('str' in item) || !(item as any).str.trim()) continue
      const [, , , , x, y] = (item as any).transform as number[]
      const row = Math.round(y)
      if (!rowMap.has(row)) rowMap.set(row, [])
      rowMap.get(row)!.push({ x, text: (item as any).str })
    }
    const lines = [...rowMap.entries()]
      .sort((a, b) => b[0] - a[0]) // descending y → top to bottom
      .map(([, items]) =>
        items
          .sort((a, b) => a.x - b.x) // left to right
          .map(i => i.text)
          .join('  '), // double-space suggests column separation
      )
    pages.push(lines.join('\n'))
  }
  return pages.join('\n\n')
}

/**
 * Parses a File into a FileAttachment.
 * - CSV: reads as text
 * - PDF: reads as base64; also pre-extracts text for Groq fallback
 */
export async function parseFileAttachment(file: File): Promise<FileAttachment & { extractedText?: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const isImageByExt = ext === 'png'
    || ext === 'jpg'
    || ext === 'jpeg'
    || ext === 'webp'
    || ext === 'gif'
    || ext === 'bmp'
    || ext === 'svg'
    || ext === 'heic'
    || ext === 'heif'
  const isImageByMime = file.type.startsWith('image/')
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
  if (isImageByExt || isImageByMime) {
    const dataUrl = await readAsDataURL(file)
    const [prefix, base64] = dataUrl.split(',')
    const fallbackExt = ext === 'jpg' ? 'jpeg' : (ext || 'png')
    const mediaType = prefix.match(/^data:([^;]+);base64$/)?.[1] || file.type || `image/${fallbackExt}`
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
