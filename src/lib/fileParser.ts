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
 * Parses a File into a FileAttachment.
 * - CSV: reads as text
 * - PDF and images: read as base64 for Claude
 */
export async function parseFileAttachment(file: File): Promise<FileAttachment> {
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

const FEEDBACK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024 // 5MB

/**
 * Reads any file into base64 for a command-response feedback attachment
 * (e.g. a screenshot of the wrong output). Unlike parseFileAttachment, this
 * isn't restricted to csv/pdf/image — feedback isn't fed to the LLM, it's
 * stored as-is — but is size-capped since it's stored inline in the DB.
 */
export async function parseFeedbackAttachment(file: File): Promise<{ filename: string; mimeType: string; content: string }> {
  if (file.size > FEEDBACK_ATTACHMENT_MAX_BYTES) {
    throw new Error('Attachment is too large. Please attach a file under 5MB.')
  }
  const dataUrl = await readAsDataURL(file)
  const base64 = dataUrl.split(',')[1] ?? ''
  return { filename: file.name, mimeType: file.type || 'application/octet-stream', content: base64 }
}
