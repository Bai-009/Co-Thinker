import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExampleTransport } from './exampleTransport'
import { Repository } from '../storage/storage'
import { observation } from './fixtures/observation'
import type { BackgroundEvent, ReplyEvent } from './types'

let transport: ExampleTransport
let background: BackgroundEvent[]

const drain = async (stream: AsyncIterable<ReplyEvent>, into: ReplyEvent[]) => {
  for await (const event of stream) into.push(event)
}

/** 跑完一整轮，并把后台的延迟推过去。 */
async function turn(
  sessionId: string,
  text: string,
  historyRevision: number,
  extra: Partial<Parameters<ExampleTransport['submit']>[0]> = {},
) {
  const events: ReplyEvent[] = []
  const controller = new AbortController()
  const run = drain(
    transport.submit(
      {
        sessionId,
        requestId: `r-${Math.random()}`,
        clientMessageId: `c-${Math.random()}`,
        historyRevision,
        text,
        mode: 'send',
        ...extra,
      },
      controller.signal,
    ),
    events,
  )
  await vi.advanceTimersByTimeAsync(4000)
  await run
  return events
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  transport = new ExampleTransport(new Repository(`test-${Math.random()}`))
  background = []
  transport.subscribe((event) => background.push(event))
})

afterEach(() => {
  transport.dispose()
  vi.useRealTimers()
})

describe('一轮的时序', () => {
  it('脚本对得上就给脚本里的回应，后台随后跟上', async () => {
    const session = await transport.createSession(observation.key)
    const events = await turn(session.id, observation.steps[0].input, session.historyRevision)

    expect(events[0].type).toBe('accepted')
    expect(events.at(-1)?.type).toBe('reply_complete')
    const done = events.at(-1)
    expect(done?.type === 'reply_complete' && done.snapshot.messages).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(2000)
    expect(background.map((e) => e.type)).toEqual(['memory_started', 'memory_updated'])
    const updated = background.at(-1)
    expect(updated?.type === 'memory_updated' && updated.groundwork.coveredThrough).toBe(1)
  })

  it('对不上脚本时不假装理解，也不推进共同记录', async () => {
    const session = await transport.createSession(observation.key)
    const events = await turn(session.id, '随便说点别的。', session.historyRevision)
    const done = events.at(-1)
    expect(done?.type).toBe('reply_complete')
    const reply = done?.type === 'reply_complete' && done.snapshot.messages.at(-1)
    expect(reply && reply.text).toContain('没有连接模型')

    await vi.advanceTimersByTimeAsync(3000)
    expect(background).toHaveLength(0)
  })
})

describe('回改与竞态', () => {
  it('回改之后，基于旧输入的后台任务失去写入资格', async () => {
    const session = await transport.createSession(observation.key)
    // 不让后台的 1500ms 到期。
    const events: ReplyEvent[] = []
    const controller = new AbortController()
    const run = drain(
      transport.submit(
        {
          sessionId: session.id,
          requestId: 'r1',
          clientMessageId: 'c1',
          historyRevision: session.historyRevision,
          text: observation.steps[0].input,
          mode: 'send',
        },
        controller.signal,
      ),
      events,
    )
    await vi.advanceTimersByTimeAsync(1200)
    await run
    expect(background.map((e) => e.type)).toEqual(['memory_started'])

    const done = events.at(-1)
    const messages = done?.type === 'reply_complete' ? done.snapshot.messages : []
    const target = messages.find((m) => m.role === 'user')!

    await turn(session.id, '换个说法，我想做的是一本城市指南。', 1, {
      mode: 'revise',
      reviseTargetId: target.id,
    })

    await vi.advanceTimersByTimeAsync(4000)
    expect(background.some((e) => e.type === 'memory_updated' && e.historyRevision === 1)).toBe(
      false,
    )
    const after = await transport.loadSession(session.id)
    expect(after?.historyRevision).toBe(2)
    expect(after?.groundwork).toBeNull()
    expect(after?.messages.find((m) => m.id === target.id)?.version).toBe(2)
  })

  it('重试用同一个幂等键，不会多出一条重复的输入', async () => {
    const session = await transport.createSession(observation.key)
    await turn(session.id, observation.steps[0].input, session.historyRevision, {
      clientMessageId: 'same',
    })
    const before = (await transport.loadSession(session.id))!.messages.filter(
      (m) => m.role === 'user',
    ).length
    await turn(session.id, observation.steps[0].input, 1, {
      clientMessageId: 'same',
      mode: 'retry',
    })
    const after = (await transport.loadSession(session.id))!.messages.filter(
      (m) => m.role === 'user',
    ).length
    expect(after).toBe(before)
  })
})

describe('停止与恢复', () => {
  it('停止把半句话按中断存下来，不只是停住动画', async () => {
    const session = await transport.createSession(observation.key)
    const controller = new AbortController()
    const events: ReplyEvent[] = []
    const run = drain(
      transport.submit(
        {
          sessionId: session.id,
          requestId: 'r1',
          clientMessageId: 'c1',
          historyRevision: session.historyRevision,
          text: observation.steps[0].input,
          mode: 'send',
        },
        controller.signal,
      ),
      events,
    ).catch((error: DOMException) => error.name)

    await vi.advanceTimersByTimeAsync(400)
    controller.abort()
    await run

    const after = await transport.loadSession(session.id)
    const reply = after?.messages.at(-1)
    expect(reply?.role).toBe('assistant')
    expect(reply?.status).toBe('interrupted')
    expect(reply?.text.length).toBeGreaterThan(0)
  })

  it('刷新之后不假装还在生成', async () => {
    const session = await transport.createSession(observation.key)
    const controller = new AbortController()
    const events: ReplyEvent[] = []
    void drain(
      transport.submit(
        {
          sessionId: session.id,
          requestId: 'r1',
          clientMessageId: 'c1',
          historyRevision: session.historyRevision,
          text: observation.steps[0].input,
          mode: 'send',
        },
        controller.signal,
      ),
      events,
    ).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(400)

    const reloaded = await transport.loadSession(session.id)
    expect(reloaded?.messages.at(-1)?.status).not.toBe('streaming')
    controller.abort()
  })
})

describe('Brief 的快照', () => {
  it('冻结在请求那一刻，之后的新增不会渗进去', async () => {
    const session = await transport.createSession(observation.key)
    await turn(session.id, observation.steps[0].input, session.historyRevision)
    await vi.advanceTimersByTimeAsync(2000)

    const briefPromise = transport.requestBrief(
      { sessionId: session.id, requestId: 'b1', historyRevision: 1 },
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(1000)
    const brief = await briefPromise

    expect(brief.cutoffSequence).toBe(1)
    expect(brief.markdown).toContain('城市指南')

    await turn(session.id, '之后又想到一句。', 1)
    const later = await transport.loadSession(session.id)
    expect(later!.messages.length).toBeGreaterThan(brief.cutoffSequence + 1)
    expect(brief.markdown).not.toContain('之后又想到一句')
  })

  it('尚未沉淀的表达单独列为待核对', async () => {
    const session = await transport.createSession(observation.key)
    await turn(session.id, observation.steps[0].input, session.historyRevision)
    await vi.advanceTimersByTimeAsync(2000)
    await turn(session.id, '这一句还没被记录覆盖。', 1)

    const briefPromise = transport.requestBrief(
      { sessionId: session.id, requestId: 'b2', historyRevision: 1 },
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(1000)
    const brief = await briefPromise

    expect(brief.uncovered).toContain('这一句还没被记录覆盖。')
    expect(brief.markdown).toContain('新增表达，尚待核对')
  })
})
