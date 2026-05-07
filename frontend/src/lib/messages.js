// Convert a server-stored assistant message back into voices + confidences.
// Current format: [VOICE]\n[CONF]0.7[/CONF]\nbody\n[/VOICE] blocks.
// Older formats kept for backward compatibility.

const CONF_RE = /\[CONF\]([\s\S]*?)\[\/CONF\]/

export function parseStoredVoices(content) {
  if (!content) return { voices: [], confs: [] }
  const trimmed = content.trim()

  if (trimmed.includes('[VOICE]')) {
    const re = /\[VOICE\]([\s\S]*?)\[\/VOICE\]/g
    const voices = []
    const confs = []
    let m
    while ((m = re.exec(trimmed)) !== null) {
      const body = m[1]
      const cm = body.match(CONF_RE)
      let text = body
      let conf = 0.5
      if (cm) {
        const f = parseFloat(cm[1].trim())
        if (!Number.isNaN(f)) conf = Math.max(0, Math.min(1, f))
        text = body.replace(CONF_RE, '')
      }
      const cleaned = text.trim()
      if (cleaned) {
        voices.push(cleaned)
        confs.push(conf)
      }
    }
    return { voices, confs }
  }

  // Legacy "[视角 N] ..." format from very early sessions.
  if (trimmed.startsWith('[视角')) {
    const voices = trimmed
      .split(/\n\n(?=\[视角\s*\d+\])/)
      .map((part) => part.replace(/^\[视角\s*\d+\]\s*/, '').trim())
      .filter(Boolean)
    return { voices, confs: voices.map(() => 0.5) }
  }

  return { voices: [], confs: [] }
}

// Strip protocol blocks (foundation/sense/scratchpad/narrative) from a
// stored assistant message. If only protocol blocks remain after the
// strip (silent turn that only carried foundation updates), returns
// empty. Used by hydration to decide whether to show the message.
const PROTOCOL_BLOCK_RE =
  /\[(?:FOUNDATION_NARRATIVE|FOUNDATION|SENSE|SCRATCHPAD|FOUNDATION_CHANGE)\][\s\S]*?\[\/(?:FOUNDATION_NARRATIVE|FOUNDATION|SENSE|SCRATCHPAD|FOUNDATION_CHANGE)\]/g

export function stripProtocolBlocks(content) {
  if (!content) return ''
  return content.replace(PROTOCOL_BLOCK_RE, '').trim()
}

export function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// Parse a foundation list ("1. xxx\n2. yyy\n...") into array of items.
// Continuation lines (no "N." prefix) fold into the previous item.
export function parseFoundationItems(text) {
  if (!text) return []
  const lines = text.split('\n')
  const items = []
  let current = null
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[\.、]\s*(.*)$/)
    if (m) {
      if (current !== null) items.push(current)
      current = m[2].trim()
    } else if (current !== null) {
      const trimmed = line.trim()
      if (trimmed) current = current ? current + ' ' + trimmed : trimmed
    }
  }
  if (current !== null) items.push(current)
  return items.filter((s) => s.length > 0)
}

// Split a markdown brief on `## ` headings into {heading, body} sections.
export function parseBriefSections(text) {
  if (!text) return []
  const parts = text.split(/(?:^|\n)##\s+/).map((s) => s.trim()).filter(Boolean)
  return parts.map((part) => {
    const newlineIdx = part.indexOf('\n')
    if (newlineIdx < 0) return { heading: part, body: '' }
    return {
      heading: part.slice(0, newlineIdx).trim(),
      body: part.slice(newlineIdx + 1).trim(),
    }
  })
}
