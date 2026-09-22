import { describe, expect, it } from 'vitest'
import { applyClarity, applySense, bilerp, computeEngagement, SENSE_BASE_CORNERS } from './sense'

describe('色温通道', () => {
  it('四个角上就是四个角的颜色', () => {
    expect(bilerp(SENSE_BASE_CORNERS, 0, 0)).toEqual([...SENSE_BASE_CORNERS.c00])
    expect(bilerp(SENSE_BASE_CORNERS, 1, 0)).toEqual([...SENSE_BASE_CORNERS.c10])
    expect(bilerp(SENSE_BASE_CORNERS, 0, 1)).toEqual([...SENSE_BASE_CORNERS.c01])
    expect(bilerp(SENSE_BASE_CORNERS, 1, 1)).toEqual([...SENSE_BASE_CORNERS.c11])
  })

  it('正中是一张干净的近白纸', () => {
    expect(bilerp(SENSE_BASE_CORNERS, 0.5, 0.5)).toEqual([245, 245, 244])
    expect(computeEngagement(0.5, 0.5)).toBe(0)
  })

  it('写进根元素，越界会夹住', () => {
    applySense(1.5, -0.2)
    const root = document.documentElement
    expect(root.style.getPropertyValue('--sense-base')).toMatch(/^rgb\(/)
    expect(parseFloat(root.style.getPropertyValue('--sense-engagement'))).toBeLessThanOrEqual(1)
  })
})

describe('清晰度通道', () => {
  it('低清晰度：纸纹重、边软、有雾；高清晰度：压平', () => {
    const root = document.documentElement
    applyClarity(0)
    expect(parseFloat(root.style.getPropertyValue('--sense-grain'))).toBeGreaterThan(0.2)
    expect(parseFloat(root.style.getPropertyValue('--sense-haze'))).toBeGreaterThan(1)
    applyClarity(1)
    expect(parseFloat(root.style.getPropertyValue('--sense-grain'))).toBeLessThan(0.1)
    expect(parseFloat(root.style.getPropertyValue('--sense-edge'))).toBe(1)
    expect(parseFloat(root.style.getPropertyValue('--sense-haze'))).toBe(0)
  })
})
