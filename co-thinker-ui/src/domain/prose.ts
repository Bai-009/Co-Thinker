// 地基叙述的分段。只决定在哪里换段，不改一个字。
// 后台写了换行就照换行；只有一整段、又长到一屏读不完时，才在句号处断开：
// 「还没定」这类转向没定之事的句子另起一段，其余每段攒到三四句、一百来字。
// 断出来的一段太短（比如只剩「还没认下。」一句），就并回前一段，不让一句话孤零零地占一段。

const TURN = /^(还没定|还没有定|没定|还没|另一件|另外|至于|不过|但是|但)/
const SOFT_LIMIT = 110
const MIN_PARAGRAPH = 20

export function paragraphs(prose: string): string[] {
  const lines = prose
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (lines.length !== 1) return lines
  const text = lines[0]
  if (text.length <= SOFT_LIMIT) return [text]

  // 句子带着自己的句末标点和随后的收引号。
  const sentences = text.match(/[^。！？]+(?:[。！？]+[」』”’）]*|$)/g) ?? [text]
  const out: string[] = []
  let current = ''
  for (const raw of sentences) {
    const sentence = raw.trim()
    if (!sentence) continue
    const turn = TURN.test(sentence)
    if (current && (turn || current.length >= SOFT_LIMIT)) {
      out.push(current)
      current = ''
    }
    current += sentence
  }
  if (current) out.push(current)
  const merged: string[] = []
  for (const p of out) {
    if (merged.length && p.length < MIN_PARAGRAPH) merged[merged.length - 1] += p
    else merged.push(p)
  }
  if (merged.length > 1 && merged[0].length < MIN_PARAGRAPH) merged.splice(0, 2, merged[0] + merged[1])
  return merged
}
