// 感觉通道：驱动整页的氛围。两条互不共用视觉属性的通道——
// 1) 色温：certainty × resonance 在四个很接近的近白之间双线性混合，纸只是稍暖或稍冷，不带土色。
// 2) 清晰度：只管纹理——纸纹密度、氛围边缘的软硬、一点雾。不碰颜色。

export const SENSE_BASE_CORNERS = {
  c00: [242, 244, 246], // 一起迷路 —— 冷白
  c10: [246, 246, 243], // 清楚但没对上 —— 中性
  c01: [244, 243, 246], // 不确定但有感觉 —— 一点紫的白
  c11: [248, 246, 241], // 对上了也确定 —— 象牙
} as const

export const SENSE_ACCENT_CORNERS = {
  c00: [188, 198, 210],
  c10: [206, 206, 200],
  c01: [200, 196, 212],
  c11: [216, 206, 190],
} as const

type Corners = typeof SENSE_BASE_CORNERS | typeof SENSE_ACCENT_CORNERS

const clamp = (v: number) => Math.max(0, Math.min(1, v))

export function bilerp(corners: Corners, x: number, y: number): [number, number, number] {
  const { c00, c10, c01, c11 } = corners
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const top = c00[i] * (1 - x) + c10[i] * x
    const bot = c01[i] * (1 - x) + c11[i] * x
    out[i] = Math.round(top * (1 - y) + bot * y)
  }
  return out
}

export function computeEngagement(x: number, y: number): number {
  return clamp(Math.abs(x - 0.5) * 2 * 0.6 + Math.abs(y - 0.5) * 2 * 0.6)
}

export function applySense(certainty: number, resonance: number): void {
  const x = clamp(certainty)
  const y = clamp(resonance)
  const base = bilerp(SENSE_BASE_CORNERS, x, y)
  const accent = bilerp(SENSE_ACCENT_CORNERS, x, y)
  const root = document.documentElement
  root.style.setProperty('--sense-base', `rgb(${base[0]}, ${base[1]}, ${base[2]})`)
  root.style.setProperty('--sense-accent', `rgb(${accent[0]}, ${accent[1]}, ${accent[2]})`)
  root.style.setProperty('--sense-engagement', computeEngagement(x, y).toFixed(3))
}

// 清晰度低 = 纸纹明显、边缘软、有一点雾（最多 1.6px，不会糊）；高 = 压平的纸。
export function applyClarity(clarity: number): void {
  const c = clamp(clarity)
  const fuzz = 1 - c
  const root = document.documentElement
  root.style.setProperty('--sense-grain', (0.04 + 0.2 * fuzz).toFixed(3))
  root.style.setProperty('--sense-edge', c.toFixed(3))
  root.style.setProperty('--sense-haze', `${(fuzz * 1.6).toFixed(2)}px`)
}
