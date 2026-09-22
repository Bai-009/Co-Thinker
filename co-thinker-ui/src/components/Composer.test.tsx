import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Composer } from './Composer'

const setup = (overrides: Partial<Parameters<typeof Composer>[0]> = {}) => {
  const onSend = vi.fn()
  render(
    <Composer
      value="还没说完"
      reference={null}
      referenceState={{ status: 'missing' }}
      editing={null}
      streaming={false}
      canSend
      onChange={() => {}}
      onSend={onSend}
      onCancelRun={() => {}}
      onCancelEdit={() => {}}
      onDropReference={() => {}}
      onLocate={() => {}}
      {...overrides}
    />,
  )
  return { onSend, area: screen.getByLabelText('说一句') }
}

describe('输入', () => {
  it('中文输入法组合期间的 Enter 是选字，不是提交', () => {
    const { onSend, area } = setup()
    fireEvent.compositionStart(area)
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()

    // 浏览器之间行为不一致，两条保险都要挡住。
    fireEvent.compositionEnd(area)
    fireEvent.keyDown(area, { key: 'Enter', keyCode: 229 })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('选完字之后 Enter 才发送，Shift+Enter 是换行', () => {
    const { onSend, area } = setup()
    fireEvent.compositionStart(area)
    fireEvent.compositionEnd(area)
    fireEvent.keyDown(area, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('引用说的是「继续讨论」，不说「已确认」', () => {
    setup({
      reference: { sessionId: 's', sourceId: 'm', sourceVersion: 1, quote: '构图仍然在引导观看' },
      referenceState: { status: 'changed' } as never,
    })
    expect(screen.getByText('依据已改变')).toBeInTheDocument()
    expect(screen.queryByText(/已确认/)).toBeNull()
  })
})
