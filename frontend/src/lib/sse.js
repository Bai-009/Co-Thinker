// Parse a Response body whose payload is `data: <json>\n\n` events.
// Calls onEvent(parsed, raw) for each event. Resolves when the stream ends.
//
// This avoids the EventSource API because we POST a body — EventSource only
// supports GET. Plain fetch + ReadableStream lets us stream and dispatch.

export async function readSSE(response, onEvent, { signal } = {}) {
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        return
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const eventStr = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)

        const dataLines = eventStr
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
        if (dataLines.length === 0) continue

        let evt
        try {
          evt = JSON.parse(dataLines.join(''))
        } catch {
          continue
        }
        onEvent(evt)
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // already released
    }
  }
}
