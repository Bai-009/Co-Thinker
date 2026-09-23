import { composeReference, splitReference } from '../workbench/references';

// A source is session + position + exact content, never a fuzzy text search.
// The content snapshot is also its version. No hash collision can silently retarget it.
export function messageText(message) {
  return message?.role === 'user' ? message.content || '' : (message?.voices || []).join('\n\n');
}
export function makeReference(messages, index, session, text, offset = 0) {
  const content = messageText(messages[index]);
  return { text, source: '对话原文', anchor: { session, index, content, offset } };
}
export function resolveReference(ref, messages, session) {
  const a = ref?.anchor;
  return a && a.session === session && messageText(messages[a.index]) === a.content ? a.index : -1;
}
export function encodeReference(text, ref) {
  const value = composeReference(text, ref);
  return ref?.anchor ? `[CT_REFERENCE:${encodeURIComponent(JSON.stringify(ref.anchor))}]\n${value}` : value;
}
export function decodeReference(value) {
  const match = value.match(/^\[CT_REFERENCE:([^\n]+)\]\n/);
  let anchor;
  if (match) { try { anchor = JSON.parse(decodeURIComponent(match[1])); } catch {} }
  const parsed = splitReference(match ? value.slice(match[0].length) : value);
  return { ...parsed, anchor };
}
export const isSubmitKey = e => e.key === 'Enter' && !e.shiftKey && !e.isComposing && !e.nativeEvent?.isComposing && e.keyCode !== 229;
