import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useThoughtSession from '../core/useThoughtSession';
import { isPreview } from '../lib/environment';
import { sessionedFetch } from '../lib/session';
import { scenarios } from './scenarios';
import { decodeReference, encodeReference, makeReference, messageText, resolveReference, isSubmitKey } from './references';

const Markdown = ({ children }) => <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ''}</ReactMarkdown>;
function Icon({ name }) {
  const shapes = {
    history: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4v16m4-11h5m-5 4h4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, close:<path d="m6 6 12 12M6 18 18 6"/>,
    arrow: <path d="M12 19V5m-5 5 5-5 5 5"/>, stop: <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>,
    quote: <><path d="M10 7H5v6h5V7Zm9 0h-5v6h5V7ZM10 13c0 3-2 4-4 4m13-4c0 3-2 4-4 4"/></>,
    edit: <><path d="m5 16-1 4 4-1L19 8l-3-3L5 16Zm9-9 3 3M12 20h8"/></>,
    book: <><path d="M12 6c-3-2-7-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-1-9 1Zm0 0v14"/></>,
    export: <><path d="M12 15V3m-4 4 4-4 4 4M5 11H4v10h16V11h-1"/></>,
    back: <path d="M19 12H5m6-6-6 6 6 6"/>, link: <><path d="m9 15 6-6m-6 2-2 2a3 3 0 0 0 4 4l2-2m0-2 2-2a3 3 0 0 0-4-4L9 7"/></>,
    down: <path d="M12 5v14m-5-5 5 5 5-5"/>, check: <path d="m5 12 4 4L19 6"/>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H4v13h4"/></>,
    refresh: <path d="M5 8a8 8 0 1 1-1 7M5 3v5h5"/>, more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{shapes[name] || shapes.plus}</svg>;
}
function IconButton({ name, label, className = '', ...props }) {
  return <button type="button" className={`i-icon ${className}`} aria-label={label} title={label} {...props}><Icon name={name}/></button>;
}
function Modal({ open, title, onClose, children, className = '' }) {
  const ref = useRef(null);
  useEffect(() => { const el=ref.current; if(open && !el.open) el.showModal(); else if(!open && el.open) el.close(); }, [open]);
  return <dialog ref={ref} className={`i-modal ${className}`} aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target !== ref.current) return; const r=ref.current.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}>
    <header><h2>{title}</h2><IconButton name="close" label={`关闭${title}`} onClick={onClose}/></header>{children}
  </dialog>;
}
function useNarrow() {
  const [narrow,setNarrow]=useState(()=>window.matchMedia('(max-width: 860px)').matches);
  useEffect(()=>{const media=window.matchMedia('(max-width: 860px)'); const update=()=>setNarrow(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  return narrow;
}
const memoryLabels={ ready:'已更新', updating:'更新中', pending:'待更新', empty:'尚未形成', error:'暂未更新' };
export default function Inquiry() {
  const w=useThoughtSession(), preview=isPreview(), narrow=useNarrow();
  const [draft,setDraft]=useState(''),[reference,setReference]=useState(null),[editing,setEditing]=useState(false);
  const [panel,setPanel]=useState('material'),[mobilePanel,setMobilePanel]=useState(false),[nav,setNav]=useState(false),[about,setAbout]=useState(false);
  const [selection,setSelection]=useState(null),[highlight,setHighlight]=useState(-1),[atBottom,setAtBottom]=useState(true),[notice,setNotice]=useState('');
  const [copied,setCopied]=useState(false),[briefScope,setBriefScope]=useState(null),[snapshotVersion,setSnapshotVersion]=useState(0);
  const reader=useRef(null),input=useRef(null),stick=useRef(true),savedDrafts=useRef({}),beforeEdit=useRef(null),noticeTimer=useRef(null);
  const title=w.notes.focus||w.sessions.find(s=>s.id===w.currentId)?.title||'新的思考';
  const state=w.notes.memory?.state||'empty';
  const material=w.notes.material;
  const runtime=preview||Boolean(w.health?.model_configured&&!w.health.offline);
  const latestUser=w.messages.map(m=>m.role).lastIndexOf('user');
  const kind=w.notes.preview_kind||'spark';
  const next=scenarios[kind]?.steps[w.notes.preview_step||0];
  const staleBrief=briefScope && (briefScope.session!==w.currentId||briefScope.version!==snapshotVersion||briefScope.count!==w.messages.length);
  function notify(text){setNotice(text);clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setNotice(''),3500);}
  useEffect(()=>()=>clearTimeout(noticeTimer.current),[]);
  useLayoutEffect(()=>{const el=input.current;if(el){el.style.height='auto';el.style.height=Math.min(144,Math.max(44,el.scrollHeight))+'px';}},[draft]);
  useLayoutEffect(()=>{if(stick.current&&reader.current)reader.current.scrollTop=reader.current.scrollHeight;},[w.messages,w.loading]);
  function jump(index){
    const element=reader.current?.querySelector(`[data-message-index="${index}"]`);
    if(!element){notify('这段原文不在当前记录中。');return;}
    setHighlight(index);setMobilePanel(false);stick.current=false;
    requestAnimationFrame(()=>element.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
  }
  function locate(ref){const index=resolveReference(ref,w.messages,w.currentId);if(index<0)notify('原文已发生变化，请重新选择引用。');else jump(index);}
  function quote(text,index,offset=0){
    if(!text.trim())return;
    setReference(makeReference(w.messages,index,w.currentId,text.trim(),offset));setSelection(null);setHighlight(index);setMobilePanel(false);
    window.getSelection()?.removeAllRanges();requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));
  }
  function quoteGround(){setReference({text:w.notes.foundation_narrative||w.notes.foundation,source:'当前地基'});setMobilePanel(false);input.current?.focus({preventScroll:true});}
  function captureSelection(){
    const s=window.getSelection();
    if(!s||s.isCollapsed||!reader.current?.contains(s.anchorNode)||!reader.current?.contains(s.focusNode)){setSelection(null);return;}
    const element=(s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement)?.closest('[data-message-index]');
    const end=(s.focusNode.nodeType===1?s.focusNode:s.focusNode.parentElement)?.closest('[data-message-index]');
    if(!element||element!==end){setSelection(null);return;}
    const copy=element.querySelector('.i-message-copy');
    if(!copy?.contains(s.anchorNode)||!copy.contains(s.focusNode)){setSelection(null);return;}
    const rect=s.getRangeAt(0).getBoundingClientRect();
    const range=s.getRangeAt(0).cloneRange();range.selectNodeContents(copy);range.setEnd(s.getRangeAt(0).startContainer,s.getRangeAt(0).startOffset);
    setSelection({text:s.toString(),index:Number(element.dataset.messageIndex),offset:range.toString().length,x:Math.max(12,Math.min(rect.left,window.innerWidth-146)),y:Math.max(70,rect.top-44)});
  }
  function startEdit(message){
    beforeEdit.current={draft,reference};const parsed=decodeReference(message.content);
    setDraft(parsed.text);setReference(parsed.quote?{text:parsed.quote,source:parsed.source,anchor:parsed.anchor}:null);setEditing(true);
    input.current?.focus({preventScroll:true});
  }
  function cancelEdit(){setDraft(beforeEdit.current?.draft||'');setReference(beforeEdit.current?.reference||null);setEditing(false);}
  async function send(){
    if(!draft.trim()) {if(w.streaming)await w.stop();return;}
    if(!runtime||w.loading)return;
    const text=reference?encodeReference(draft,reference):draft;const mode=editing?'edit':'send';
    if(editing)setSnapshotVersion(v=>v+1);
    setDraft('');setReference(null);setEditing(false);setHighlight(-1);stick.current=true;setAtBottom(true);
    input.current?.focus({preventScroll:true});await w.send(text,mode);
  }
  async function selectSession(id){
    savedDrafts.current[w.currentId]={draft,reference};
    const saved=savedDrafts.current[id];setDraft(saved?.draft||'');setReference(saved?.reference||null);setEditing(false);setHighlight(-1);setNav(false);setMobilePanel(false);setSelection(null);setAtBottom(true);stick.current=true;
    await w.select(id);
  }
  async function newSample(sampleKind=kind){try{const r=await sessionedFetch('/api/preview/new',{method:'POST',body:JSON.stringify({kind:sampleKind})});if(!r.ok)throw Error();const d=await r.json();await selectSession(d.id);}catch{notify('示例未能载入，当前讨论仍然保留。');}}
  function showPanel(value){setPanel(value);if(narrow)setMobilePanel(true);}
  function fillSample(){if(draft.trim())return;setDraft(next?.input||scenarios[kind].opening);input.current?.focus({preventScroll:true});}
  function startBrief(){setBriefScope({session:w.currentId,count:w.messages.length,version:snapshotVersion});w.generateBrief();}
  async function copyBrief(){try{await navigator.clipboard.writeText(w.brief.text);setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{notify('复制未完成，可以下载 Markdown。');}}
  function downloadBrief(){const url=URL.createObjectURL(new Blob([w.brief.text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='Co-Thinker-Brief.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const panelContent=<>
    <div className="i-panel-nav"><button className={panel==='material'?'active':''} onClick={()=>setPanel('material')}>手边</button><button className={panel==='foundation'?'active':''} onClick={()=>setPanel('foundation')}>地基</button><span className={`i-memory ${state}`} role="status">{state==='updating'&&<i/>}{memoryLabels[state]}</span></div>
    {panel==='material'?<>
      {material?<div className="i-material"><div className="i-material-heading"><h2>{material.title}</h2><span>正在推敲</span></div>
        <div className="i-comparison">{material.items.map((item,index)=><section key={index} className="i-alternative">
          <h3>{item.title}</h3><p>{item.detail}</p>
          <div className="i-material-actions"><button onClick={()=>jump(material.sourceIndex)}><Icon name="link"/>原文</button><button onClick={()=>quote(item.text,material.sourceIndex)}><Icon name="quote"/>引用</button></div>
        </section>)}</div>
        {w.notes.change&&<p className="i-change"><Icon name="edit"/>{w.notes.change}</p>}
      </div>:<div className="i-panel-empty"><p>需要反复推敲的内容，可以引用到输入框中。</p><span>选中一句，接着说。</span></div>}
      <button className="i-foundation-peek" onClick={()=>setPanel('foundation')}><span>地基</span><p>{w.notes.foundation_narrative||'对话中的理解在后台逐步沉淀。'}</p><small>展开查看 <span>↗</span></small></button>
    </>:<div className="i-foundation">
      {w.notes.foundation_narrative||w.notes.foundation?<><div className="i-prose"><Markdown>{w.notes.foundation_narrative||w.notes.foundation}</Markdown></div>
        {!!w.notes.open_questions?.length&&<section className="i-open-questions"><h3>还在想</h3>{w.notes.open_questions.map((q,i)=><p key={i}>{q}</p>)}</section>}
        <button className="i-text-button" onClick={quoteGround}><Icon name="quote"/>引用并继续</button>
        {w.notes.revisions?.length>1&&<details className="i-revisions"><summary>此前的理解</summary>{w.notes.revisions.slice(0,-1).reverse().map((r,i)=><article key={i}><p>{r.text}</p><small>{r.change||'最初的理解'}</small></article>)}</details>}
      </>:<div className="i-panel-empty"><p>尚未形成地基。</p><span>可以继续表达，已有理解会在后台更新。</span></div>}
      {['error','pending'].includes(state)&&<button className="i-text-button" onClick={w.retryMemory}>重新更新地基</button>}
    </div>}
  </>;
  return <div className="inquiry-app">
    <header className="i-topbar">
      <div className="i-brand"><IconButton name="history" label="打开思考记录" onClick={()=>setNav(true)}/><span className="i-wordmark">Co-Thinker</span></div>
      <div className="i-top-actions"><button className="i-action" onClick={()=>showPanel('foundation')} aria-label="查看地基"><Icon name="book"/><span>地基</span></button><button className="i-action" aria-label="Brief" onClick={startBrief} disabled={!w.messages.length||w.streaming||!runtime}><Icon name="export"/><span>Brief</span></button><span className="i-top-divider"/><IconButton name="plus" label="新的思考" onClick={()=>selectSession('')}/></div>
    </header>
    <div className="i-layout">
      <main className="i-main">
        <div className="i-title-row"><h1>{title}</h1><button className="i-mobile-material" onClick={()=>showPanel('material')}>手边 <span>↗</span></button></div>
        <div ref={reader} className="i-reader" tabIndex={0} aria-label="讨论内容" onMouseUp={captureSelection} onKeyUp={captureSelection} onScroll={()=>{const el=reader.current;const bottom=el.scrollHeight-el.clientHeight-el.scrollTop<60;stick.current=bottom;setAtBottom(bottom);setSelection(null);}}>
          {w.loading?<p className="i-empty-state" role="status">正在载入…</p>:!w.messages.length?<div className="i-start"><h2>从一个还没想清楚的念头开始。</h2><p>一个疑问、一段经历，或一件说不清为什么的事。</p></div>:<div className="i-thread">{w.messages.map((message,index)=>{
            const parsed=message.role==='user'?decodeReference(message.content):null;
            return <article key={message.id} data-message-index={index} className={`i-message ${message.role==='user'?'i-expression':'i-response'} ${highlight===index?'is-pointed':''}`} aria-label={message.role==='user'?'输入':'回应'}>
              <div className="i-message-copy">{parsed?<>
                {parsed.quote&&<button className="i-inline-quote" onClick={()=>locate({anchor:parsed.anchor})} disabled={!parsed.anchor}><Icon name="quote"/><span>{parsed.quote}</span></button>}
                <Markdown>{parsed.text}</Markdown>
              </>:message.voices?.map((voice,i)=><div className="i-voice" key={i}><Markdown>{voice}</Markdown></div>)}</div>
              {message.streaming&&!message.voices?.some(Boolean)&&<span className="i-waiting" role="status">正在回应<span>…</span></span>}
              {message.streaming&&message.voices?.some(Boolean)&&<span className="i-stream-mark" aria-label="正在回应"/>}
              {!message.streaming&&<div className="i-message-tools"><IconButton name="quote" label={`引用第 ${index+1} 条内容`} onClick={()=>quote(parsed?.text||messageText(message),index)}/>{index===latestUser&&!w.streaming&&<IconButton name="edit" label="回改最近一次输入" onClick={()=>startEdit(message)}/>}</div>}
              {message.interrupted&&<div className="i-inline-state">已停止{index===w.messages.length-1&&!w.streaming&&<button disabled={!runtime} onClick={()=>w.send('','retry')}>重新回应</button>}</div>}
              {message.error&&<div className="i-error" role="alert">{message.error}<button onClick={()=>w.send('','retry')}>重试</button></div>}
            </article>;
          })}</div>}
        </div>
        <div className="i-composer-area">
          {!atBottom&&<button className="i-to-latest" onClick={()=>{stick.current=true;reader.current.scrollTo({top:reader.current.scrollHeight,behavior:'instant'});}}><Icon name="down"/>回到最新</button>}
          {w.error&&<p role="alert" className="i-error">{w.error}</p>}
          {!preview&&w.health&&!runtime&&<p className="i-error">当前未连接模型。<a href="./inquiry.html?preview=1">查看交互示例</a></p>}
          <form className={`i-composer ${editing?'is-editing':''}`} onSubmit={e=>{e.preventDefault();send();}}>
            {editing&&<div className="i-edit-status"><span>回改最近一次输入 · 后续内容将重新展开</span><button type="button" onClick={cancelEdit}>取消</button></div>}
            {reference&&<div className="i-quote-preview"><button type="button" className="i-quote-text" onClick={()=>reference.anchor?locate(reference):showPanel('foundation')}><Icon name="quote"/><span>{reference.text}</span></button><IconButton name="close" label="移除引用" onClick={()=>setReference(null)}/></div>}
            <label className="i-sr" htmlFor="inquiry-input">继续输入</label>
            <textarea id="inquiry-input" ref={input} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(isSubmitKey(e)){e.preventDefault();send();}}} placeholder={w.messages.length?'接着想……':'从这里写起……'} rows={1}/>
            <div className="i-composer-bottom"><span className="i-input-state">{w.streaming?'可以继续补充':reference?'引用不代表认同':''}</span><button type="submit" className="i-send" disabled={(!draft.trim()&&!w.streaming)||!runtime||w.loading} aria-label={w.streaming&&!draft.trim()?'停止回复':editing?'提交修改':w.streaming?'发送补充':'发送'}><Icon name={w.streaming&&!draft.trim()?'stop':'arrow'}/></button></div>
          </form>
          <footer className="i-footnote"><button onClick={()=>setAbout(true)}>{preview?'交互示例 · 未调用模型':'Co-Thinker'}</button>{preview?<button onClick={next?fillSample:()=>newSample()} disabled={!!draft.trim()||w.streaming||state==='updating'}>{next?'载入下一句':'重新体验'} <span>↗</span></button>:<span>Shift ↵ 换行</span>}</footer>
        </div>
      </main>
      {!narrow&&<aside className="i-rail" aria-label="相关材料">{panelContent}</aside>}
    </div>
    {selection&&<button className="i-selection-action" style={{left:selection.x,top:selection.y}} onMouseDown={e=>e.preventDefault()} onClick={()=>quote(selection.text,selection.index,selection.offset)}><Icon name="quote"/>引用并继续</button>}
    {notice&&<div className="i-notice" role="status">{notice}</div>}
    <Modal open={narrow&&mobilePanel} title="相关材料" onClose={()=>setMobilePanel(false)} className="i-mobile-sheet"><div className="i-sheet-content">{panelContent}</div></Modal>
    <Modal open={nav} title="思考记录" onClose={()=>setNav(false)} className="i-records">
      <div className="i-record-list"><button className="i-new-record" onClick={()=>selectSession('')}><Icon name="plus"/>新的思考</button>{w.sessions.map(s=><button key={s.id} className={s.id===w.currentId?'selected':''} onClick={()=>selectSession(s.id)}><span>{s.title}</span>{s.id===w.currentId&&<small>当前</small>}</button>)}</div>
      {preview&&<footer><button onClick={()=>newSample('spark')}>灵感与记录示例</button><button onClick={()=>newSample('bookshop')}>书店讨论示例</button></footer>}
    </Modal>
    <Modal open={w.brief.open} title="Brief" onClose={w.closeBrief} className="i-brief">
      <div className="i-brief-body">{staleBrief&&<p className="i-version-note">讨论已有变化，这份 Brief 保留生成时的内容。<button onClick={startBrief}>重新生成</button></p>}
        {w.brief.loading&&!w.brief.text?<p role="status">正在整理…</p>:<Markdown>{w.brief.text}</Markdown>}
        {w.brief.error&&<p role="alert" className="i-error">{w.brief.error}<button onClick={startBrief}>重试</button></p>}
      </div><footer><span>{w.brief.loading?'生成中':'可继续回到讨论修订'}</span><div><button disabled={!w.brief.text||w.brief.loading} onClick={copyBrief}><Icon name={copied?'check':'copy'}/>{copied?'已复制':'复制'}</button><button disabled={!w.brief.text||w.brief.loading} onClick={downloadBrief}><Icon name="down"/>Markdown</button></div></footer>
    </Modal>
    <Modal open={about} title="交互示例" onClose={()=>setAbout(false)} className="i-about"><div className="i-prose"><p>当前使用预设讨论，未调用模型。输入框下方的“载入下一句”只填入文字，由你决定是否发送。</p><p>可以引用、补充、停止、回改最近输入，回看地基及此前的理解，或生成 Brief。其他输入会保留，但不会生成真实回答。</p><p>示例保存在本机，独立于正式会话。</p></div></Modal>
  </div>;
}
