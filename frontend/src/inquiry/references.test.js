import { describe,it,expect } from 'vitest';
import { makeReference,resolveReference,encodeReference,decodeReference,isSubmitKey } from './references';
describe('anchored references',()=>{
  const messages=[{role:'assistant',voices:['同一句话']},{role:'user',content:'另一个例子'},{role:'assistant',voices:['同一句话']}];
  it('keeps identical text at different positions distinct after hydration',()=>{
    const reference=makeReference(messages,2,'session-a','同一句话');
    const parsed=decodeReference(encodeReference('这句还没有确认。',reference));
    expect(parsed.text).toBe('这句还没有确认。');
    expect(parsed.quote).toBe('同一句话');
    expect(resolveReference(parsed,messages.map((m,i)=>({...m,id:'new-'+i})),'session-a')).toBe(2);
    expect(resolveReference(parsed,messages,'session-b')).toBe(-1);
    expect(resolveReference(parsed,messages.slice(0,2),'session-a')).toBe(-1);
  });
  it('refuses to retarget a source whose content was edited',()=>{
    const reference=makeReference(messages,2,'session-a','同一句话');
    const changed=[...messages];changed[2]={role:'assistant',voices:['已经改写']};
    expect(resolveReference(reference,changed,'session-a')).toBe(-1);
  });
  it('retains ordinary input and never treats IME confirmation as send',()=>{
    expect(decodeReference('普通输入').text).toBe('普通输入');
    expect(isSubmitKey({key:'Enter',nativeEvent:{isComposing:true}})).toBe(false);
    expect(isSubmitKey({key:'Enter',keyCode:229})).toBe(false);
    expect(isSubmitKey({key:'Enter',shiftKey:true})).toBe(false);
    expect(isSubmitKey({key:'Enter'})).toBe(true);
  });
});
