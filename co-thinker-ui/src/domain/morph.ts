// 同一条共识的两个说法之间，哪些字留着，哪些是旧的，哪些是新的。
// 中文一字一格，英文单词和数字整块算一格，空白单独一格。

export type MorphSide = 'keep' | 'old' | 'new'
export type MorphSegment = [text: string, side: MorphSide]

export function morphTokens(text: string): string[] {
  return text.match(/[A-Za-z0-9_]+|\s+|[\s\S]/gu) ?? []
}

/** 按最长公共子序列对齐，返回按阅读顺序排好的片段。旧说法是 keep + old，新说法是 keep + new。 */
export function morphSegments(from: string, to: string): MorphSegment[] {
  const a = morphTokens(from)
  const b = morphTokens(to)
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: MorphSegment[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([a[i], 'keep'])
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push([a[i++], 'old'])
    } else {
      out.push([b[j++], 'new'])
    }
  }
  while (i < n) out.push([a[i++], 'old'])
  while (j < m) out.push([b[j++], 'new'])
  return out
}
