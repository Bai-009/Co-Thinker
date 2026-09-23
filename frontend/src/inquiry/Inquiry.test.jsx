import React from 'react';
import { render,screen,fireEvent,cleanup } from '@testing-library/react';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import Inquiry from './Inquiry';
import { decodeReference } from './references';
const state=vi.hoisted(()=>({}));
vi.mock('../core/useThoughtSession',()=>({default:()=>state}));
beforeEach(()=>{
  window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
  Object.assign(state,{
    messages:[{id:'u',role:'user',content:'我在比较两种解释。'},{id:'a',role:'assistant',voices:['整理过早结束了探索，也可能是理解偏移。']}],
    notes:{focus:'两种解释',foundation_narrative:'我还在比较，尚未决定。',memory:{state:'ready'},material:{title:'两种可能',sourceIndex:1,items:[{title:'过早收敛',text:'整理过早结束了探索',detail:'还需要检验。'}]}},
    sessions:[],currentId:'a-session',health:{model_configured:true},loading:false,streaming:false,brief:{open:false,text:'',loading:false},
    select:vi.fn(),send:vi.fn(),stop:vi.fn(),generateBrief:vi.fn(),closeBrief:vi.fn(),retryMemory:vi.fn(),
  });
});
afterEach(cleanup);
it('keeps draft and reference through groundwork inspection without sending or confirming',()=>{
  render(<Inquiry/>);
  fireEvent.click(screen.getAllByRole('button',{name:'引用',exact:true})[0]);
  fireEvent.change(screen.getByRole('textbox',{name:'继续输入'}),{target:{value:'但不是所有整理都会这样。'}});
  fireEvent.click(screen.getByRole('button',{name:'查看地基'}));
  expect(screen.getByRole('textbox',{name:'继续输入'})).toHaveValue('但不是所有整理都会这样。');
  expect(screen.getByRole('button',{name:'移除引用'})).toBeInTheDocument();
  expect(state.send).not.toHaveBeenCalled();
  expect(state.notes.foundation_narrative).toBe('我还在比较，尚未决定。');
  fireEvent.click(screen.getByRole('button',{name:'发送',exact:true}));
  const sent=decodeReference(state.send.mock.calls[0][0]);
  expect(sent.quote).toBe('整理过早结束了探索');
  expect(sent.text).toBe('但不是所有整理都会这样。');
  expect(sent.anchor.index).toBe(1);
});
it('cancelling an edit restores the unsubmitted draft instead of replacing it',()=>{
  render(<Inquiry/>);
  const input=screen.getByRole('textbox',{name:'继续输入'});
  fireEvent.change(input,{target:{value:'未发送的另一个例子'}});
  fireEvent.click(screen.getByRole('button',{name:'回改最近一次输入'}));
  expect(input).toHaveValue('我在比较两种解释。');
  fireEvent.click(screen.getByRole('button',{name:'取消',exact:true}));
  expect(input).toHaveValue('未发送的另一个例子');
  expect(state.send).not.toHaveBeenCalled();
});
