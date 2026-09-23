import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useThoughtSession from '../core/useThoughtSession';
import {isPreview} from '../lib/environment';
import {sessionedFetch} from '../lib/session';
import {parseFoundationItems} from '../lib/messages';
import {composeReference,splitReference} from '../workbench/references';
import {steps,opening} from './scenario';
import Icon from './Icons';
const Markdown=({children})=><ReactMarkdown remarkPlugins={[remarkGfm]}>{children||''}</ReactMarkdown>;
export const isSubmitKey=e=>e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent?.isComposing&&!e.isComposing&&e.keyCode!==229;
const memoryLabels={empty:'尚未形成',updating:'更新中',pending:'有内容待更新',ready:'已更新',error:'暂未更新'};
function IconButton({name,label,...props}){return <button type="button" className="r-icon-button" aria-label={label} title={label} {...props}><Icon name={name}/></button>;}
function Modal({open,title,onClose,children,className=''}){
 const ref=useRef(null);
 useEffect(()=>{const el=ref.current;if(open&&!el.open)el.showModal();else if(!open&&el.open)el.close();},[open]);
 return <dialog ref={ref} className={`r-modal ${className}`} aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target!==ref.current)return;const r=ref.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}><header><h2>{title}</h2><IconButton name="close" label={`关闭${title}`} onClick={onClose}/></header>{children}</dialog>;
}
function InputText({text}){const p=splitReference(text);return <>{p.quote&&<blockquote className="r-source"><small>{p.source}</small><Markdown>{p.quote}</Markdown></blockquote>}<Markdown>{p.text}</Markdown></>;}
export default function ThoughtSpace(){
 const w=useThoughtSession(),preview=isPreview();
 const [view,setView]=useState('dialogue'),[draft,setDraft]=useState(''),[reference,setReference]=useState(null),[editing,setEditing]=useState(false);
 const [navOpen,setNavOpen]=useState(false),[aboutOpen,setAboutOpen]=useState(false),[copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');
 const [selection,setSelection]=useState(''),[atBottom,setAtBottom]=useState(true);
 const composer=useRef(null),reader=useRef(null),stick=useRef(true),positions=useRef({dialogue:0,foundation:0}),previousDraft=useRef(''),copyTimer=useRef(null);
 const runtimeAvailable=preview||Boolean(w.health?.model_configured&&!w.health?.offline);
 const latestUser=w.messages.map(m=>m.role).lastIndexOf('user');
 const sessionTitle=w.sessions.find(s=>s.id===w.currentId)?.title;
 const title=w.notes.focus||sessionTitle||'新的思考';
 const active=parseFoundationItems(w.notes.foundation).filter(s=>!s.startsWith('~~'));
 const archived=parseFoundationItems(w.notes.foundation).filter(s=>s.startsWith('~~'));
 const hasFoundation=!!(w.notes.foundation_narrative||active.length);
 const memoryState=w.notes.memory?.state||'empty';
 useLayoutEffect(()=>{const el=composer.current;if(el){el.style.height='auto';el.style.height=Math.min(152,Math.max(32,el.scrollHeight))+'px';}},[draft]);
 useLayoutEffect(()=>{if(view==='dialogue'&&stick.current&&reader.current)reader.current.scrollTop=reader.current.scrollHeight;},[w.messages,w.loading,view,draft,reference]);
 useEffect(()=>()=>clearTimeout(copyTimer.current),[]);
 useEffect(()=>{positions.current={dialogue:0,foundation:0};stick.current=true;setReference(null);setEditing(false);setSelection('');},[w.currentId]);
 function changeView(next,{latest=false}={}){if(next===view)return;if(reader.current)positions.current[view]=reader.current.scrollTop;setSelection('');setView(next);requestAnimationFrame(()=>{const el=reader.current;if(!el)return;el.scrollTop=latest?el.scrollHeight:(positions.current[next]||0);if(next==='dialogue'){stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<72;setAtBottom(stick.current);}});}
 async function selectSession(id){setNavOpen(false);setDraft('');setReference(null);setEditing(false);setView('dialogue');stick.current=true;await w.select(id);composer.current?.focus();}
 function quote(text,source='地基'){if(!text?.trim())return;setReference({text:text.trim(),source});setSelection('');window.getSelection()?.removeAllRanges();requestAnimationFrame(()=>composer.current?.focus());}
 function startEditing(m){previousDraft.current=draft;const p=splitReference(m.content);setDraft(p.text);setReference(p.quote?{text:p.quote,source:p.source}:null);setEditing(true);composer.current?.focus();}
 function cancelEditing(){setEditing(false);setDraft(previousDraft.current);setReference(null);}
 async function send(){
  if(!draft.trim()){if(w.streaming)await w.stop();return;}
  if(w.loading||(!preview&&w.health&&!w.health.model_configured))return;
  const input=reference?composeReference(draft,reference):draft;
  const mode=editing?'edit':'send';setDraft('');setReference(null);setEditing(false);stick.current=true;changeView('dialogue',{latest:true});await w.send(input,mode);
 }
 function checkSelection(){const s=window.getSelection();if(!s||s.isCollapsed||!reader.current?.contains(s.anchorNode)||!reader.current?.contains(s.focusNode)){setSelection('');return;}setSelection(s.toString().trim());}
 async function startSample(){const r=await sessionedFetch('/api/preview/new',{method:'POST'});const data=await r.json();await selectSession(data.id);}
 function fillSample(){if(draft.trim()){composer.current?.focus();return;}setDraft(!w.messages.length?opening:steps[w.notes.preview_step||0]?.input||'');composer.current?.focus();}
 async function copyBrief(){setCopyError('');try{await navigator.clipboard.writeText(w.brief.text);setCopied(true);clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopied(false),1800);}catch{setCopyError('自动复制不可用，可选中文字复制，或下载 Markdown。');}}
 function downloadBrief(){const blob=new Blob([w.brief.text],{type:'text/markdown;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Co-Thinker-Brief.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const canSend=!!draft.trim()&&!w.loading&&(preview||w.health?.model_configured)&&!w.health?.offline;
 const sampleDone=!!w.messages.length&&(w.notes.preview_step||0)>=steps.length;
 return <div className="thought-space">
  <header className="r-topbar">
   <div className="r-brand-group"><IconButton name="menu" label="打开思考记录" onClick={()=>setNavOpen(true)}/><a className="r-wordmark" href={preview?"./renewal.html?preview=1":"./renewal.html"}>Co-Thinker</a></div>
   <nav className="r-view-switch" aria-label="思考视图"><button aria-pressed={view==='dialogue'} onClick={()=>changeView('dialogue')}>对话</button><button aria-pressed={view==='foundation'} onClick={()=>changeView('foundation')}>地基{memoryState==='updating'&&<i className="r-updating" aria-label="更新中"/>}</button></nav>
   <div className="r-top-actions"><button className="r-new" aria-label="新的思考" onClick={()=>selectSession('')}><Icon name="plus"/><span>新的思考</span></button></div>
  </header>
  <main className="r-workspace">
   <div className="r-document-head"><h1 title={title}>{title}</h1>{view==='foundation'&&<span className={`r-memory ${memoryState}`} role="status">{memoryState==='updating'&&<i/>}{memoryLabels[memoryState]||'等待更新'}{['error','pending'].includes(memoryState)&&<button onClick={w.retryMemory}>重试</button>}</span>}</div>
   <div ref={reader} className={`r-reader view-${view}`} tabIndex={0} aria-label={view==='dialogue'?'对话内容':'地基内容'} onMouseUp={checkSelection} onKeyUp={checkSelection} onScroll={()=>{if(view!=='dialogue')return;const el=reader.current;stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<72;setAtBottom(stick.current);}}>
    {w.loading?<div className="r-loading" role="status">正在载入…</div>:view==='dialogue'?<div className="r-conversation">
      {!w.messages.length&&<div className="r-empty"><p>新的思考</p><span>从下面写起。</span></div>}
      <div className="r-messages" role="log" aria-live="polite" aria-relevant="additions text">{w.messages.map((m,index)=>m.role==='user'?<article className="r-entry" key={m.id} aria-label="输入"><div className="r-entry-text"><InputText text={m.content}/></div>{index===latestUser&&!w.streaming&&<IconButton name="edit" label="修改最近一次输入" onClick={()=>startEditing(m)}/>}</article>:<article className={`r-response ${m.streaming?'streaming':''}`} key={m.id} aria-label="回应">
       {m.voices?.map((voice,i)=><div className="r-voice" key={i}><Markdown>{voice}</Markdown></div>)}
       {m.streaming&&!m.voices?.some(Boolean)&&<span className="r-wait" role="status" aria-label="正在回应"><i/><i/><i/></span>}
       {m.interrupted&&<span className="r-inline-state">已停止{index===w.messages.length-1&&!w.streaming&&<button disabled={!runtimeAvailable} onClick={()=>w.send('','retry')}>继续</button>}</span>}
       {m.silent&&!m.voices?.some(Boolean)&&<span className="r-inline-state">这轮没有补充。</span>}
       {m.error&&<div className="r-inline-error" role="alert"><p>{m.error}</p>{index===w.messages.length-1&&<button disabled={!runtimeAvailable} onClick={()=>w.send('', 'retry')}><Icon name="retry"/>重试</button>}</div>}
      </article>)}{w.messages.at(-1)?.role==='user'&&!w.streaming&&<div className="r-inline-state">这轮还没有回应<button disabled={!runtimeAvailable} onClick={()=>w.send('','retry')}>继续</button></div>}</div>
    </div>:<article className="r-foundation">
      {hasFoundation?<>
       <div className="r-narrative"><Markdown>{w.notes.foundation_narrative||active.join('\n\n')}</Markdown></div>
       <div className="r-foundation-actions"><button onClick={()=>quote(w.notes.foundation_narrative||active.join('\n'),'地基')}><Icon name="return"/>接着推敲</button></div>
       {active.length>0&&<details className="r-foundation-details"><summary>查看条目与变化 <Icon name="chevron"/></summary><ol>{active.map((item,i)=><li key={i}><Markdown>{item}</Markdown></li>)}</ol>{archived.length>0&&<div className="r-archived"><h3>之前的判断</h3>{archived.map((item,i)=><Markdown key={i}>{item}</Markdown>)}</div>}</details>}
       {w.notes.plan&&<details className="r-foundation-details"><summary>接下来的事 <Icon name="chevron"/></summary><Markdown>{w.notes.plan}</Markdown></details>}
       <div className="r-export"><button onClick={w.generateBrief} disabled={!runtimeAvailable||w.streaming||memoryState==='updating'}><Icon name="download"/>整理成 Brief</button></div>
      </>:<div className="r-empty-foundation"><p>思路会在这里逐渐成形。</p><span>继续对话时，地基会在后台更新。</span></div>}
    </article>}
   </div>
   {selection&&<div className="r-selection"><span>已选中文字</span><button onClick={()=>quote(selection,view==='foundation'?'地基':'对话')}>接着这句想 <Icon name="return"/></button><IconButton name="close" label="取消选择" onClick={()=>{window.getSelection()?.removeAllRanges();setSelection('');}}/></div>}
   {view==='dialogue'&&!atBottom&&!selection&&<button className="r-latest" onClick={()=>{stick.current=true;reader.current.scrollTo({top:reader.current.scrollHeight,behavior:'smooth'});}}>回到最新 ↓</button>}
   <section className="r-composer-area" aria-label="继续思考">
    {w.error&&<p className="r-global-error" role="alert">{w.error}</p>}
    {!preview&&w.health&&!w.health.model_configured&&<p className="r-connection">当前未连接模型。<a href="./renewal.html?preview=1">查看交互示例</a></p>}
    <form className={`r-composer ${editing?'is-editing':''}`} onSubmit={e=>{e.preventDefault();send();}}>
     {editing&&<div className="r-editing-bar"><span>修改最近一次输入</span><button type="button" onClick={cancelEditing}>取消</button></div>}
     {reference&&<div className="r-composer-reference"><div><span>{reference.source}</span><p>{reference.text}</p></div><IconButton name="close" label="移除引用" onClick={()=>setReference(null)}/></div>}
     <div className="r-composer-row"><label className="r-sr" htmlFor="thought-input">继续输入</label><textarea id="thought-input" ref={composer} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(isSubmitKey(e)){e.preventDefault();send();}}} rows={1} placeholder={view==='foundation'?'从这里继续想…':'继续说…'}/><button type="submit" className="r-send" disabled={!canSend&&!w.streaming} aria-label={w.streaming&&!draft.trim()?'停止回复':editing?'提交修改':w.streaming?'发送补充':'发送'}><Icon name={w.streaming&&!draft.trim()?'stop':'arrow'}/></button></div>
     <div className="r-composer-meta"><span>{w.streaming?'正在回应':editing?'提交后会从这里重新展开':''}</span><span>↵ 发送</span></div>
    </form>
    <div className="r-footnote">{preview?<><button onClick={()=>setAboutOpen(true)}>交互预览 · 示例回复</button><button className="r-sample" onClick={sampleDone?startSample:fillSample} disabled={w.streaming||memoryState==='updating'||!!draft.trim()}>{sampleDone?'重看示例':'载入示例'}{!sampleDone&&<Icon name="chevron"/>}</button></>:<button onClick={()=>setAboutOpen(true)}>Co-Thinker</button>}</div>
   </section>
  </main>
  <Modal open={navOpen} title="思考记录" className="r-navigation" onClose={()=>setNavOpen(false)}><div className="r-nav-content"><button className="r-nav-new" onClick={()=>selectSession('')}><Icon name="plus"/>新的思考</button>{w.sessions.length?<div className="r-session-list">{w.sessions.map(s=><button key={s.id} className={s.id===w.currentId?'selected':''} onClick={()=>selectSession(s.id)}><span>{s.title}</span><small>{s.message_count} 条内容</small></button>)}</div>:<p className="r-muted">还没有思考记录。</p>}{preview&&<button className="r-text-action" onClick={startSample}>载入新示例</button>}</div></Modal>
  <Modal open={w.brief.open} title="Brief" onClose={w.closeBrief} className="r-brief"><div className="r-brief-body">{w.brief.loading&&!w.brief.text?<p className="r-muted">正在整理…</p>:<Markdown>{w.brief.text}</Markdown>}{w.brief.error&&<p role="alert">{w.brief.error}<button onClick={w.generateBrief}>重试</button></p>}{copyError&&<p className="r-muted">{copyError}</p>}</div><footer><button onClick={copyBrief} disabled={!w.brief.text||w.brief.loading}><Icon name="copy"/>{copied?'已复制':'复制'}</button><button onClick={downloadBrief} disabled={!w.brief.text||w.brief.loading}><Icon name="download"/>Markdown</button></footer></Modal>
  <Modal open={aboutOpen} title={preview?'交互预览':'关于 Co-Thinker'} onClose={()=>setAboutOpen(false)} className="r-about"><div className="r-about-body"><p>对话与地基承接同一份思考。表达可以继续，已有理解在后台沉淀，也能重新推敲。</p>{preview&&<><p>当前使用预设内容，未调用模型。输入框下方可载入示例；其他输入会保留，但不会生成真实回应。</p><p>可尝试切换视图、引用、修改最近输入、停止回复与导出。预览内容保存在本机，与正式会话分开。</p></>}</div></Modal>
 </div>;
}
