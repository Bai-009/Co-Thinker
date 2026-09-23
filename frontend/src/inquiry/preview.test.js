import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { readSSE } from '../lib/sse';
import { scenarios } from './scenarios';
let fetchPreview;
const headers={'X-Session-Id':'inquiry-seed'};
async function turn(path,text,signal){
  const events=[];
  const r=await fetchPreview(path,{headers,method:'POST',body:JSON.stringify({content:text}),signal});
  await readSSE(r,event=>events.push(event),{signal});return events;
}
async function drain(promise){await vi.runAllTimersAsync();return promise;}
beforeEach(async()=>{localStorage.clear();vi.resetModules();vi.useFakeTimers();fetchPreview=(await import('./preview')).previewFetch;});
afterEach(()=>vi.useRealTimers());
it('an edit prevents a pending old memory result from becoming current',async()=>{
  await drain(turn('/api/chat/workshop',scenarios.spark.steps[0].input));
  const pending=await (await fetchPreview('/api/chat/foundation',{headers})).json();
  expect(pending.memory.state).toBe('updating');
  await drain(turn('/api/chat/edit','这个条件还不确定。'));
  await vi.advanceTimersByTimeAsync(2000);
  const current=await (await fetchPreview('/api/chat/foundation',{headers})).json();
  expect(current.foundation_narrative).toBe(scenarios.spark.narrative);
  expect(current.foundation_narrative).not.toContain('列出未决问题反而');
});
it('freezes Brief before later messages and preserves uncovered input separately',async()=>{
  await drain(turn('/api/chat/workshop','不要把正在比较写成已经决定。'));
  const r=await fetchPreview('/api/chat/brief',{headers,method:'POST'});
  const events=[];const collected=readSSE(r,event=>events.push(event));
  const later=turn('/api/chat/workshop','这句属于下一版。');
  await vi.runAllTimersAsync();await Promise.all([collected,later]);
  const brief=events.find(e=>e.type==='brief_done').brief;
  expect(brief).toContain('新增表达，尚待核对');
  expect(brief).toContain('不要把正在比较写成已经决定。');
  expect(brief).not.toContain('这句属于下一版');
});
