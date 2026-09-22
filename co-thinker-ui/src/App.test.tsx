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

    const quoteButtons = screen.getAllByRole('button', { name: '引用这段回应' })
    await user.click(quoteButtons[quoteButtons.length - 1])

    expect(screen.getByText('这一段')).toBeInTheDocument()
    expect(screen.queryByText(/已确认/)).toBeNull()
    expect(screen.getByRole('button', { name: '取消引用' })).toBeInTheDocument()
  }, 20000)

  it('后台跟上之后，这一轮定下了什么写在对话里，地基按认识状态分开说', async () => {
    mount()
    const user = userEvent.setup()
    await firstTurn(user)

    // 沉淀那一行出现在回应之后；没有更后面的话，就不画「沉淀到这里」。
    await waitFor(() => expect(screen.getByRole('button', { name: '01' })).toBeInTheDocument(), {
      timeout: 6000,
    })
    expect(screen.getByText(/定下/)).toBeInTheDocument()
    expect(screen.queryByText('沉淀到这里')).toBeNull()

    expect(screen.getByText(/城市指南那种形式我不做/)).toBeInTheDocument()
    expect(screen.getByText('还在松动')).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: '回到第 1 条的原话' }))
    const mine = screen.getByLabelText('我的表达')
    expect(mine.querySelector('.ct-user-text')).toHaveClass('is-highlighted')
  }, 20000)
})
