import { describe, it, expect } from 'vitest'
import { parseNotesMarkdown } from '../src/importMd.js'

describe('parseNotesMarkdown', () => {
  it('按 span id 定年月日，任务卡片归属正确', () => {
    const md = [
      '##### <span id="260312">Mar 12<sup>th</sup></span>',
      '',
      '<font color=#22dddd>talk</font>原来有这么多人做condensate了',
      '',
      '-  Tyler: 长RNA折叠',
      '',
      '<font color=#3388dd>PH</font>',
      '',
      '1. 修复了 equilibrium.py',
    ].join('\n')
    const r = parseNotesMarkdown(md)
    expect(r.entries.length).toBe(2)
    expect(r.entries[0]).toMatchObject({ day: '2026-03-12', task: 'talk', position: 0 })
    expect(r.entries[0].markdown).toContain('原来有这么多人做condensate了')
    expect(r.entries[0].markdown).toContain('Tyler: 长RNA折叠')
    expect(r.entries[1]).toMatchObject({ day: '2026-03-12', task: 'PH', position: 1 })
    expect(r.entries[1].markdown).toContain('equilibrium.py')
  })

  it('日期后、首个任务前的散文 → 当天碎碎念', () => {
    const md = [
      '##### <span id="260508">May 08<sup>th</sup></span>',
      '',
      '我现在的注意力堪比一头成年大象。。。',
      '',
      '<font color=#3388dd>DEN</font>',
      '',
      '- mpnn 需要指定链编号',
    ].join('\n')
    const r = parseNotesMarkdown(md)
    expect(r.asides).toEqual([{ day: '2026-05-08', text: '我现在的注意力堪比一头成年大象。。。' }])
    expect(r.entries.length).toBe(1)
    expect(r.entries[0].markdown).not.toContain('成年大象')
  })

  it('无 span id 的日期沿用 H1 年份', () => {
    const md = [
      '# 2025',
      '',
      '##### May 16<sup>th</sup>',
      '',
      '<font color=#3388dd>SAM</font>',
      '',
      '1. 做了很多 benchmark',
    ].join('\n')
    const r = parseNotesMarkdown(md)
    expect(r.entries[0].day).toBe('2025-05-16')
  })

  it('无 span id 时月份倒退 → 判定跨年', () => {
    const md = [
      '# 2024',
      '##### Dec 20<sup>th</sup>',
      '<font color=#3388dd>PH</font>',
      '1. 年底',
      '##### Jan 05<sup>th</sup>',
      '<font color=#3388dd>PH</font>',
      '1. 新年',
    ].join('\n')
    const r = parseNotesMarkdown(md)
    expect(r.entries.map(e => e.day)).toEqual(['2024-12-20', '2025-01-05'])
    expect(r.warnings.some(w => w.includes('跨年'))).toBe(true)
  })

  it('span id 与 H1 年份冲突时以 span id 为准并告警', () => {
    const md = [
      '# 2025',
      '##### <span id="260312">Mar 12<sup>th</sup></span>',
      '<font color=#3388dd>PH</font>',
      '1. x',
    ].join('\n')
    const r = parseNotesMarkdown(md)
    expect(r.entries[0].day).toBe('2026-03-12')
    expect(r.warnings.some(w => w.includes('不一致'))).toBe(true)
  })

  it('任务代号大小写归一：Daosim 与 DaOSim 视为同一任务', () => {
    const md = [
      '##### <span id="260512">May 12<sup>th</sup></span>',
      '<font color=#3388dd>Daosim</font>',
      '1. 第一次',
      '##### <span id="260520">May 20<sup>th</sup></span>',
      '<font color=#3388dd>DaOSim</font>',
      '1. 第二次',
    ].join('\n')
    const r = parseNotesMarkdown(md)
    expect(r.tasks.map(t => t.name)).toEqual(['Daosim'])
    expect(r.entries.map(e => e.task)).toEqual(['Daosim', 'Daosim'])
  })

  it('保留 blockquote / 表格 / 公式 / 嵌套列表原文', () => {
    const md = [
      '##### <span id="260714">July 14<sup>th</sup></span>',
      '<font color=#3388dd>FIB</font>',
      '1. 复习 Mpipi',
      '',
      '   > $$U = U_{bond} + U_{DH}$$',
      '   >',
      '   > 三项必须都在。',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '-  外层',
      '   -  内层',
    ].join('\n')
    const r = parseNotesMarkdown(md)
    const body = r.entries[0].markdown
    expect(body).toContain('> $$U = U_{bond} + U_{DH}$$')
    expect(body).toContain('| --- | --- |')
    expect(body).toContain('   -  内层')
  })

  it('同一天同一任务出现两次 → 两张独立卡片，position 递增', () => {
    const md = [
      '##### <span id="260714">July 14<sup>th</sup></span>',
      '<font color=#3388dd>PHO</font>',
      '1. 和G老师讨论',
      '<font color=#3388dd>PHO</font>',
      '复习了一遍推导',
    ].join('\n')
    const r = parseNotesMarkdown(md)
    expect(r.entries.length).toBe(2)
    expect(r.entries.map(e => e.position)).toEqual([0, 1])
  })

  it('空文档不炸', () => {
    const r = parseNotesMarkdown('')
    expect(r.entries).toEqual([])
    expect(r.asides).toEqual([])
    expect(r.tasks).toEqual([])
  })
})
