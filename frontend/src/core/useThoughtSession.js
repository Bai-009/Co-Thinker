import { useCallback, useEffect, useRef, useState } from "react";
import { API, getJSON, postStream } from "../lib/api";
import {
  clearSessionId,
  getSessionId,
  setSessionId,
  sessionedFetch,
} from "../lib/session";
import {
  makeId,
  parseStoredVoices,
  stripProtocolBlocks,
} from "../lib/messages";
import { readSSE } from "../lib/sse";
import { isPreview, previewSeedId } from "../lib/environment";
const emptyNotes = () => ({
  foundation: "",
  foundation_narrative: "",
  focus: "",
  open_questions: [],
  memory: { state: "empty" },
});
export function hydrateMessages(raw) {
  return raw.flatMap((m) => {
    if (m.role === "user") return [{ ...m, id: makeId() }];
    if (m.role !== "assistant") return [];
    const parsed = parseStoredVoices(m.content);
    const voices = parsed.voices.length
      ? parsed.voices
      : [stripProtocolBlocks(m.content)].filter(Boolean);
    return voices.length
      ? [
          {
            id: makeId(),
            role: "assistant",
            voices,
            interrupted: parsed.interrupted.some(Boolean),
          },
        ]
      : [];
  });
}
export default function useThoughtSession() {
  const [messages, setMessages] = useState([]),
    [notes, setNotes] = useState(emptyNotes),
    [sessions, setSessions] = useState([]);
  const [currentId, setCurrentId] = useState(""),
    [streaming, setStreaming] = useState(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [health, setHealth] = useState(null);
  const [brief, setBrief] = useState({
    open: false,
    text: "",
    loading: false,
    error: "",
  });
  const scope = useRef(0),
    idRef = useRef(""),
    request = useRef(null),
    poll = useRef(null),
    hydration = useRef(null),
    briefRequest = useRef(null),
    alive = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const d = await getJSON(API.sessions);
      if (alive.current) setSessions(d.sessions || []);
    } catch {
      if (alive.current) setError("暂时无法读取对话列表。可以刷新重试。");
    }
  }, []);
  const stopPolling = () => {
    clearTimeout(poll.current);
    poll.current = null;
  };
  const syncNotes = useCallback(async function sync(
    expectedScope = scope.current,
  ) {
    if (!idRef.current || expectedScope !== scope.current) return;
    try {
      const d = await getJSON(API.foundation);
      if (!alive.current || expectedScope !== scope.current) return;
      setNotes(d);
      if (d.memory?.state === "updating")
        poll.current = setTimeout(() => sync(expectedScope), 850);
    } catch {
      if (alive.current && expectedScope === scope.current)
        setNotes((n) => ({
          ...n,
          memory: { state: "error", detail: "共同记录暂时无法读取。" },
        }));
    }
  }, []);
  const stop = useCallback(async () => {
    const r = request.current;
    if (!r) return;
    r.controller.abort();
    try {
      await r.promise;
    } catch {}
  }, []);
  const closeBrief = useCallback(() => {
    briefRequest.current?.abort();
    briefRequest.current = null;
    setBrief({ open: false, text: "", loading: false, error: "" });
  }, []);
  const select = useCallback(
    async (id) => {
      const ticket = ++scope.current;
      stopPolling();
      hydration.current?.abort();
      closeBrief();
      await stop();
      if (ticket !== scope.current || !alive.current) return;
      idRef.current = id;
      setCurrentId(id);
      setError("");
      setNotes(emptyNotes());
      setMessages([]);
      if (!id) {
        clearSessionId();
        setLoading(false);
        return;
      }
      setSessionId(id);
      setLoading(true);
      const controller = new AbortController();
      hydration.current = controller;
      try {
        const [history, n] = await Promise.all([
          getJSON(API.history, { signal: controller.signal }),
          getJSON(API.foundation, { signal: controller.signal }),
        ]);
        if (ticket !== scope.current || !alive.current) return;
        setMessages(hydrateMessages(history.messages || []));
        setNotes(n);
        if (n.memory?.state === "updating") syncNotes(ticket);
      } catch (e) {
        if (e.name !== "AbortError" && ticket === scope.current)
          setError("对话未能载入。内容仍保存在原处，请重试。");
      } finally {
        if (ticket === scope.current && alive.current) setLoading(false);
      }
    },
    [closeBrief, stop, syncNotes],
  );
  useEffect(() => {
    alive.current = true;
    refresh();
    getJSON(API.health)
      .then((d) => {
        if (alive.current) setHealth(d);
      })
      .catch(() => {
        if (alive.current) setHealth({ offline: true });
      });
    select(getSessionId() || (isPreview() ? previewSeedId() : ""));
    return () => {
      alive.current = false;
      scope.current++;
      stopPolling();
      hydration.current?.abort();
      request.current?.controller.abort();
      briefRequest.current?.abort();
    };
  }, [refresh, select]);
  const send = useCallback(
    async (text, mode = "send") => {
      if (!text.trim() && mode !== "retry") return;
      const startingScope = scope.current;
      await stop();
      if (startingScope !== scope.current) return;
      stopPolling();
      setError("");
      if (!idRef.current) {
        const id = crypto.randomUUID();
        idRef.current = id;
        setSessionId(id);
        setCurrentId(id);
      }
      const ticket = scope.current,
        assistantId = makeId(),
        controller = new AbortController();
      setMessages((prev) => {
        let next = prev;
        if (mode === "edit" || mode === "retry") {
          const index = prev.map((m) => m.role).lastIndexOf("user");
          next = index >= 0 ? prev.slice(0, index) : prev;
          if (mode === "retry") text = prev[index]?.content || text;
        }
        return [
          ...next,
          { id: makeId(), role: "user", content: text },
          { id: assistantId, role: "assistant", voices: [], streaming: true },
        ];
      });
      setStreaming(true);
      const update = (fn) => {
        if (alive.current && ticket === scope.current)
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? fn(m) : m)),
          );
      };
      const current = { controller, promise: null };
      request.current = current;
      current.promise = (async () => {
        let done = false,
          failed = false;
        try {
          const response = await postStream(
            mode === "edit"
              ? API.edit
              : mode === "retry"
                ? API.retry
                : API.workshop,
            { content: text },
            { signal: controller.signal },
          );
          await readSSE(
            response,
            (ev) => {
              if (ev.type === "turn_started" && mode !== "send")
                syncNotes(ticket);
              if (ev.type === "voice_delta")
                update((m) => {
                  const voices = [...m.voices];
                  voices[ev.index || 0] =
                    (voices[ev.index || 0] || "") + (ev.content || "");
                  return { ...m, voices };
                });
              if (ev.type === "done") {
                done = true;
                update((m) => ({
                  ...m,
                  voices: ev.voices || m.voices,
                  streaming: false,
                  silent: ev.silent,
                }));
              }
              if (ev.type === "error") {
                failed = true;
                update((m) => ({
                  ...m,
                  error: ev.detail || "连接中断，你的输入已保留。",
                  streaming: false,
                }));
              }
            },
            { signal: controller.signal },
          );
          if (!done && !failed && !controller.signal.aborted)
            throw new Error("incomplete stream");
        } catch (e) {
          if (e.name !== "AbortError" && !controller.signal.aborted)
            update((m) => ({
              ...m,
              error: "暂时无法连接模型。你的输入已保存，可以重试。",
            }));
        } finally {
          update((m) => ({
            ...m,
            streaming: false,
            interrupted: controller.signal.aborted,
          }));
          if (request.current === current) {
            request.current = null;
            if (alive.current) setStreaming(false);
          }
          if (alive.current && ticket === scope.current) {
            refresh();
            syncNotes(ticket);
          }
        }
      })();
      await current.promise;
    },
    [stop, refresh, syncNotes],
  );
  const generateBrief = useCallback(async () => {
    briefRequest.current?.abort();
    const controller = new AbortController();
    briefRequest.current = controller;
    const ticket = scope.current;
    let text = "",
      done = false;
    setBrief({ open: true, text: "", loading: true, error: "" });
    try {
      const response = await postStream(API.brief, null, {
        signal: controller.signal,
      });
      await readSSE(
        response,
        (ev) => {
          if (ticket !== scope.current || briefRequest.current !== controller)
            return;
          if (ev.type === "error") throw new Error(ev.detail);
          if (ev.type === "brief_delta") text += ev.content;
          if (ev.type === "brief_done") {
            text = ev.brief;
            done = true;
          }
          setBrief({ open: true, text, loading: !done, error: "" });
        },
        { signal: controller.signal },
      );
      if (!done && !controller.signal.aborted)
        throw new Error("生成中断，可以重试。");
    } catch (e) {
      if (
        e.name !== "AbortError" &&
        ticket === scope.current &&
        briefRequest.current === controller
      )
        setBrief({ open: true, text, loading: false, error: e.message });
    }
  }, []);
  const retryMemory = async () => {
    setNotes((n) => ({ ...n, memory: { state: "updating" } }));
    try {
      await postStream(API.memoryRetry);
      syncNotes();
    } catch {
      setNotes((n) => ({
        ...n,
        memory: { state: "error", detail: "记录暂未更新，请稍后再试。" },
      }));
    }
  };
  const remove = async (id) => {
    try {
      const r = await sessionedFetch(API.sessionDelete(id), {
        method: "DELETE",
      });
      if (!r.ok) throw Error();
      if (id === idRef.current) await select("");
      refresh();
    } catch {
      setError("删除未完成，对话仍保留。");
    }
  };
  return {
    messages,
    notes,
    sessions,
    currentId,
    streaming,
    loading,
    error,
    health,
    brief,
    select,
    send,
    stop,
    generateBrief,
    closeBrief,
    retryMemory,
    remove,
    refresh,
  };
}
