import React from 'react'

// Voice rendering. NO role labels (no "视角 N", no "[追问]"). The
// difference between voices is felt through:
//   - left stroke width (--voice-stroke)
//   - text opacity (--voice-opacity)
//   - font weight (--voice-weight)
// All driven by the per-voice confidence in [0, 1]. The hue stays
// the same across voices so they read as one paper, not a palette.

function confToCSSVars(conf) {
  const c = Math.max(0, Math.min(1, typeof conf === 'number' ? conf : 0.5))
  // Confidence 0.0–1.0 → these ranges. Values picked to keep the page
  // restrained: minimum stays readable, maximum never reads as "bold".
  const stroke = (0.4 + 1.6 * c).toFixed(2) + 'px' // 0.4 → 2.0
  const opacity = (0.62 + 0.36 * c).toFixed(3)     // 0.62 → 0.98
  const weight = Math.round(360 + 130 * c)         // 360 → 490
  return {
    '--voice-stroke': stroke,
    '--voice-opacity': opacity,
    '--voice-weight': weight,
  }
}

export default function MessageView({ msg }) {
  if (msg.role === 'user') {
    return (
      <article className="msg msg-user">
        <div className="msg-bubble">{msg.content}</div>
      </article>
    )
  }
  if (msg.role === 'system') {
    return (
      <article className="msg msg-system">
        <div className="msg-bubble">{msg.content}</div>
      </article>
    )
  }
  const voices = (msg.voices || []).filter((v) => v != null)
  const confs = msg.confs || []
  if (voices.length === 0) return null

  return (
    <article className="msg msg-assistant">
      <div className="voices">
        {voices.map((content, i) => {
          const isLast = i === voices.length - 1
          const stillStreaming =
            content && isLast && !content.match(/[。！？.!?]\s*$/)
          const conf = confs[i]
          return (
            <div
              key={i}
              className="voice"
              style={confToCSSVars(conf)}
              data-conf={
                typeof conf === 'number' ? conf.toFixed(2) : undefined
              }
            >
              <div className="voice-text">
                {content || <span className="voice-cursor">▍</span>}
                {stillStreaming && <span className="voice-cursor">▍</span>}
              </div>
            </div>
          )
        })}
      </div>
    </article>
  )
}
