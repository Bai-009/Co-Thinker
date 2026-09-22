import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { isSubmitKey } from "./Workbench";
import { hydrateMessages } from "./useWorkbench";
import useWorkbench from "./useWorkbench";
import { sessionedFetch, setSessionId, getSessionId } from "../lib/session";
import { API } from "../lib/api";
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("does not submit Chinese IME confirmation or Shift+Enter", () => {
  expect(
    isSubmitKey({ key: "Enter", nativeEvent: { isComposing: true } }),
  ).toBe(false);
  expect(isSubmitKey({ key: "Enter", keyCode: 229 })).toBe(false);
  expect(isSubmitKey({ key: "Enter", shiftKey: true })).toBe(false);
  expect(
    isSubmitKey({ key: "Enter", nativeEvent: { isComposing: false } }),
  ).toBe(true);
});
it("keeps ended punctuation-neutral and interrupted replies explicit", () => {
  const m = hydrateMessages([
    {
      role: "assistant",
      content: "[VOICE][INTERRUPTED]“an unfinished thought”[/VOICE]",
    },
  ])[0];
  expect(m.voices).toEqual(["“an unfinished thought”"]);
  expect(m.interrupted).toBe(true);
  expect(m.streaming).toBeUndefined();
});
it("a late response cannot replace a newly selected session id", async () => {
  setSessionId("old");
  let resolve;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise((r) => (resolve = r))),
  );
  const pending = sessionedFetch("/api/chat/history");
  setSessionId("new");
  resolve(new Response("{}", { headers: { "X-Session-Id": "old" } }));
  await pending;
  expect(getSessionId()).toBe("new");
});
describe("workbench session races", () => {
  it("does not render a stale conversation after selecting another", async () => {
    let resolveHistory;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const id = init?.headers?.get("X-Session-Id");
        if (url === API.history && id === "old")
          return new Promise((r) => (resolveHistory = r));
        const data =
          url === API.sessions
            ? { sessions: [] }
            : url === API.history
              ? { messages: [{ role: "user", content: "new thought" }] }
              : url === API.foundation
                ? { foundation: "new memory", memory: { state: "ready" } }
                : { model_configured: false };
        return new Response(JSON.stringify(data));
      }),
    );
    const { result, unmount } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let oldPromise;
    act(() => {
      oldPromise = result.current.select("old");
    });
    await waitFor(() => expect(resolveHistory).toBeTypeOf("function"));
    await act(() => result.current.select("new"));
    await act(async () => {
      resolveHistory(
        new Response(
          JSON.stringify({
            messages: [{ role: "user", content: "old thought" }],
          }),
        ),
      );
      await oldPromise;
    });
    expect(result.current.messages[0].content).toBe("new thought");
    unmount();
  });
});
