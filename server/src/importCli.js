#!/usr/bin/env node
// 命令行导入旧 Typora 日记，直接写库，不需要启动服务器。
//
//   node src/importCli.js --dry 旧笔记.md      先预览，不写任何东西
//   node src/importCli.js 旧笔记.md            确认无误后真正导入
//
// 只往库里添加，从不删除或覆盖已有笔记。

import fs from 'node:fs'
import path from 'node:path'
import { createDb } from './db.js'
import { parseNotesMarkdown } from './importMd.js'
import { importParsed } from './entries.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const yearArg = args.find(a => a.startsWith('--year='))
const defaultYear = yearArg ? Number(yearArg.split('=')[1]) : undefined
const files = args.filter(a => !a.startsWith('--'))

if (!files.length) {
  console.error('用法: node src/importCli.js [--dry] [--year=2024] <文件.md> [更多文件...]')
  process.exit(1)
}

const dataDir = process.env.DATA_DIR || './data'
const db = createDb(dataDir)

let totals = { entries: 0, notes: 0, skipped: 0, days: 0 }
const allTasks = new Set()

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`✗ 找不到文件：${file}`)
    process.exitCode = 1
    continue
  }
  const text = fs.readFileSync(file, 'utf8')
  const parsed = parseNotesMarkdown(text, { defaultYear })
  const stats = importParsed(db, parsed, { dryRun })

  console.log(`\n${path.basename(file)}`)
  console.log(`  卡片 ${stats.entries} · 碎碎念 ${stats.notes} · 天数 ${stats.days} · 跳过空块 ${stats.skipped}`)
  console.log(`  任务：${stats.tasks.join(', ') || '（无）'}`)
  if (parsed.warnings.length) {
    console.log('  警告：')
    for (const w of parsed.warnings) console.log(`    · ${w}`)
  }

  totals.entries += stats.entries
  totals.notes += stats.notes
  totals.skipped += stats.skipped
  totals.days += stats.days
  stats.tasks.forEach(t => allTasks.add(t))
}

console.log(`\n${dryRun ? '【预览，未写入】' : '【已写入数据库】'} ` +
  `共 ${totals.entries} 张卡片、${totals.notes} 条碎碎念、${totals.days} 天、${allTasks.size} 个任务`)
if (dryRun) console.log('确认无误后去掉 --dry 重新运行即可真正导入。')
