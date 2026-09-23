import { describe, expect, it } from 'vitest'
import { acceptsBackground, emptySession, sessionReducer, uncoveredMessages } from './sessionReducer'
import type { Groundwork, Message, SessionSnapshot } from './types'

const msg = (id: string, sequence: number, role: Message['role'] = 'user'): Message => ({
  id,
  sequence,
  version: 1,
  role,
  text: id,
  status: 'complete',
  createdAt: 0,
})

const ground = (over: Partial<Groundwork> = {}): Groundwork => ({
  version: 2,
  historyRevision: 1,
  coveredThrough: 1,
  prose: '第一版',
  claims: [],
  open: [],
  updatedAt: 0,
  ...over,
})

const snapshot = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: 's1',
  title: '一段',
  historyRevision: 1,
  messages: [msg('u1', 0), msg('a1', 1, 'assistant')],
  groundwork: ground(),
  groundworkHistory: [ground()],
  ...over,
})

const loaded = () => sessionReducer(emptySession(), { type: 'session/loaded', snapshot: snapshot() })

describe('后台写入的门禁', () => {
  it('修订号对不上的结果没有写入资格', () => {
    const state = loaded()
    const event = {
      type: 'memory_updated' as const,
      sessionId: 's1',
      historyRevision: 2,
      groundwork: ground({ version: 9, prose: '过期的' }),
    }
    expect(acceptsBackground(state, event)).toBe(false)
    expect(sessionReducer(state, { type: 'background', event }).groundwork?.prose).toBe('第一版')
  })

  it('换了会话的结果不会落到当前会话上', () => {
    const state = loaded()
    const event = {
      type: 'memory_updated' as const,
      sessionId: 'other',
      historyRevision: 1,
      groundwork: ground({ version: 9, prose: '别的会话' }),
    }
    expect(acceptsBackground(state, event)).toBe(false)
  })

  it('版本倒退、覆盖范围倒退都拒绝', () => {
    const state = loaded()
    expect(
      acceptsBackground(state, {
        type: 'memory_updated',
        sessionId: 's1',
        historyRevision: 1,
        groundwork: ground({ version: 1 }),
      }),
    ).toBe(false)
    expect(
      acceptsBackground(state, {
        type: 'memory_updated',
        sessionId: 's1',
        historyRevision: 1,
        groundwork: ground({ version: 5, coveredThrough: 0 }),
      }),
    ).toBe(false)
    expect(
      acceptsBackground(state, {
        type: 'memory_updated',
        sessionId: 's1',
        historyRevision: 1,
        groundwork: ground({ version: 5, coveredThrough: 1 }),
      }),
    ).toBe(true)
  })

  it('更新失败保留最后一版有效记录', () => {
    const state = sessionReducer(loaded(), {
      type: 'background',
      event: { type: 'memory_failed', sessionId: 's1', historyRevision: 1, reason: '没成' },
    })
    expect(state.memory).toEqual({ state: 'failed', detail: '没成' })
    expect(state.groundwork?.prose).toBe('第一版')
  })
})

describe('前台请求的门禁', () => {
  it('上一次请求的晚到事件不会继续往当前回答里写', () => {
    let state = loaded()
    state = sessionReducer(state, { type: 'turn/started', requestId: 'r2', optimistic: null })
    const stale = sessionReducer(state, {
      type: 'reply',
      event: {
        type: 'reply_delta',
        requestId: 'r1',
        sessionId: 's1',
        messageId: 'a1',
        chunk: '旧的',
      },
    })
    expect(stale.messages.find((m) => m.id === 'a1')?.text).toBe('a1')
  })

  it('乐观插入的输入被快照替换，不留重影', () => {
    let state = loaded()
    const optimistic = { ...msg('local-x', 2), clientMessageId: 'ck1' }
    state = sessionReducer(state, { type: 'turn/started', requestId: 'r1', optimistic })
    expect(state.messages).toHaveLength(3)
    const real = { ...msg('u2', 2), clientMessageId: 'ck1' }
    state = sessionReducer(state, {
      type: 'reply',
      event: {
        type: 'accepted',
        requestId: 'r1',
        sessionId: 's1',
        snapshot: snapshot({ messages: [msg('u1', 0), msg('a1', 1, 'assistant'), real] }),
      },
    })
    expect(state.messages).toHaveLength(3)
    expect(state.messages.filter((m) => m.clientMessageId === 'ck1')).toHaveLength(1)
  })
})

describe('阶段与覆盖范围', () => {
  it('阶段按 idle → submitting → streaming → complete 走，取消先进 cancelling', () => {
    let state = loaded()
    expect(state.phase).toBe('idle')
    state = sessionReducer(state, { type: 'turn/started', requestId: 'r1', optimistic: null })
    expect(state.phase).toBe('submitting')
    state = sessionReducer(state, {
      type: 'reply',
      event: { type: 'reply_started', requestId: 'r1', sessionId: 's1', messageId: 'a2' },
    })
    expect(state.phase).toBe('streaming')
    state = sessionReducer(state, { type: 'turn/cancelRequested' })
    expect(state.phase).toBe('cancelling')
    state = sessionReducer(state, { type: 'turn/settled' })
    expect(state.phase).toBe('complete')
  })

  it('地基落后时，尚未覆盖的表达数得出来', () => {
    const state = sessionReducer(emptySession(), {
      type: 'session/loaded',
      snapshot: snapshot({
        messages: [msg('u1', 0), msg('a1', 1, 'assistant'), msg('u2', 2), msg('u3', 3)],
        groundwork: ground({ coveredThrough: 1 }),
      }),
    })
    expect(uncoveredMessages(state).map((m) => m.id)).toEqual(['u2', 'u3'])
  })
})

describe('地基版本的留存', () => {
  it('每一版都留下；同一覆盖位置重来一次就替换，不留两份', () => {
    const at = (version: number, prose: string) => ({
      type: 'memory_updated' as const,
      sessionId: 's1',
      historyRevision: 1,
      groundwork: ground({ version, coveredThrough: 3, prose }),
    })
    let state = sessionReducer(loaded(), { type: 'background', event: at(3, '第二版') })
    expect(state.groundworkHistory.map((g) => g.version)).toEqual([2, 3])
    state = sessionReducer(state, { type: 'background', event: at(4, '重试后的第二版') })
    expect(state.groundworkHistory.map((g) => g.version)).toEqual([2, 4])
    expect(state.groundwork?.prose).toBe('重试后的第二版')
  })
})

describe('这一轮没生成出来', () => {
  it('失败留在那一轮下面，不顶到对话上方', () => {
    let state = sessionReducer(loaded(), { type: 'turn/started', requestId: 'r1', optimistic: null })
    state = sessionReducer(state, {
      type: 'reply',
      event: { type: 'reply_failed', requestId: 'r1', sessionId: 's1', reason: '生成失败', snapshot: snapshot() },
    })
    expect(state.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'failed', error: '生成失败' })
    expect(state.error).toBeNull()
  })
})
