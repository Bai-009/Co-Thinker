import { useEffect, useState } from "react";

function read(key) {
  if (!key) return [];
  try {
    const items = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(items)
      ? items.filter((x) => typeof x?.text === "string" && typeof x?.original === "string")
      : [];
  } catch { return []; }
}

// Deliberately separate from model memory. Keeping a passage is not agreement.
export default function useDesk(sessionId, preview) {
  const key = sessionId ? `cothinker.desk.v1:${preview ? "preview" : "live"}:${sessionId}` : null;
  const [cache, setCache] = useState(() => ({ key, items: read(key) }));
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState(null);
  useEffect(() => {
    setCache({ key, items: read(key) });
    setError("");
    setRemoved(null);
  }, [key]);
  const items = cache.key === key ? cache.items : read(key);
  const commit = (next) => {
    if (!key) return false;
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch {
      setError("浏览器暂时无法保存手边内容。原对话仍保留。");
      return false;
    }
    setCache({ key, items: next });
    setError("");
    return true;
  };
  return {
    items,
    error,
    removed: removed?.key === key ? removed.item : null,
    add(text, source = "Co-Thinker") {
      const current = read(key), original = text.trim();
      const existing = current.find((x) => x.original === original && x.source === source);
      if (existing) return existing.id;
      if (!original || !key) return null;
      const item = { id: crypto.randomUUID(), text: original, original, source };
      return commit([...current, item]) ? item.id : null;
    },
    edit(id, text) {
      if (!text.trim()) return false;
      return commit(read(key).map((x) => x.id === id ? { ...x, text: text.trim() } : x));
    },
    remove(id) {
      const current = read(key), item = current.find((x) => x.id === id);
      if (item && commit(current.filter((x) => x.id !== id)))
        setRemoved({ key, item, index: current.indexOf(item) });
    },
    undo() {
      if (!removed || removed.key !== key) return;
      const current = read(key);
      current.splice(removed.index, 0, removed.item);
      if (commit(current)) setRemoved(null);
    },
  };
}
