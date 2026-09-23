"""Per-process orchestration for the single-worker local application.

The database owns durable state. These locks and job epochs own only in-flight
work; immutable message snapshots and persisted prefix snapshots own recovery.
"""
import asyncio
from dataclasses import dataclass, field


@dataclass
class Runtime:
    epoch: int = 0
    foreground_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    memory_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    memory_jobs: dict = field(default_factory=dict)
    memory_error: str = ""
    memory_prefix: int = 0
    # (纪元, 排队中最新任务的消息前缀)，用来让等待中的旧重写让位。
    memory_newest: tuple = (0, 0)
    generating: bool = False


_runtimes: dict[str, Runtime] = {}
_tasks: set[asyncio.Task] = set()


def runtime_for(session_id):
    return _runtimes.setdefault(session_id, Runtime())


def spawn(coro, rt, epoch, memory=True):
    task = asyncio.create_task(coro)
    _tasks.add(task)
    if memory:
        rt.memory_jobs[task] = epoch

    def done(t):
        _tasks.discard(t)
        rt.memory_jobs.pop(t, None)
        if not t.cancelled() and t.exception() is not None and rt.epoch == epoch:
            rt.memory_error = "共同记录暂未更新，对话已保存。"
    task.add_done_callback(done)
    return task


def memory_status(session):
    rt = runtime_for(session.id)
    pending = any(e == rt.epoch for e in rt.memory_jobs.values())
    covered = max((s.get("prefix", 0) for s in session.foundation_history), default=0)
    state = "updating" if pending else "error" if rt.memory_error else "empty" if not session.messages else "ready" if covered >= len(session.messages) else "pending"
    return {"state": state, "covered_messages": covered,
            "total_messages": len(session.messages), "detail": rt.memory_error}


async def shutdown():
    tasks = list(_tasks)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
