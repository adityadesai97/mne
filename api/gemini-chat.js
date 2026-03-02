const GEMINI_OPENAI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authorization = req.headers.authorization
  if (!authorization) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})

  try {
    const upstream = await fetch(GEMINI_OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
      },
      body: rawBody,
    })

    const text = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    return res.send(text)
  } catch (error) {
    return res.status(502).json({
      error: 'Gemini proxy request failed',
      details: error instanceof Error ? error.message : String(error),
    })
  }
}
