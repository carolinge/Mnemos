import { describe, it, expect } from 'vitest'
import { setSaveStatus, worstStatus } from '../src/saveStatus'

describe('saveStatus', () => {
  it('取最严重状态：conflict > offline > saving > saved', () => {
    setSaveStatus('a', 'saved')
    expect(worstStatus()).toBe('saved')
    setSaveStatus('b', 'saving')
    expect(worstStatus()).toBe('saving')
    setSaveStatus('c', 'offline')
    expect(worstStatus()).toBe('offline')
    setSaveStatus('d', 'conflict')
    expect(worstStatus()).toBe('conflict')
    setSaveStatus('d', null)
    setSaveStatus('c', null)
    expect(worstStatus()).toBe('saving')
  })
})
