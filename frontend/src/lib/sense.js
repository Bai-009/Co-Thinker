// Felt-sense atmosphere — drives the global ambient feeling.
//
// TWO orthogonal channels, never sharing visual properties:
//
// 1) Color temperature axis (certainty × resonance).
//    A 2D bilinear blend across 4 muted corner colors. Hue range is
//    intentionally narrow — never more than a few degrees apart — so
//    the page reads as one paper that's slightly warmer or cooler.
//
// 2) Clarity (judge AI). Drives the *texture* of the atmosphere:
//    grain density and atmosphere-edge softness. NEVER hue. When the
//    foundation is fuzzy the page reads like a slightly damp old
//    paper; when it's crisp the same paper has been pressed flat.
//
// The two channels are layered through different CSS custom properties.
//
// Corner anchors for color temperature (parchment family, never dark):
//   (0,0)  lost together         — pale cool gray
//   (1,0)  clear but disconnected — neutral cream
//   (0,1)  uncertain but felt    — muted lavender
//   (1,1)  in tune & confident   — warm sand

export const SENSE_BASE_CORNERS = {
  c00: [228, 230, 234],
  c10: [243, 239, 228],
  c01: [234, 228, 236],
  c11: [245, 235, 220],
}

export const SENSE_ACCENT_CORNERS = {
  c00: [165, 178, 196],
  c10: [192, 176, 142],
  c01: [180, 165, 198],
  c11: [210, 162, 128],
}

export function bilerp(corners, x, y) {
  const { c00, c10, c01, c11 } = corners
  const out = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const top = c00[i] * (1 - x) + c10[i] * x
    const bot = c01[i] * (1 - x) + c11[i] * x
    out[i] = Math.round(top * (1 - y) + bot * y)
  }
  return out
}

export function computeEngagement(x, y) {
  return Math.max(
    0,
    Math.min(1, Math.abs(x - 0.5) * 2 * 0.6 + Math.abs(y - 0.5) * 2 * 0.6),
  )
}

export function applySense(certainty, resonance) {
  const x = Math.max(0, Math.min(1, certainty))
  const y = Math.max(0, Math.min(1, resonance))

  const base = bilerp(SENSE_BASE_CORNERS, x, y)
  const accent = bilerp(SENSE_ACCENT_CORNERS, x, y)
  const engagement = computeEngagement(x, y)

  const root = document.documentElement
  root.style.setProperty('--sense-base', `rgb(${base[0]}, ${base[1]}, ${base[2]})`)
  root.style.setProperty('--sense-accent', `rgb(${accent[0]}, ${accent[1]}, ${accent[2]})`)
  root.style.setProperty('--sense-engagement', engagement.toFixed(3))
}

// Clarity → texture. Independent of color temperature.
//
//   --sense-grain : 0..1, opacity of the grain layer (low clarity = visible)
//   --sense-edge  : 0..1, sharpness of atmosphere gradient edges
//                       (low clarity = soft/diffuse, high = crisp)
//   --sense-haze  : px, a tiny blur applied to the atmosphere layer when
//                       things are unsettled. Capped at 1.6px so the page
//                       never looks broken — only slightly damp.
export function applyClarity(clarity) {
  const c = Math.max(0, Math.min(1, clarity))
  const fuzz = 1 - c
  const root = document.documentElement
  root.style.setProperty('--sense-grain', (0.06 + 0.34 * fuzz).toFixed(3))
  root.style.setProperty('--sense-edge', c.toFixed(3))
  root.style.setProperty('--sense-haze', `${(fuzz * 1.6).toFixed(2)}px`)
}
