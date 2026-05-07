import { describe, expect, test } from 'vitest'

import { makeId, parseBriefSections, parseStoredVoices } from './messages'

describe('parseStoredVoices', () => {
  test('parses [VOICE] markers with [CONF] inside', () => {
    const out = parseStoredVoices(
      '[VOICE]\n[CONF]0.7[/CONF]\nfirst\n[/VOICE]\n\n' +
        '[VOICE]\n[CONF]0.4[/CONF]\nsecond\n[/VOICE]',
    )
    expect(out.voices).toEqual(['first', 'second'])
    expect(out.confs).toEqual([0.7, 0.4])
  })

  test('defaults missing CONF to 0.5', () => {
    const out = parseStoredVoices('[VOICE]\nno conf here\n[/VOICE]')
    expect(out.voices).toEqual(['no conf here'])
    expect(out.confs).toEqual([0.5])
  })

  test('clamps CONF to [0, 1]', () => {
    const out = parseStoredVoices(
      '[VOICE][CONF]1.4[/CONF]too hot[/VOICE][VOICE][CONF]-0.2[/CONF]too cold[/VOICE]',
    )
    expect(out.confs).toEqual([1, 0])
  })

  test('drops empty voice bodies', () => {
    const out = parseStoredVoices('[VOICE]\n[CONF]0.5[/CONF]\n   \n[/VOICE]\n\n[VOICE]\n[CONF]0.9[/CONF]\nreal\n[/VOICE]')
    expect(out.voices).toEqual(['real'])
    expect(out.confs).toEqual([0.9])
  })

  test('falls back to legacy 视角 format', () => {
    const out = parseStoredVoices('[视角 1] hello\n\n[视角 2] world')
    expect(out.voices).toEqual(['hello', 'world'])
    expect(out.confs).toEqual([0.5, 0.5])
  })

  test('returns empty arrays for unstructured content', () => {
    expect(parseStoredVoices('plain text')).toEqual({ voices: [], confs: [] })
    expect(parseStoredVoices('')).toEqual({ voices: [], confs: [] })
    expect(parseStoredVoices(null)).toEqual({ voices: [], confs: [] })
  })
})

describe('parseBriefSections', () => {
  test('splits markdown on ## headings', () => {
    const text = '## What\nbuild a thing\n\n## Why\nbecause'
    expect(parseBriefSections(text)).toEqual([
      { heading: 'What', body: 'build a thing' },
      { heading: 'Why', body: 'because' },
    ])
  })

  test('handles heading-only section', () => {
    expect(parseBriefSections('## Standalone')).toEqual([
      { heading: 'Standalone', body: '' },
    ])
  })

  test('returns [] for empty input', () => {
    expect(parseBriefSections('')).toEqual([])
  })
})

describe('makeId', () => {
  test('returns unique-ish strings', () => {
    const ids = new Set()
    for (let i = 0; i < 50; i++) ids.add(makeId())
    expect(ids.size).toBeGreaterThan(45)
  })
})
