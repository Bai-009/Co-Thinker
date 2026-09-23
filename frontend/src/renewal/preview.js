import { opening, initialReply, initialNotes, steps, seedId } from './scenario';
import { splitReference } from '../workbench/references';
const KEY='cothinker.renewal.preview.v1';
const clone=x=>JSON.parse(JSON.stringify(x));
const wrap=voices=>voices.map(v=>`[VOICE]${v}[/VOICE]`).join('\n');
let db;
try{db=JSON.parse(localStorage.getItem(KEY));}catch{}
const newSample=id=>({id,title:'灵感与记录',stage:0,version:0,messages:[{role:'user',content:opening},{role:'assistant',content:wrap(initialReply)}],notes:clone(initialNotes),updated_at:Date.now()/1000,snapshots:[{prefix:2,notes:clone(initialNotes),stage:0}]});
if(!db||!db[seedId])db={[seedId]:newSample(seedId)};
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(db));}catch{}};
const emptyNotes=()=>({foundation:'',foundation_narrative:'',focus:'',open_questions:[],plan:'',preview_step:0,revision_count:0,memory:{state:'empty'}});
const abort=()=>new DOMException('Aborted','AbortError');
const delay=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(abort());return;}
  const stop=()=>{clearTimeout(timer);reject(abort());};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
  signal?.addEventListener('abort',stop,{once:true});
});
function json(data,id,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...(id?{'X-Session-Id':id}:{})}});}
function stream(id,signal,run){const enc=new TextEncoder();return new Response(new ReadableStream({async start(controller){const emit=e=>{if(signal?.aborted)throw abort();controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));};try{await run(emit);}catch(e){if(e.name!=='AbortError')controller.error(e);}finally{try{controller.close();}catch{}}}}),{headers:{'Content-Type':'text/event-stream','X-Session-Id':id}});}
async function handleFetch(input,init={}){
  const path=String(input),signal=init.signal,id=new Headers(init.headers).get('X-Session-Id')||seedId;
  if(signal?.aborted)throw abort();
  if(path==='/api/preview/new'&&init.method==='POST'){const freshId='renewal-'+crypto.randomUUID();db[freshId]=newSample(freshId);save();return json({id:freshId},freshId);}
  if(path==='/health')return json({status:'ok',model_configured:false,preview:true});
  if(path.endsWith('/sessions'))return json({sessions:Object.values(db).filter(s=>s.messages.length).sort((a,b)=>b.updated_at-a.updated_at).map(s=>({id:s.id,title:s.title,message_count:s.messages.length,updated_at:s.updated_at}))});
  if(init.method==='DELETE'){delete db[decodeURIComponent(path.split('/').pop())];save();return json({ok:true});}
  if(!db[id])db[id]={id,title:'新的思考',stage:0,version:0,messages:[],notes:emptyNotes(),snapshots:[],updated_at:Date.now()/1000};
  const s=db[id];
  if(path.endsWith('/history'))return json({messages:s.messages},id);
  if(path.endsWith('/foundation'))return json(s.notes,id);
  if(path.endsWith('/memory/retry')){s.notes.memory.state=s.notes.foundation?'ready':'empty';save();return json({ok:true},id);}
  if(path.endsWith('/brief'))return stream(id,signal,async emit=>{
    const text=`# ${s.title}\n\n${s.notes.foundation_narrative}\n\n## 已经明确\n\n${s.notes.foundation||'仍在探索。'}\n\n---\n交互预览：来自预设对话。`;
    for(const chunk of text.match(/[\s\S]{1,14}/g)||[]){await delay(18,signal);emit({type:'brief_delta',content:chunk});}emit({type:'brief_done',brief:text});
  });
  let text=JSON.parse(init.body||'{}').content||'';
  if(path.endsWith('/edit')||path.endsWith('/retry')){
    const i=s.messages.map(m=>m.role).lastIndexOf('user');
    if(i>=0){if(path.endsWith('/retry'))text=s.messages[i].content;s.messages=s.messages.slice(0,i);}
    s.version++;
    s.snapshots=s.snapshots.filter(x=>x.prefix<=s.messages.length);
    const previous=s.snapshots.at(-1);s.notes=previous?clone(previous.notes):emptyNotes();s.stage=previous?.stage||0;
  }
  const current=steps[s.stage];
  const normalized=t=>t.replace(/[\s，。！？、；：“”‘’"'「」『』,.!?;:]/g,'');
  const inputBody=splitReference(text).text;
  const match=current&&normalized(inputBody)===normalized(current.input);
  const isOpening=s.messages.length===0&&normalized(text)===normalized(opening);
  const voices=isOpening?initialReply:match?current.voices:['这条输入已保留。当前是交互预览，尚未连接模型；可从输入框下方载入示例，体验后续变化。'];
  const version=s.version;
  s.messages.push({role:'user',content:text});s.updated_at=Date.now()/1000;if(s.title==='新的思考')s.title=text.slice(0,28);save();
  return stream(id,signal,async emit=>{
    let partial=[];
    try{
      emit({type:'turn_started'});
      for(let i=0;i<voices.length;i++){
        await delay(i?180:240,signal);emit({type:'voice_start',index:i});partial[i]='';
        for(const chunk of voices[i].match(/[\s\S]{1,5}/g)||[]){await delay(20,signal);partial[i]+=chunk;emit({type:'voice_delta',index:i,content:chunk});}
      }
      if(s.version!==version)return;
      s.messages.push({role:'assistant',content:wrap(partial)});
      if(match||isOpening){
        const stage=match?s.stage+1:0;
        const next=isOpening?clone(initialNotes):{...s.notes,foundation:current.foundation,foundation_narrative:current.narrative,preview_step:stage,revision_count:(s.notes.revision_count||0)+1};
        s.stage=stage;s.notes={...s.notes,memory:{state:'updating',covered_messages:s.notes.memory?.covered_messages||0,total_messages:s.messages.length}};
        // Save the scheduled update so reload does not strand a preview in “updating”.
        s.pending={version,prefix:s.messages.length,stage,next,at:Date.now()+700};
      }
      save();emit({type:'done',voices:partial});
    }catch(e){
      if(e.name==='AbortError'&&s.version===version){s.messages.push({role:'assistant',content:partial.filter(Boolean).map(v=>`[VOICE][INTERRUPTED]${v}[/VOICE]`).join('\n')});save();}
      throw e;
    }
  });
}
// This provider is called for every API read. Resolve only the still-current memory update.
const fetchBase=handleFetch;
export async function previewFetch(input,init={}){
  for(const s of Object.values(db))if(s.pending&&Date.now()>=s.pending.at){const p=s.pending;delete s.pending;if(p.version===s.version){s.notes={...p.next,memory:{state:'ready',covered_messages:p.prefix,total_messages:s.messages.length}};s.snapshots.push({prefix:p.prefix,notes:clone(s.notes),stage:p.stage});save();}}
  return fetchBase(input,init);
}
