import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {steps,seedId,initialNotes} from './scenario';
let call;
beforeEach(async()=>{localStorage.clear();vi.resetModules();vi.useFakeTimers();({previewFetch:call}=await import('./preview'));});
afterEach(()=>vi.useRealTimers());
const request=content=>({method:'POST',headers:{'X-Session-Id':seedId},body:JSON.stringify({content})});
async function send(path,text){const response=await call(path,request(text));const read=response.text();await vi.runAllTimersAsync();await read;}
it('a revision invalidates a pending memory update from the discarded turn',async()=>{
 await send('/api/chat/workshop',steps[0].input);
 // The narrative update is pending; replacing that input must invalidate it.
 await send('/api/chat/edit','这个说法不对，我还在重新考虑。');
 await vi.advanceTimersByTimeAsync(2000);
 const notes=await(await call('/api/chat/foundation',{headers:{'X-Session-Id':seedId}})).json();
 expect(notes.foundation_narrative).toBe(initialNotes.foundation_narrative);
 expect(notes.foundation_narrative).not.toBe(steps[0].narrative);
 const history=await(await call('/api/chat/history',{headers:{'X-Session-Id':seedId}})).json();
 expect(history.messages.filter(m=>m.role==='user').map(m=>m.content)).not.toContain(steps[0].input);
});
it('stores unhandled input without inventing new foundation assertions',async()=>{
 await send('/api/chat/workshop','我想探索的是完全不同的一件事情。');
 const notes=await(await call('/api/chat/foundation',{headers:{'X-Session-Id':seedId}})).json();
 expect(notes.foundation_narrative).toBe(initialNotes.foundation_narrative);
 const history=await(await call('/api/chat/history',{headers:{'X-Session-Id':seedId}})).json();
 expect(history.messages.at(-1).content).toContain('尚未连接模型');
});
