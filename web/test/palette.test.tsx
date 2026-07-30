import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('../src/api', () => ({ api: vi.fn() }))
import { api } from '../src/api'
import { CommandPalette, parseDateQuery } from '../src/components/CommandPalette'

const mockApi = api as unknown as ReturnType<typeof vi.fn>
beforeEach(() => { mockApi.mockReset(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => vi.useRealTimers())

describe('parseDateQuery', () => {
  it('识别 2026-03-12 / 2026.3.2 / 3月12', () => {
    expect(parseDateQuery('2026-03-12')).toBe('2026-03-12')
    expect(parseDateQuery('2026.3.2')).toBe('2026-03-02')
    expect(parseDateQuery('3月12', 2026)).toBe('2026-03-12')
    expect(parseDateQuery('随便写点')).toBeNull()
  })
})

describe('CommandPalette', () => {
  it('输入触发防抖搜索并渲染结果；点击回调跳转', async () => {
    mockApi.mockResolvedValue({ days: [{ day: '2026-07-01', entries: [
      { id: 'e1', day: '2026-07-01', text: '钙钛矿旋涂参数摸索', tags: [], position: 0, version: 0, content: {}, created_at: '', updated_at: '' },
    ] }] })
    const onJump = vi.fn()
    render(<CommandPalette open onClose={() => {}} onJumpDay={onJump} onSelectProject={() => {}} projects={[]} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '钙钛矿' } })
    await act(() => vi.advanceTimersByTimeAsync(400))
    await waitFor(() => expect(screen.getByText(/旋涂参数/)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/旋涂参数/))
    expect(onJump).toHaveBeenCalledWith('2026-07-01')
  })

  it('输入日期样式出现跳转项', async () => {
    render(<CommandPalette open onClose={() => {}} onJumpDay={() => {}} onSelectProject={() => {}} projects={[]} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2026-03-12' } })
    await waitFor(() => expect(screen.getByText(/跳到 2026-03-12/)).toBeInTheDocument())
  })
})
