import { describe, expect, test } from 'vitest'

import {
  applyClarity,
  applySense,
  bilerp,
  computeEngagement,
  SENSE_BASE_CORNERS,
} from './sense'

describe('bilerp', () => {
  test('returns each corner exactly at the corners', () => {
    expect(bilerp(SENSE_BASE_CORNERS, 0, 0)).toEqual(SENSE_BASE_CORNERS.c00)
    expect(bilerp(SENSE_BASE_CORNERS, 1, 0)).toEqual(SENSE_BASE_CORNERS.c10)
    expect(bilerp(SENSE_BASE_CORNERS, 0, 1)).toEqual(SENSE_BASE_CORNERS.c01)
    expect(bilerp(SENSE_BASE_CORNERS, 1, 1)).toEqual(SENSE_BASE_CORNERS.c11)
  })

  test('blends to a midpoint at center', () => {
    const mid = bilerp(SENSE_BASE_CORNERS, 0.5, 0.5)
    const expected = [
      Math.round(
        (SENSE_BASE_CORNERS.c00[0] +
          SENSE_BASE_CORNERS.c10[0] +
          SENSE_BASE_CORNERS.c01[0] +
          SENSE_BASE_CORNERS.c11[0]) /
          4,
      ),
    ]
    expect(mid[0]).toBe(expected[0])
  })
})

describe('computeEngagement', () => {
  test('is 0 at the neutral center', () => {
    expect(computeEngagement(0.5, 0.5)).toBe(0)
  })

  test('is positive away from center', () => {
    expect(computeEngagement(0, 0)).toBeGreaterThan(0)
    expect(computeEngagement(1, 1)).toBeGreaterThan(0)
  })

  test('clamps to [0, 1]', () => {
    expect(computeEngagement(2, 2)).toBeLessThanOrEqual(1)
    expect(computeEngagement(-1, -1)).toBeGreaterThanOrEqual(0)
  })
})

describe('applySense', () => {
  test('writes CSS custom properties on documentElement', () => {
    applySense(0.7, 0.3)
    const root = document.documentElement
    expect(root.style.getPropertyValue('--sense-base')).toMatch(/^rgb\(/)
    expect(root.style.getPropertyValue('--sense-accent')).toMatch(/^rgb\(/)
    expect(root.style.getPropertyValue('--sense-engagement')).not.toBe('')
  })

  test('clamps inputs out of range', () => {
    // Should not throw; engagement should be defined.
    applySense(1.5, -0.2)
    expect(
      document.documentElement.style.getPropertyValue('--sense-engagement'),
    ).not.toBe('')
  })
})

describe('applyClarity', () => {
  test('low clarity → high grain, soft edge, max haze', () => {
    applyClarity(0)
    const root = document.documentElement
    const grain = parseFloat(root.style.getPropertyValue('--sense-grain'))
    const edge = parseFloat(root.style.getPropertyValue('--sense-edge'))
    const haze = root.style.getPropertyValue('--sense-haze')
    expect(grain).toBeGreaterThan(0.3)
    expect(edge).toBe(0)
    expect(haze).toMatch(/px$/)
    expect(parseFloat(haze)).toBeGreaterThan(1)
  })

  test('high clarity → low grain, sharp edge, near-zero haze', () => {
    applyClarity(1)
    const root = document.documentElement
    expect(parseFloat(root.style.getPropertyValue('--sense-grain'))).toBeLessThan(0.1)
    expect(parseFloat(root.style.getPropertyValue('--sense-edge'))).toBe(1)
    expect(parseFloat(root.style.getPropertyValue('--sense-haze'))).toBe(0)
  })

  test('clamps inputs out of range', () => {
    applyClarity(2)  // above 1
    expect(parseFloat(document.documentElement.style.getPropertyValue('--sense-edge'))).toBe(1)
    applyClarity(-1) // below 0
    expect(parseFloat(document.documentElement.style.getPropertyValue('--sense-edge'))).toBe(0)
  })
})
