import asyncio
from copy import deepcopy
import pytest
import runtime
from store import InMemorySessionStore
from routers import workshop

@pytest.fixture
def state(monkeypatch):
    store=InMemorySessionStore()
    monkeypatch.setattr(workshop,'store',store)
    runtime._runtimes.clear()
    return store

@pytest.mark.asyncio
async def test_queued_memory_keeps_its_own_turn_and_rollback(state, monkeypatch):
    s=state.get_or_create('a')
    s.add_message('user','first question');s.add_message('assistant','first reply')
    first=deepcopy(s.messages)
    entered=asyncio.Event();release=asyncio.Event();observed=[]
    async def rewrite(view, voices, **kwargs):
        observed.append((view.messages[-2]['content'],voices[0][1]))
        if len(observed)==1: entered.set();await release.wait()
        view.foundation=view.messages[-2]['content'];return True
    monkeypatch.setattr(workshop,'_run_rewriter_to_session',rewrite)
    t1=asyncio.create_task(workshop._metabolize_turn(s.id,[(.5,'first reply')],first,0))
    await entered.wait()
    s.add_message('user','second question');s.add_message('assistant','second reply')
    t2=asyncio.create_task(workshop._metabolize_turn(s.id,[(.5,'second reply')],deepcopy(s.messages),0))
    release.set();await asyncio.gather(t1,t2)
    assert observed==[('first question','first reply'),('second question','second reply')]
    assert [h['prefix'] for h in s.foundation_history]==[2,4]
    s.restore_to_prefix(2)
    assert s.foundation=='first question'

@pytest.mark.asyncio
async def test_edit_invalidates_inflight_memory(state,monkeypatch):
    s=state.get_or_create('b');s.add_message('user','old')
    entered=asyncio.Event();release=asyncio.Event()
    async def rewrite(view,voices,**kwargs):
        entered.set();await release.wait();view.foundation='obsolete';return True
    monkeypatch.setattr(workshop,'_run_rewriter_to_session',rewrite)
    task=asyncio.create_task(workshop._metabolize_turn('b',[],deepcopy(s.messages),0))
    await entered.wait();runtime.runtime_for('b').epoch+=1;s.foundation='new';release.set();await task
    assert s.foundation=='new'
    assert not s.foundation_history

@pytest.mark.asyncio
async def test_model_failure_preserves_input_and_emits_error(state,monkeypatch):
    s=state.get_or_create('c')
    async def fail(_):
        if False:yield None
        raise RuntimeError('not a silence')
    monkeypatch.setattr(workshop,'_run_thinker',fail)
    output=[x async for x in workshop._stream_workshop(s,'keep my thought')]
    assert s.messages==[{'role':'user','content':'keep my thought'}]
    assert any('"type": "error"' in x for x in output)
    assert not runtime.runtime_for('c').generating

@pytest.mark.asyncio
async def test_explicit_empty_memory_clears_old_conflict(state,monkeypatch):
    s=state.get_or_create('d');s.scratchpad='pending_conflict: old';s.foundation='old'
    async def stream(_):
        yield '[FOUNDATION][/FOUNDATION][FOUNDATION_NARRATIVE][/FOUNDATION_NARRATIVE][SCRATCHPAD][/SCRATCHPAD]'
    monkeypatch.setattr(workshop,'chat_completion_stream',stream)
    assert await workshop._run_rewriter_to_session(s,[],persist=False)
    assert s.scratchpad=='' and s.foundation==''

@pytest.mark.asyncio
async def test_incomplete_protocol_does_not_partially_mutate_memory(state,monkeypatch):
    s=state.get_or_create('e');s.foundation='existing'
    async def stream(_):yield '[FOUNDATION]new incomplete[/FOUNDATION]'
    monkeypatch.setattr(workshop,'chat_completion_stream',stream)
    assert not await workshop._run_rewriter_to_session(s,[],persist=False)
    assert s.foundation=='existing'

@pytest.mark.asyncio
async def test_retry_replaces_failed_turn_without_duplicate(state,monkeypatch):
    s=state.get_or_create('f');s.add_message('user','my question')
    async def success(_):yield ('done',[(.6,'answer')])
    monkeypatch.setattr(workshop,'_run_thinker',success)
    monkeypatch.setattr(workshop,'queue_memory',lambda *a:None)
    _=[x async for x in workshop._stream_workshop(s,'','retry')]
    assert len(s.messages)==2
    assert s.messages[0]['content']=='my question'

def test_empty_memory_state(state):
    assert runtime.memory_status(state.get_or_create('g'))['state']=='empty'

@pytest.mark.asyncio
async def test_cancel_before_first_output_keeps_the_user_input(state,monkeypatch):
    s=state.get_or_create('cancel')
    entered=asyncio.Event()
    async def wait(_):
        entered.set()
        await asyncio.Event().wait()
        yield ('done',[])
    monkeypatch.setattr(workshop,'_run_thinker',wait)
    async def consume():
        return [x async for x in workshop._stream_workshop(s,'still important')]
    task=asyncio.create_task(consume());await entered.wait();task.cancel()
    with pytest.raises(asyncio.CancelledError):await task
    assert s.messages[0]['content']=='still important'
    assert not runtime.runtime_for(s.id).generating

@pytest.mark.asyncio
async def test_reset_cannot_be_undone_by_late_foreground_answer(state,monkeypatch):
    s=state.get_or_create('reset')
    entered=asyncio.Event();release=asyncio.Event()
    async def think(_):
        entered.set();await release.wait();yield ('done',[(.5,'old answer')])
    monkeypatch.setattr(workshop,'_run_thinker',think)
    async def consume():return [x async for x in workshop._stream_workshop(s,'old input')]
    task=asyncio.create_task(consume());await entered.wait()
    runtime.runtime_for(s.id).epoch+=1;s.reset();release.set();await task
    assert s.messages==[]
