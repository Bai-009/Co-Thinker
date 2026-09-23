import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import useDesk from "./useDesk";
import { composeReference, splitReference, sourceForPassage } from "./references";
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("keeps passages isolated through session switches and preview/live changes", () => {
  const { result, rerender } = renderHook(({ id, preview }) => useDesk(id, preview), { initialProps: { id:"a", preview:true } });
  act(() => result.current.add("只属于 A 的想法", "我的表达"));
  rerender({ id:"b", preview:true });
  expect(result.current.items).toEqual([]);
  act(() => result.current.add("B 的反例"));
  rerender({ id:"a", preview:false });
  expect(result.current.items).toEqual([]);
  rerender({ id:"a", preview:true });
  expect(result.current.items.map(x=>x.text)).toEqual(["只属于 A 的想法"]);
});
it("preserves the source through rewriting, reload and removal/undo", () => {
  const first = renderHook(() => useDesk("a", true));
  act(() => first.result.current.add("原来的解释"));
  const id = first.result.current.items[0].id;
  act(() => first.result.current.edit(id, "另一种解释"));
  first.unmount();
  const { result } = renderHook(() => useDesk("a", true));
  expect(result.current.items[0]).toMatchObject({text:"另一种解释",original:"原来的解释",source:"Co-Thinker"});
  act(() => result.current.remove(id));
  expect(result.current.items).toEqual([]);
  act(() => result.current.undo());
  expect(result.current.items[0].text).toBe("另一种解释");
});
it("does not report a successful save when browser storage rejects it", () => {
  const { result } = renderHook(() => useDesk("a", true));
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota");});
  let added;
  act(() => { added=result.current.add("不能丢失的表达"); });
  expect(added).toBeNull();
  expect(result.current.items).toEqual([]);
  expect(result.current.error).toContain("无法保存");
});
it("keeps a multi-paragraph candidate separate from the user's disagreement", () => {
  const reference = {source:"手边改写稿（尚待讨论）",text:"一个提案\n\n> 一个反例\n最后一句"};
  const stored=composeReference("我不同意第二个前提。",reference);
  expect(stored).toContain("引用不代表认同");
  expect(splitReference(stored)).toEqual({source:reference.source,quote:reference.text,text:"我不同意第二个前提。"});
  expect(splitReference("普通输入")).toEqual({text:"普通输入"});
});
it("locates selected rendered text across emphasis without mistaking a later quote for its source", () => {
  const item={original:"先保留一个反例，再继续思考",source:"Co-Thinker"};
  const source={id:"original",role:"assistant",voices:["先保留**一个反例**，再继续思考"]};
  const quote={id:"quoted",role:"user",content:item.original};
  expect(sourceForPassage([quote,source],item)).toBe(source);
  expect(sourceForPassage([quote],item)).toBeNull();
});
