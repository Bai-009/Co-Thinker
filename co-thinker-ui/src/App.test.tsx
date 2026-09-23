import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { ExampleTransport } from './transport/exampleTransport'
import { observation } from './transport/fixtures/observation'
import { Repository, repository } from './storage/storage'

const OPENING = observation.steps[0].input

beforeEach(() => {
  localStorage.clear()
  repository.clear()
})

const mount = () => {
  const transport = new ExampleTransport(new Repository(`app-${Math.random()}`))
  render(<App transport={transport} />)
  return { transport, user: userEvent.setup() }
}

async function firstTurn(user: ReturnType<typeof userEvent.setup>) {
  const area = screen.getByLabelText('说一句')
  await user.click(area)
  await user.paste(OPENING)
  await user.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(screen.getByText(/指南给的是去哪里/)).toBeInTheDocument(), {
    timeout: 6000,
  })
  // 生成中不给「修改这句」，用它判断这一轮已落定。
  await waitFor(
    () => expect(screen.getByRole('button', { name: '修改' })).toBeInTheDocument(),
    { timeout: 8000 },
  )
}

describe('一段完整的操作', () => {
  it('空会话不要求先填任何东西，第一句话就能进去', async () => {
    mount()
    await waitFor(() =>
      expect(screen.getByText('Prompt as crystallized thinking')).toBeInTheDocument(),
    )
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByLabelText('说一句')).toBeEnabled()
  })

  it('开合地基，草稿还在', async () => {
    const { user } = mount()
    await firstTurn(user)

    const area = screen.getByLabelText('说一句')
    await user.click(area)
    await user.paste('写到一半的话')

    await user.click(screen.getByRole('button', { name: '地基' }))
    await user.click(screen.getByRole('button', { name: '地基' }))
    expect(screen.getByLabelText('说一句')).toHaveValue('写到一半的话')
  }, 20000)

  it('取消修改，把原来还没发的那句放回来', async () => {
    const { user } = mount()
    await firstTurn(user)

    const area = screen.getByLabelText('说一句')
    await user.click(area)
    await user.paste('写到一半的话')

    await user.click(screen.getByRole('button', { name: '修改' }))
    expect(screen.getByLabelText('说一句')).toHaveValue(OPENING)

    await user.click(screen.getByRole('button', { name: '取消修改' }))
    expect(screen.getByLabelText('说一句')).toHaveValue('写到一半的话')
  }, 20000)

  it('引用整条继续讨论，引用本身不是认同', async () => {
    const { user } = mount()
    await firstTurn(user)

    const quoteButtons = screen.getAllByRole('button', { name: '引用这条回复' })
    await user.click(quoteButtons[quoteButtons.length - 1])

    expect(document.querySelector('.ct-quote span')).toHaveTextContent('引用')
    expect(screen.queryByText(/已确认/)).toBeNull()
    expect(screen.getByRole('button', { name: '取消引用' })).toBeInTheDocument()
  }, 20000)

  it('一键凝成 Prompt：在地基那张纸上打开，看得到依据，复制后说一声', async () => {
    const { user } = mount()
    await firstTurn(user)
    await waitFor(() => expect(screen.getByRole('button', { name: '01' })).toBeInTheDocument(), {
      timeout: 6000,
    })
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void (copied = text) },
    })

    await user.click(screen.getByRole('button', { name: '生成 Prompt' }))
    // 不是弹窗：标题变成两份文稿之间的切换，Prompt 是当前那份。
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Prompt', selected: true })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: '地基' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/截至第 1 轮/)).toBeInTheDocument(), { timeout: 8000 })
    expect(screen.queryByText(/交给 Cursor、Claude Code/)).toBeNull()

    await user.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument())
    expect(copied).toContain('## 我想做什么')

    // 切回地基再回来：不重新生成，还是那一份。
    await user.click(screen.getByRole('tab', { name: '地基' }))
    expect(screen.getByRole('button', { name: 'Prompt' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Prompt' }))
    expect(screen.getByText(/截至第 1 轮/)).toBeInTheDocument()
  }, 30000)

  it('后台跟上之后，这一轮定下了什么写在对话里，地基按认识状态分开说', async () => {
    mount()
    const user = userEvent.setup()
    await firstTurn(user)

    // 地基那一行出现在回应之后，只给编号；对话里不再画分界线。
    await waitFor(() => expect(screen.getByRole('button', { name: '01' })).toBeInTheDocument(), {
      timeout: 6000,
    })
    expect(document.querySelector('.ct-settled')).toHaveTextContent('地基')
    expect(screen.queryByText('沉淀到这里')).toBeNull()

    expect(screen.getByText(/城市指南那种形式我不做/)).toBeInTheDocument()
    // 没定的另立一节，用同样的墨色，靠措辞说明。
    expect(screen.getByText('待定')).toBeInTheDocument()
    expect(screen.getByText('换成什么形式，现在没有答案。')).toBeInTheDocument()
  }, 20000)

  it('编号两头都能走：对话里的 01 到地基那一条，地基的 01 回到原话', async () => {
    const { user } = mount()
    await firstTurn(user)
    await waitFor(() => expect(screen.getByRole('button', { name: '01' })).toBeInTheDocument(), {
      timeout: 6000,
    })

    await user.click(screen.getByRole('button', { name: '01' }))
    expect(document.querySelector('[data-claim="1"]')).toHaveClass('is-highlighted')

    await user.click(screen.getByRole('button', { name: '定位到第 1 条的原文' }))
    const mine = screen.getByLabelText('我的消息')
    expect(mine.querySelector('.ct-user-text')).toHaveClass('is-highlighted')
  }, 20000)
})
