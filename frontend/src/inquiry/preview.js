import { scenarios, wrapVoices } from './scenarios';
import { decodeReference } from './references';
const KEY = 'cothinker.inquiry.preview.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const emptyNotes = () => ({ foundation: '', foundation_narrative: '', open_questions: [], memory: { state: 'empty' } });
function makeSample(id, kind = 'spark') {
  const scene = scenarios[kind];
  const notes = { foundation_narrative: scene.narrative, focus: scene.title, open_questions: [scene.question], material: scene.material, preview_kind: kind, preview_step: 0, revision_count: 1, memory: { state: 'ready', covered_messages: 4, total_messages: 4 } };
  return { id, kind, title: scene.title, stage: 0, version: 0, messages: scene.seed.map(([role, content]) => ({ role, content: role === 'assistant' ? wrapVoices([content]) : content })), notes, snapshots: [{ prefix: 4, stage: 0, notes: clone(notes) }], updated_at: Date.now() / 1000 };
}
let db;
try { db = JSON.parse(localStorage.getItem(KEY)); } catch {}
if (!db || !db['inquiry-seed']) db = { 'inquiry-seed': makeSample('inquiry-seed'), 'inquiry-bookshop': makeSample('inquiry-bookshop', 'bookshop') };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
const abort = () => new DOMException('Aborted', 'AbortError');
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abort());
    const cancel = () => { clearTimeout(timer); reject(abort()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
const json = (data, id, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...(id ? { 'X-Session-Id': id } : {}) } });
function stream(id, signal, run) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ async start(controller) {
    const emit = event => { if (signal?.aborted) throw abort(); controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
    try { await run(emit); } catch (e) { if (e.name !== 'AbortError') controller.error(e); } finally { try { controller.close(); } catch {} }
  } }), { headers: { 'Content-Type': 'text/event-stream', 'X-Session-Id': id } });
}
export async function previewFetch(input, init = {}) {
  const path = String(input), signal = init.signal;
  if (signal?.aborted) throw abort();
  for (const s of Object.values(db)) {
    if (!s.pending || Date.now() < s.pending.at) continue;
    const p = s.pending; delete s.pending;
    if (p.version === s.version) {
      s.notes = { ...p.next, memory: { state: 'ready', covered_messages: p.prefix, total_messages: s.messages.length } };
      s.snapshots.push({ prefix: p.prefix, stage: p.stage, notes: clone(s.notes) }); save();
    }
  }
  const id = new Headers(init.headers).get('X-Session-Id') || 'inquiry-seed';
  if (path === '/health') return json({ status: 'ok', model_configured: false, preview: true });
  if (path === '/api/preview/new') {
    const kind = JSON.parse(init.body || '{}').kind || 'spark';
    const fresh = 'inquiry-' + crypto.randomUUID(); db[fresh] = makeSample(fresh, kind); save(); return json({ id: fresh }, fresh);
  }
  if (path.endsWith('/sessions')) return json({ sessions: Object.values(db).filter(s => s.messages.length).sort((a,b) => b.updated_at-a.updated_at).map(s => ({ id: s.id, title: s.title, message_count: s.messages.length, updated_at: s.updated_at })) });
  if (init.method === 'DELETE') { delete db[decodeURIComponent(path.split('/').pop())]; save(); return json({ ok: true }); }
  if (!db[id]) db[id] = { id, kind: 'spark', title: '新的思考', stage: -1, version: 0, messages: [], notes: emptyNotes(), snapshots: [], updated_at: Date.now()/1000 };
  const s = db[id];
  if (path.endsWith('/history')) return json({ messages: s.messages }, id);
  if (path.endsWith('/foundation')) return json({ ...s.notes, revisions: s.snapshots.map(x => ({ prefix: x.prefix, text: x.notes.foundation_narrative, change: x.notes.change })) }, id);
  if (path.endsWith('/memory/retry')) { s.notes.memory.state = s.notes.foundation_narrative ? 'ready' : 'empty'; save(); return json({ ok: true }, id); }
  if (path.endsWith('/brief')) {
    // Freeze before streaming. Later messages cannot bleed into the draft.
    const snapshot = clone(s);
    const uncovered = snapshot.messages.slice(snapshot.notes.memory?.covered_messages || 0).filter(m => m.role === 'user').map(m => decodeReference(m.content).text);
    const text = `# ${snapshot.title}\n\n${snapshot.notes.foundation_narrative || '尚未形成稳定的判断。'}\n\n## 仍在推敲\n\n${(snapshot.notes.open_questions || []).join('\n\n') || '尚未明确。'}${uncovered.length ? '\n\n## 新增表达，尚待核对\n\n' + uncovered.map(x => '> '+x).join('\n\n') : ''}\n\n## 交接边界\n\n保留暂定解释与未决关系。具体方案尚未决定，不自动进入实施。\n\n---\n交互示例，使用预设内容。`;
    return stream(id, signal, async emit => { for (const chunk of text.match(/[\s\S]{1,16}/g) || []) { await delay(15, signal); emit({ type: 'brief_delta', content: chunk }); } emit({ type: 'brief_done', brief: text }); });
  }
  let text = JSON.parse(init.body || '{}').content || '';
  if (path.endsWith('/edit') || path.endsWith('/retry')) {
    const index = s.messages.map(m => m.role).lastIndexOf('user');
    if (index >= 0) { if (path.endsWith('/retry')) text = s.messages[index].content; s.messages = s.messages.slice(0,index); }
    s.version++; delete s.pending;
    s.snapshots = s.snapshots.filter(x => x.prefix <= s.messages.length);
    const last = s.snapshots.at(-1); s.notes = last ? clone(last.notes) : emptyNotes(); s.stage = last?.stage ?? -1;
  }
  const scene = scenarios[s.kind], step = scene.steps[s.stage];
  const plain = decodeReference(text).text;
  const normalized = x => x.replace(/[\s，。！？、；：“”‘’"'「」『』,.!?;:]/g, '');
  const match = step && normalized(plain) === normalized(step.input);
  const isOpening = !s.messages.length && normalized(plain) === normalized(scene.opening);
  const voices = match ? step.voices : isOpening ? [scene.seed[1][1]] : ['这条表达已保留在本地。当前使用预设对话，没有调用模型；可载入示例继续查看交互。'];
  const version = s.version;
  s.messages.push({ role:'user', content:text }); s.updated_at = Date.now()/1000;
  if (s.title === '新的思考') s.title = plain.slice(0,28); save();
  return stream(id, signal, async emit => {
    const partial = [];
    try {
      emit({ type:'turn_started' });
      for (let index=0; index<voices.length; index++) {
        await delay(index ? 170 : 220, signal); partial[index]='';
        for (const chunk of voices[index].match(/[\s\S]{1,4}/g) || []) { await delay(25, signal); partial[index]+=chunk; emit({ type:'voice_delta', index, content:chunk }); }
      }
      if (s.version !== version) return;
      s.messages.push({ role:'assistant', content:wrapVoices(partial) });
      if (match) {
        const prefix = s.messages.length;
        const next = { ...s.notes, foundation_narrative: step.narrative, open_questions:[step.question], material:{ ...step.material, sourceIndex:prefix-1 }, change:step.change, preview_kind:s.kind, preview_step:s.stage+1, revision_count:(s.notes.revision_count||0)+1 };
        s.stage++; s.notes.memory = { ...s.notes.memory, state:'updating', total_messages:prefix };
        s.pending={ version, prefix, stage:s.stage, next, at:Date.now()+1000 };
      }
      save(); emit({type:'done', voices:partial});
    } catch (e) {
      if(e.name==='AbortError' && s.version===version) { s.messages.push({ role:'assistant', content:wrapVoices(partial.filter(Boolean).map(x=>'[INTERRUPTED]'+x)) }); save(); }
      throw e;
    }
  });
}
