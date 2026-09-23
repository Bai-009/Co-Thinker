import { opening, rounds, arrangements } from './conversation.js';
const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let messages=[], completed=0, history=[], note=null, selected='offset', expanded=false;
let busy=false, pending=null, epoch=0, timers=[], noteTimer, noticeTimer, notePending=false, reading=false;
let composing=false;
function later(fn,ms){const t=setTimeout(fn,ms);timers.push(t);return t;}
function cancel(){epoch++;timers.forEach(clearTimeout);timers=[];clearTimeout(noteTimer);notePending=false;}
function notify(text){clearTimeout(noticeTimer);$('notice').textContent=text;$('notice').hidden=false;noticeTimer=setTimeout(()=>$('notice').hidden=true,6000);}
function snapshot(){return structuredClone({messages,completed,note:completed?rounds[completed-1].note:null,selected,expanded});}
function restore(s){cancel();({messages,completed,note,selected,expanded}=structuredClone(s));busy=false;pending=null;render();controls();latest(true);if($('record-dialog').open)renderNotes();}
function messageHTML(m){return `<article class="message ${m.role}" id="${m.id}" aria-label="${m.role==='user'?'你':'Co-Thinker'}">${m.role==='assistant'?'<div class="speaker">Co-Thinker</div>':''}<div class="body">${m.parts.map(p=>`<p>${esc(p)}</p>`).join('')}${m.sketch?sketchHTML():''}${m.sketchLink?`<button class="note-link" data-material>${icon('draw')}查看调整后的草图</button>`:''}${m.noteLink?`<button class="note-link" data-records>${icon('record')}查看讨论笔记</button>`:''}</div></article>`;}
function sketchHTML(){return `<figure class="working-sheet" id="shared-sketch" aria-labelledby="sketch-title">
  <figcaption class="sheet-head"><span class="sheet-title" id="sketch-title">座位与视线</span><span class="sheet-kind">草图</span></figcaption>
  <svg class="sketch" viewBox="0 0 560 314" role="img" aria-labelledby="sketch-description">
    <title id="sketch-description"></title>
    <path class="window-line" d="M66 42v226M73 42v226"/>
    <text x="47" y="153" text-anchor="middle">窗</text>
    <rect class="table" x="144" y="102" width="286" height="108" rx="5"/>
    <path class="table-line" d="M153 111h268M153 201h268"/>
    <text x="287" y="162" text-anchor="middle">共同桌面</text>
    <g class="book" transform="translate(185 115) rotate(-6)"><rect width="37" height="27" rx="2"/><path d="M5 1v25"/></g>
    <path class="sightline"/>
    <g class="seat seat-primary" data-seat="a"><circle r="15"/><path d="M-23-6v12q0 18 23 18T23 6V-6"/></g>
    <g class="seat" data-seat="b"><circle r="15"/><path d="M-23-6v12q0 18 23 18T23 6V-6"/></g>
    <g id="single-seats" hidden><rect class="table" x="86" y="73" width="34" height="57" rx="2"/><rect class="table" x="86" y="187" width="34" height="57" rx="2"/><g class="seat" transform="translate(116 150) rotate(180)"><circle r="10"/><path d="M-15-4v8q0 12 15 12T15 4V-4"/></g><g class="seat" transform="translate(116 264) rotate(180)"><circle r="10"/><path d="M-15-4v8q0 12 15 12T15 4V-4"/></g></g>
  </svg>
  <div class="sketch-controls" role="group" aria-label="比较座位安排">${Object.entries(arrangements).map(([key,value])=>`<button data-arrangement="${key}" aria-pressed="${key===selected}">${value.label}</button>`).join('')}</div>
  <div class="sheet-caption" aria-live="polite"><p id="sketch-caption"></p><small id="sketch-thought"></small></div>
</figure>`;}
function updateSketch(){
  const root=$('shared-sketch');if(!root)return;
  const mode=arrangements[selected];
  ['a','b'].forEach(key=>{const [x,y,r]=mode[key];root.querySelector(`[data-seat="${key}"]`).style.transform=`translate(${x}px,${y}px) rotate(${r}deg)`;});
  root.querySelector('.sightline').setAttribute('d',mode.line);
  root.querySelectorAll('[data-arrangement]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.arrangement===selected)));
  $('single-seats').toggleAttribute('hidden',!expanded);
  $('sketch-title').textContent=expanded?'长桌与单人位':'座位与视线';
  $('sketch-description').textContent=`座位草图：${mode.label}。${expanded?'窗边另设两个单人位。':''}${mode.caption}`;
  $('sketch-caption').textContent=expanded?`窗边另设单人位；长桌${selected==='face'?'两侧对坐':selected==='offset'?'座位错开':'同侧并坐'}。`:mode.caption;
  $('sketch-thought').textContent=expanded?'两种位置之间的距离尚未确定。':mode.thought;
}
function render(){
  $('thread').innerHTML=messages.map(messageHTML).join('');updateSketch();
  $('material-link').hidden=!messages.some(m=>m.sketch);
}
function append(m){messages.push(m);$('thread').insertAdjacentHTML('beforeend',messageHTML(m));$(m.id).classList.add('appear');updateSketch();$('material-link').hidden=!messages.some(m=>m.sketch);}
function latest(instant=false){$('reading-area').scrollTo({top:$('reading-area').scrollHeight,behavior:instant||reduced?'instant':'smooth'});reading=false;$('latest').hidden=true;}
function revealReply(el){const r=$('reading-area');const top=r.scrollTop+el.getBoundingClientRect().top-r.getBoundingClientRect().top-20;r.scrollTo({top:Math.max(0,top),behavior:reduced?'instant':'smooth'});}
function locate(id){const el=$(id);if(!el)return;el.scrollIntoView({block:'center',behavior:reduced?'instant':'smooth'});el.classList.add('is-source');setTimeout(()=>el.classList.remove('is-source'),1600);}
function controls(){
  $('send').disabled=!busy&&!$('input').value.trim();
  $('send').innerHTML=icon(busy?'stop':'arrow');$('send').setAttribute('aria-label',busy?'停止回复':'发送');
  $('continue').disabled=busy;
  $('continue').innerHTML=`${pending?'继续回复':completed>=rounds.length?'重新演示':'填入示例'}${icon('next')}`;
  $('undo').disabled=history.length===0;
  $('activity').innerHTML=busy?'<i class="activity-dot busy"></i>正在回应':pending?'回复已停止':notePending?'<i class="activity-dot busy"></i>笔记更新中':'';
}
function scheduleNote(nextNote){
  clearTimeout(noteTimer);notePending=true;controls();const version=epoch;
  noteTimer=setTimeout(()=>{if(version!==epoch)return;note=structuredClone(nextNote);notePending=false;$('update-dot').hidden=false;controls();if($('record-dialog').open)renderNotes();},650);
}
function animateReply(){
  busy=true;const version=++epoch;controls();
  const round=rounds[pending.index];
  const el=document.createElement('article');el.className='message assistant pending';el.id='pending-reply';el.setAttribute('aria-label','Co-Thinker');el.innerHTML='<div class="speaker">Co-Thinker</div><div class="body"><div class="thinking" aria-label="正在回复"><span></span><span></span><span></span></div></div>';$('thread').append(el);
  if(!reading)latest();
  // Timing is a preview of paragraph arrival, not an artificial per-token delay.
  later(()=>{
    if(version!==epoch)return;
    el.classList.remove('pending');el.querySelector('.body').innerHTML=`<p class="appear">${esc(round.reply[0])}</p>`;
    if(!reading)latest();
  },300);
  later(()=>{
    if(version!==epoch)return;
    if(round.expandSketch)expanded=true;
    const id=`ai-${pending.index+1}`;
    const entry={role:'assistant',id,parts:round.reply,sketch:!!round.sketch,sketchLink:!!round.expandSketch,noteLink:!!round.noteLink};
    messages.push(entry);
    const holder=document.createElement('div');holder.innerHTML=messageHTML(entry);
    el.id=id;el.innerHTML=holder.firstElementChild.innerHTML;el.classList.remove('pending');
    updateSketch();$('material-link').hidden=!messages.some(m=>m.sketch);
    completed=pending.index+1;pending=null;busy=false;
    scheduleNote(round.note);controls();
    if(round.expandSketch)updateSketch();
    if(!reading)revealReply($(id));
  },760);
}
function stop(){if(!busy)return;epoch++;timers.forEach(clearTimeout);timers=[];$('pending-reply')?.remove();busy=false;controls();}
function resizeInput(){const el=$('input');el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,128)}px`;controls();}
function submit(){
  if(busy){stop();return;}
  if(pending){notify('这轮回复已停止。点击“继续回复”，或用左箭头回到上一轮。');return;}
  const text=$('input').value.trim();if(!text)return;
  const round=rounds[completed];
  const normalize=s=>s.replace(/[\s，。！？、；：“”‘’"'「」『』,.!?;:]/g,'');
  if(!round||normalize(text)!==normalize(round.user)){notify('这版尚未连接模型。点击“填入示例”可继续；你的输入会保留。');return;}
  history.push(snapshot());clearTimeout(noteTimer);notePending=false;
  append({role:'user',id:`user-${completed+1}`,parts:[text]});
  $('input').value='';resizeInput();$('notice').hidden=true;pending={index:completed};latest();animateReply();
}
function fillExample(){
  if(busy)return;
  if(pending){animateReply();return;}
  if(completed>=rounds.length){reset();return;}
  const expected=rounds[completed].user;
  if($('input').value.trim()&&$('input').value!==expected){notify('输入框已有内容。请先保留或清空，再填入示例。');return;}
  $('input').value=expected;resizeInput();$('input').focus();$('notice').hidden=true;
}
function sourceLink(id,label='查看原话'){return `<button data-source="${id}">${label}</button>`;}
function renderNotes(){
  if(!note){$('record-content').innerHTML=`<section class="record-section"><h3>最初的想法</h3><p>${esc(opening.user)}</p><p class="attribution">你的表达</p>${sourceLink('user-0')}</section><section class="record-section"><h3>正在探索</h3><p>“安静”还不足以描述这家书店。</p></section>`;return;}
  const sources=messages.filter(m=>m.role==='user');
  $('record-content').innerHTML=`<section class="record-section"><h3>你的想法</h3><p>${esc(note.user)}</p>${sourceLink(`user-${note.userRound}`)}</section><section class="record-section"><h3>AI 的提议</h3><p>${esc(note.proposal)}</p>${sourceLink(`ai-${note.proposalRound}`,'查看提议')}</section><hr class="note-rule"><section class="record-section"><h3>还没想清楚</h3><p>${esc(note.open)}</p></section>${note.revision?`<details class="revision"><summary>理解怎样发生变化</summary><p>${esc(note.revision)}</p>${sourceLink('user-2','查看当时的反例')}</details>`:''}<details class="source-list"><summary>对话中的原话</summary>${sources.map(s=>`<div class="source-item"><small>${s.id==='user-0'?'最初的想法':'你'}</small><p>${esc(s.parts.join('\n'))}</p>${sourceLink(s.id)}</div>`).join('')}</details>`;
}
function showNotes(){renderNotes();$('export-fallback').hidden=true;$('update-dot').hidden=true;$('record-dialog').showModal();}
function reset(){
  cancel();messages=[];completed=0;history=[];note=null;selected='offset';expanded=false;pending=null;busy=false;reading=false;
  $('input').value='';$('input').style.height='auto';$('notice').hidden=true;$('update-dot').hidden=true;
  messages=[{role:'user',id:'user-0',parts:[opening.user]},{role:'assistant',id:'ai-0',parts:opening.reply}];render();controls();$('reading-area').scrollTop=0;if($('record-dialog').open)renderNotes();
}
$('composer').addEventListener('submit',e=>{e.preventDefault();submit();});
$('input').addEventListener('compositionstart',()=>composing=true);$('input').addEventListener('compositionend',()=>composing=false);
$('input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composing&&e.keyCode!==229){e.preventDefault();submit();}});
$('input').addEventListener('input',()=>{resizeInput();$('notice').hidden=true;});
$('continue').addEventListener('click',fillExample);
$('undo').addEventListener('click',()=>{if(!history.length)return;restore(history.pop());$('input').value='';resizeInput();$('notice').hidden=true;});
$('restart').addEventListener('click',reset);$('records').addEventListener('click',showNotes);$('about').addEventListener('click',()=>$('about-dialog').showModal());$('latest').addEventListener('click',()=>latest());
$('material-link').addEventListener('click',()=>{$('shared-sketch')?.scrollIntoView({block:'center',behavior:reduced?'instant':'smooth'});reading=true;});
document.addEventListener('click',e=>{
  const mode=e.target.closest('[data-arrangement]');if(mode){selected=mode.dataset.arrangement;updateSketch();}
  if(e.target.closest('[data-records]'))showNotes();
  if(e.target.closest('[data-material]')){$('shared-sketch')?.scrollIntoView({block:'center',behavior:reduced?'instant':'smooth'});reading=true;}
  const close=e.target.closest('[data-close]');if(close)close.closest('dialog').close();
  const source=e.target.closest('[data-source]');if(source){$('record-dialog').close();locate(source.dataset.source);}
});
$('reading-area').addEventListener('wheel',()=>reading=true,{passive:true});$('reading-area').addEventListener('touchstart',()=>reading=true,{passive:true});
$('reading-area').addEventListener('scroll',()=>{const r=$('reading-area');const away=r.scrollHeight-r.scrollTop-r.clientHeight>70;$('latest').hidden=!away;if(!away)reading=false;});
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}));
$('copy').addEventListener('click',async()=>{
  const main=note?`## 你的想法\n${note.user}\n\n## AI 的提议\n${note.proposal}\n\n## 还没想清楚\n${note.open}${note.revision?`\n\n## 理解的变化\n${note.revision}`:''}`:opening.user;
  const text=`# 书店里的独处\n\n${main}\n\n---\n交互原型的预设笔记，未连接模型。`;
  const button=$('copy');button.disabled=true;let timeout;
  try{
    await Promise.race([navigator.clipboard.writeText(text),new Promise((_,reject)=>timeout=setTimeout(()=>reject(new Error('clipboard unavailable')),1000))]);
    button.querySelector('span').textContent='已复制';
    setTimeout(()=>button.querySelector('span').textContent='复制笔记',1600);
  }catch{
    $('note-export').value=text;$('export-fallback').hidden=false;$('copy-status').textContent='自动复制不可用。文字已选中，可按 ⌘C / Ctrl+C 复制。';$('note-export').focus();$('note-export').select();
  }finally{clearTimeout(timeout);button.disabled=false;}
});
reset();
