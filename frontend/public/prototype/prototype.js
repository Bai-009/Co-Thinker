const $ = (id) => document.getElementById(id);
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const scenes = [
  {
    input: '我不喜欢 AI 帮我总结。想法还没说完，它就像已经知道答案了。',
    reply: ['可以等你说完，再做总结。', '不过，长一点的讨论可能需要中途梳理。你不喜欢的是总结，还是它过早下结论？'],
    thought: '总结是否应该等到讨论结束？',
    status: '待讨论',
    source: 'AI 提出推迟总结，尚未确定具体时机。',
    suggestion: '我反感的是太早总结。',
    open: '什么时候需要总结？',
  },
  {
    input: '我反感的是太早总结。',
    reply: ['那可以先梳理已经说到的内容，把没想清楚的地方留着。', '例如，把两个相反的想法并排放着，不急着选一个。'],
    thought: '总结时保留尚未解决的问题。',
    status: 'AI 提议',
    source: '根据“太早总结”的补充，AI 提议在总结中保留未决问题。',
    suggestion: '但聊得太散的时候，我也需要它帮我收回来。',
    open: '讨论需要收束时，如何处理？',
  },
  {
    input: '但聊得太散的时候，我也需要它帮我收回来。',
    reply: ['这种时候，可以先回顾正在讨论的问题，再看看新的话题和它有什么关系。', '如果只是在重复，就收束一下；如果发现了新的联系，值得接着谈。'],
    thought: '何时总结，要看讨论是否还在推进。',
    status: 'AI 提议',
    source: '针对“聊得太散”的情况，AI 提议回顾当前问题，再判断是否继续。',
    suggestion: '对，整理是为了继续想，不是为了赶快结束。',
    open: '怎样判断讨论是否还在推进？',
  },
  {
    input: '对，整理是为了继续想，不是为了赶快结束。',
    reply: ['嗯，总结可以帮忙看清接下来要想什么。', '怎么判断讨论有没有进展，还需要拿具体例子来看。'],
    thought: '总结应帮助继续讨论，保留未决问题。',
    status: '已确认',
    source: '你认可了总结的目的，判断讨论进展的方法仍未确定。',
    suggestion: '那怎么判断是聊散了，还是正在发现新东西？',
    open: '怎样区分聊散了和有新的发现？',
  },
  {
    input: '那怎么判断是聊散了，还是正在发现新东西？',
    reply: ['换了话题，不一定是聊散了。比如我们从总结的时机谈到人怎样接话，仍可能帮助理解什么时候该停一下。', '我会先看新话题有没有帮助理解原来的问题，而不只看它是否偏题。'],
    thought: '总结应帮助继续讨论，保留未决问题。',
    status: '已确认',
    source: '本轮继续讨论判断方法，已确认的总结目的不变。',
    suggestion: '',
    open: '能否根据新话题对原问题的帮助，判断讨论的进展？',
  },
];

let stage = 0;
let revision = [0];
let busy = false;
let run = 0;
let collapsed = false;
let comparisonOpen = false;
let messageCounter = 0;
let sourceMessages = {};
let sourceTexts = {};
let noticeTimer;
let phaseTimer;
let userReading = false;
let composing = false;

function notify(text) {
  clearTimeout(noticeTimer);
  $('notice').textContent = text;
  $('notice').hidden = false;
  noticeTimer = setTimeout(() => $('notice').hidden = true, 4800);
}
function scrollLatest() {
  $('thread').scrollTo({ top: $('thread').scrollHeight, behavior: reducedMotion ? 'instant' : 'smooth' });
  userReading = false;
  $('return-latest').hidden = true;
}
function retainLatestAfterLayout() {
  if (!userReading) requestAnimationFrame(() => {
    $('thread').scrollTop = $('thread').scrollHeight;
    $('return-latest').hidden = true;
  });
}
function addMessage(role, paragraphs, animate = true) {
  const el = document.createElement('article');
  el.className = `message ${role}${animate ? ' is-new' : ''}`;
  el.id = `message-${++messageCounter}`;
  el.setAttribute('aria-label', role === 'user' ? '你' : 'Co-Thinker');
  el.innerHTML = `${role === 'assistant' ? icon('mark') : ''}<div class="message-content">${paragraphs.map(p => `<p>${role === 'user' ? escape(p) : p}</p>`).join('')}</div>`;
  $('thread').append(el);
  return el;
}
function currentScene() { return scenes[stage]; }

function updateShared(changed = false) {
  const s = currentScene();
  $('thought-text').textContent = s.thought;
  $('shared-status').innerHTML = `${stage >= 3 ? icon('check') : ''}${escape(s.status)}`;
  $('shared-status').classList.toggle('confirmed', stage >= 3);
  $('record-dot').hidden = !changed;
  $('suggestion').innerHTML = `${s.suggestion ? '下一轮' : '重新演示'}${icon('chevron')}`;
  if (changed) {
    $('thought-line').classList.remove('is-revised');
    requestAnimationFrame(() => $('thought-line').classList.add('is-revised'));
  }
  renderComparison();
}

function renderComparison() {
  let columns;
  if (stage === 0) columns = [['你的原话', '想法还没说完，它就像已经知道答案了。'], ['AI 提议讨论', scenes[0].thought]];
  else if (stage === 1) columns = [['修改前', scenes[0].thought], ['修改后', scenes[1].thought]];
  else columns = [['仍有新的想法', '保留不同意见，继续讨论。'], ['内容开始重复', '回顾当前问题，适当收束。']];
  $('comparison').innerHTML = columns.map(([title, text], i) => `<div><h3>${escape(title)}</h3><p class="${stage === 1 && i === 0 ? 'previous' : ''}">${escape(text)}</p></div>`).join('');
  $('comparison').hidden = !comparisonOpen;
  $('compare').querySelector('span').textContent = comparisonOpen ? '收起对照' : '展开对照';
  $('compare').setAttribute('aria-expanded', String(comparisonOpen));
}

function updateSend() {
  $('send').disabled = !busy && !$('input').value.trim();
  $('send').classList.toggle('is-stop', busy && !$('input').value.trim());
  if (busy && !$('input').value.trim()) {
    $('send').innerHTML = '<svg aria-hidden="true" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1"/></svg>';
    $('send').setAttribute('aria-label', '停止回复');
  } else {
    $('send').innerHTML = icon('arrow');
    $('send').setAttribute('aria-label', busy ? '发送补充' : '发送');
  }
  $('suggestion').disabled = busy;
}

function stop() {
  run++;
  clearTimeout(phaseTimer);
  const waiting = $('thread').querySelector('.waiting');
  waiting?.remove();
  busy = false;
  $('composer-context').textContent = '已停止';
  updateSend();
}

function nextIntent(text) {
  if (/怎么判断|如何判断|新东西|新发现/.test(text)) return 4;
  if (/继续想|赶快结束|帮助接续|同意|^对[，,。！!]?/.test(text)) return 3;
  if (/太散|聊散|收回来|找回方向|失去方向/.test(text)) return 2;
  if (/太早|过早|时机|不反对总结|不是.*总结/.test(text)) return 1;
  return null;
}

function submit(text) {
  if (!text.trim()) { if (busy) stop(); return; }
  if (busy) stop();
  const next = nextIntent(text);
  const user = addMessage('user', [text]);
  $('input').value = '';
  $('input').style.height = 'auto';
  $('notice').hidden = true;
  scrollLatest();
  if (next === null) {
    notify('此原型未接入模型。点击“下一轮”继续演示。');
    updateSend();
    return;
  }
  if (next !== stage + 1) {
    notify('这句补充不在当前演示步骤中。点击“下一轮”继续。');
    updateSend();
    return;
  }
  busy = true;
  const ticket = ++run;
  const pending = addMessage('assistant', ['<span class="replying" aria-label="正在回复"><span></span><span></span><span></span></span>']);
  pending.classList.add('waiting');
  $('composer-context').textContent = '';
  updateSend();
  scrollLatest();
  // Fixed timing belongs to this scripted prototype, not to the proposed model runtime.
  phaseTimer = setTimeout(() => {
    if (ticket !== run) return;
    pending.classList.remove('waiting');
    pending.querySelector('.message-content').innerHTML = `<p>${scenes[next].reply[0]}</p>`;
    if (!userReading) scrollLatest();
    phaseTimer = setTimeout(() => {
      if (ticket !== run) return;
      const p = document.createElement('p');
      p.innerHTML = scenes[next].reply[1];
      p.className = 'is-new';
      pending.querySelector('.message-content').append(p);
      stage = next;
      if (!revision.includes(next)) revision.push(next);
      sourceMessages[next] = user.id;
      sourceTexts[next] = text;
      updateShared(next !== 4);
      busy = false;
      $('composer-context').textContent = '';
      updateSend();
      if (!userReading) scrollLatest();
    }, 780);
  }, 520);
}

function openDialog(id) {
  const d = $(id);
  if (!d.open) d.showModal();
}
function locate(stageId) {
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const el = $(sourceMessages[stageId]);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'instant' : 'smooth' });
  el.classList.add('is-located');
  setTimeout(() => el.classList.remove('is-located'), 1800);
}
function openRecords() {
  const s = currentScene();
  const sourceStage = stage >= 3 ? 3 : stage;
  $('record-dot').hidden = true;
  $('record-body').innerHTML = `<h3>${escape(s.status)}</h3><p class="record-statement">${escape(s.thought)}</p><p class="record-note">${escape(s.source)}</p><div class="record-source"><h3>未决问题</h3><p class="record-note">${escape(s.open)}</p></div><div class="record-source"><h3>相关消息</h3><blockquote>${escape(sourceTexts[sourceStage] || scenes[sourceStage].input)}</blockquote><button class="text-button" data-locate="${sourceStage}">查看消息 ${icon('chevron')}</button></div>`;
  openDialog('record-dialog');
}
function openOrigin() {
  $('origin-body').innerHTML = revision.map(i => {
    const s = scenes[i];
    return `<section class="origin-entry"><p class="origin-label">${escape(i === 0 ? '最初的问题' : s.status)}</p><h3>${escape(s.thought)}</h3><p>${escape(s.source)}</p><button class="text-button" data-locate="${i}">查看消息 ${icon('chevron')}</button></section>`;
  }).join('');
  openDialog('origin-dialog');
}

function reset() {
  stop();
  userReading = false;
  stage = 0; revision = [0]; sourceMessages = {}; sourceTexts = {0:scenes[0].input}; messageCounter = 0;
  $('thread').innerHTML = '';
  sourceMessages[0] = addMessage('user', [scenes[0].input], false).id;
  addMessage('assistant', scenes[0].reply, false);
  comparisonOpen = false; collapsed = false;
  $('shared').classList.remove('is-collapsed');
  $('toggle-shared').setAttribute('aria-expanded','true');
  $('shared-body').hidden = false;
  $('input').value = '';
  $('composer-context').textContent = '';
  updateShared(); updateSend();
  retainLatestAfterLayout();
  $('notice').hidden = true;
}

$('composer').addEventListener('submit', e => { e.preventDefault(); submit($('input').value); });
$('input').addEventListener('input', () => { $('input').style.height = 'auto'; $('input').style.height = `${Math.min($('input').scrollHeight, 115)}px`; updateSend(); $('notice').hidden = true; });
$('input').addEventListener('compositionstart', () => composing = true);
$('input').addEventListener('compositionend', () => composing = false);
$('input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !composing && e.keyCode !== 229) { e.preventDefault(); submit($('input').value); } });
$('suggestion').addEventListener('click', () => { if (busy) return; if (currentScene().suggestion) submit(currentScene().suggestion); else reset(); });
$('toggle-shared').addEventListener('click', () => { collapsed = !collapsed; $('shared').classList.toggle('is-collapsed', collapsed); $('shared-body').hidden = collapsed; $('toggle-shared').setAttribute('aria-expanded', String(!collapsed)); retainLatestAfterLayout(); });
$('compare').addEventListener('click', () => { comparisonOpen = !comparisonOpen; renderComparison(); retainLatestAfterLayout(); });
$('open-records').addEventListener('click', openRecords);
$('view-origin').addEventListener('click', openOrigin);
$('about').addEventListener('click', () => openDialog('about-dialog'));
$('restart').addEventListener('click', reset);
$('return-latest').addEventListener('click', scrollLatest);
$('thread').addEventListener('wheel', () => userReading = true, { passive: true });
$('thread').addEventListener('touchstart', () => userReading = true, { passive: true });
$('thread').addEventListener('scroll', () => { const t = $('thread'); const away = t.scrollHeight-t.scrollTop-t.clientHeight > 80; $('return-latest').hidden = !away; if (!away) userReading = false; });
new ResizeObserver(retainLatestAfterLayout).observe($('thread'));
document.addEventListener('click', e => { const close = e.target.closest('[data-close]'); if (close) close.closest('dialog').close(); const link = e.target.closest('[data-locate]'); if (link) locate(Number(link.dataset.locate)); });
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } }));
$('export-record').addEventListener('click', async () => {
  const s = currentScene();
  const label = $('export-record').querySelector('span');
  try { await navigator.clipboard.writeText(`# 总结的时机\n\n${s.status}\n${s.thought}\n\n依据：${s.source}\n\n未决问题：${s.open}\n\n交互原型的预设记录。`); label.textContent = '已复制'; setTimeout(() => label.textContent = '复制记录', 1800); }
  catch { label.textContent = '复制不可用，请选取文字'; }
});
reset();
