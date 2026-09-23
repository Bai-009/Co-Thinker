import React from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
const {useSession}=vi.hoisted(()=>({useSession:vi.fn()}));
vi.mock('../core/useThoughtSession',()=>({default:useSession}));
import ThoughtSpace,{isSubmitKey} from './ThoughtSpace';
import {splitReference} from '../workbench/references';
let state;
beforeEach(()=>{
 window.history.replaceState({},'', '/renewal.html?preview=1');
 state={messages:[{id:'u1',role:'user',content:'我需要再想一下。'},{id:'a1',role:'assistant',voices:['可以先留着这个问题。']}],notes:{foundation:'1. 我希望记录仍可继续修订。',foundation_narrative:'我希望记录仍可继续修订，具体怎样呈现还没有决定。',memory:{state:'ready'},preview_step:0},sessions:[],currentId:'x',streaming:false,loading:false,error:'',health:{model_configured:false},brief:{open:false},select:vi.fn(),send:vi.fn(async()=>{}),stop:vi.fn(),generateBrief:vi.fn(),closeBrief:vi.fn(),retryMemory:vi.fn()};
 useSession.mockReturnValue(state);
});
afterEach(()=>{cleanup();window.history.replaceState({},'', '/');vi.clearAllMocks();});
it('keeps an unfinished input when moving between the two views',()=>{
 render(<ThoughtSpace/>);const input=screen.getByRole('textbox',{name:'继续输入'});
 fireEvent.change(input,{target:{value:'这句话我还没说完'}});
 fireEvent.click(screen.getByRole('button',{name:'地基',exact:true}));
 expect(input).toHaveValue('这句话我还没说完');
 expect(screen.getByText(state.notes.foundation_narrative)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'对话',exact:true}));
 expect(input).toHaveValue('这句话我还没说完');expect(state.send).not.toHaveBeenCalled();
});
it('carries a foundation reference separately from the new expression',async()=>{
 render(<ThoughtSpace/>);fireEvent.click(screen.getByRole('button',{name:'地基',exact:true}));fireEvent.click(screen.getByRole('button',{name:'接着推敲'}));
 expect(state.send).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('textbox',{name:'继续输入'}),{target:{value:'这里仍然太早了'}});
 fireEvent.click(screen.getByRole('button',{name:'发送',exact:true}));
 await waitFor(()=>expect(state.send).toHaveBeenCalledOnce());
 expect(splitReference(state.send.mock.calls[0][0])).toEqual({source:'地基',quote:state.notes.foundation_narrative,text:'这里仍然太早了'});
 expect(state.send.mock.calls[0][1]).toBe('send');
});
it('editing the last input uses the revision path and cancel preserves a draft',async()=>{
 render(<ThoughtSpace/>);const input=screen.getByRole('textbox',{name:'继续输入'});
 fireEvent.change(input,{target:{value:'下一条想法'}});fireEvent.click(screen.getByRole('button',{name:'修改最近一次输入'}));
 expect(input).toHaveValue('我需要再想一下。');fireEvent.click(screen.getByRole('button',{name:'取消',exact:true}));expect(input).toHaveValue('下一条想法');
 fireEvent.click(screen.getByRole('button',{name:'修改最近一次输入'}));fireEvent.change(input,{target:{value:'原来的前提不成立'}});fireEvent.click(screen.getByRole('button',{name:'提交修改'}));
 await waitFor(()=>expect(state.send).toHaveBeenCalledWith('原来的前提不成立','edit'));
});
it('does not send a Chinese IME confirmation as a new turn',()=>{
 expect(isSubmitKey({key:'Enter',keyCode:229})).toBe(false);
 expect(isSubmitKey({key:'Enter',nativeEvent:{isComposing:true}})).toBe(false);
 expect(isSubmitKey({key:'Enter',shiftKey:true})).toBe(false);
});
