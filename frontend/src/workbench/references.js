// Stored as readable text so both the foreground model and async memory see
// the distinction between a cited candidate and the user's own new statement.
export function composeReference(text, reference) {
  if (!reference) return text.trim();
  return `引用材料（${reference.source}，引用不代表认同）：\n> ${reference.text.replace(/\n/g, "\n> ")}\n\n${text.trim()}`;
}
export function splitReference(text) {
  const match = text.match(/^引用材料（([^\n]*)，引用不代表认同）：\n((?:>[^\n]*(?:\n|$))+)\n([\s\S]*)$/);
  if (!match) return { text };
  return {
    source: match[1],
    quote: match[2].trimEnd().split("\n").map((line) => line.replace(/^> ?/, "")).join("\n"),
    text: match[3],
  };
}

export function sourceForPassage(messages, item) {
  const normalize = (s) => s.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  const needle = normalize(item.original);
  if (!needle) return null;
  return messages.find((m) => {
    const role = item.source === "我的表达" ? "user" : "assistant";
    if (m.role !== role) return false;
    const content = m.role === "user" ? m.content : (m.voices || []).join("\n\n");
    return normalize(content).includes(needle);
  }) || null;
}
