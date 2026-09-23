// 两句话字面上有多像：按相邻两字的组合算重合（Dice 系数），0 到 1。
// 用来挑出后台列了两遍的同一件事，不做语义判断。

const bigrams = (s: string): string[] => {
  const chars = [...s.replace(/[\s，。、；：？！「」『』“”‘’（）,.;:?!()]/g, '')]
  return chars.slice(0, -1).map((c, i) => c + chars[i + 1])
}

export function similarity(a: string, b: string): number {
  const x = bigrams(a)
  const y = bigrams(b)
  if (!x.length || !y.length) return 0
  const pool = new Map<string, number>()
  y.forEach((g) => pool.set(g, (pool.get(g) ?? 0) + 1))
  let shared = 0
  x.forEach((g) => {
    const n = pool.get(g) ?? 0
    if (n > 0) {
      shared++
      pool.set(g, n - 1)
    }
  })
  return (2 * shared) / (x.length + y.length)
}

/** 前面的一条若和后面某条说的是同一件事，只留后面那条（后台把问题写在后面，通常更完整）。 */
export function dropRepeats(items: string[], threshold = 0.4): string[] {
  return items.filter((item, i) => !items.slice(i + 1).some((later) => similarity(item, later) >= threshold))
}
