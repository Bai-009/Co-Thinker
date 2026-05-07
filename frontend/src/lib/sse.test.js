import { describe, expect, test } from 'vitest'

import { readSSE } from './sse'

function makeSSEResponse(chunks) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('readSSE', () => {
  test('parses one event from a single chunk', async () => {
    const events = []
    const r = makeSSEResponse(['data: {"type":"voice_delta","content":"hi"}\n\n'])
    await readSSE(r, (e) => events.push(e))
    expect(events).toEqual([{ type: 'voice_delta', content: 'hi' }])
  })

  test('parses multiple events from one chunk', async () => {
    const r = makeSSEResponse([
      'data: {"type":"voice_start","index":0}\n\n' +
        'data: {"type":"voice_delta","index":0,"content":"hi"}\n\n' +
        'data: {"type":"voice_end","index":0}\n\n',
    ])
    const events = []
    await readSSE(r, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual([
      'voice_start',
      'voice_delta',
      'voice_end',
    ])
  })

  test('handles event split across multiple chunks', async () => {
    const r = makeSSEResponse([
      'data: {"type":"voice_de',
      'lta","content":"split"}\n',
      '\n',
    ])
    const events = []
    await readSSE(r, (e) => events.push(e))
    expect(events).toEqual([{ type: 'voice_delta', content: 'split' }])
  })

  test('skips malformed JSON without throwing', async () => {
    const r = makeSSEResponse([
      'data: {bad json}\n\n' + 'data: {"type":"ok"}\n\n',
    ])
    const events = []
    await readSSE(r, (e) => events.push(e))
    expect(events).toEqual([{ type: 'ok' }])
  })

  test('throws on non-2xx response', async () => {
    const bad = new Response('nope', { status: 500 })
    await expect(readSSE(bad, () => {})).rejects.toThrow(/HTTP 500/)
  })
})
