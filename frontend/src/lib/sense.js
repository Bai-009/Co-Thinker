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
// Corner anchors for color temperature.
//   (0,0)  lost together         — pale cool gray
//   (1,0)  clear but disconnected — neutral cream
//   (0,1)  uncertain but felt    — muted lavender
//   (1,1)  in tune & confident   — warm sand
//
// Light corners are the parchment family. Dark corners are the same
// semantic emotions translated to "夜读灯下的旧期刊"——deep warm browns
// with the same hue family, never grayscale invert. Hue stays warm
// across both themes; lightness flips.

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

// Dark mode: same 4 emotional corners, set in deep warm brown lighting.
// Lightness ~7-12% (deep base) so text contrast holds; hue still warm
// with subtle cool/warm shifts at corners (cooler at lost, warmer at tuned).
export const SENSE_BASE_CORNERS_DARK = {
  c00: [22, 24, 28],   // pale cool gray → cold brown-gray
  c10: [30, 24, 18],   // neutral cream  → warm dark
  c01: [24, 22, 30],   // muted lavender → cool dusk
  c11: [34, 26, 16],   // warm sand      → ember
}

// Accents on dark sit higher in lightness (~30-45%) and saturated enough
// to glow when blended with `screen` mode against the deep base.
export const SENSE_ACCENT_CORNERS_DARK = {
  c00: [70, 84, 110],   // cool dusk blue
  c10: [120, 96, 64],   // warm tan
  c01: [88, 76, 118],   // muted plum
  c11: [150, 110, 70],  // amber ember
}

function currentTheme() {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
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

  const isDark = currentTheme() === 'dark'
  const baseCorners = isDark ? SENSE_BASE_CORNERS_DARK : SENSE_BASE_CORNERS
  const accentCorners = isDark ? SENSE_ACCENT_CORNERS_DARK : SENSE_ACCENT_CORNERS

  const base = bilerp(baseCorners, x, y)
  const accent = bilerp(accentCorners, x, y)
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
