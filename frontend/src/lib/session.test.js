import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  clearSessionId,
  getSessionId,
  SESSION_HEADER,
  sessionedFetch,
} from './session'

describe('sessionedFetch', () => {
  beforeEach(() => {
    clearSessionId()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearSessionId()
  })

  test('omits X-Session-Id when none stored', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('ok', { headers: { 'X-Session-Id': 'server-issued-id' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await sessionedFetch('/api/chat/history')

    const sentHeaders = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(sentHeaders.has(SESSION_HEADER)).toBe(false)
    expect(getSessionId()).toBe('server-issued-id')
  })

  test('sends stored X-Session-Id and persists any returned id', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('ok', { headers: { 'X-Session-Id': 'echoed-id' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    // Seed via a first call
    await sessionedFetch('/api/chat/history')
    expect(getSessionId()).toBe('echoed-id')

    // Second call sends the stored id
    await sessionedFetch('/api/chat/history')
    const sentHeaders = new Headers(fetchMock.mock.calls[1][1].headers)
    expect(sentHeaders.get(SESSION_HEADER)).toBe('echoed-id')
  })
})
