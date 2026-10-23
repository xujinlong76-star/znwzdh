#!/usr/bin/env node
/**
 * E2E webServer 入口：先重置 E2E 数据库，再启动 dev-all。
 *
 * 为什么需要这一层：Playwright 会**先启动 webServer、再跑 globalSetup**。
 * 原来的重置逻辑放在 globalSetup 里，等它执行时中枢 API 已经打开了
 * `data/e2e/navhub-e2e.db`——Linux 上可以 unlink 已打开的文件，Windows 直接
 * EBUSY，本地 E2E 永远起不来（CI 是 Linux，所以一直没暴露）。
 *
 * 现在重置挪到「启动 dev-all 之前」，globalSetup 只保留建目录。
 * 删除带重试：上一轮被强杀的 API 可能还有几百毫秒的文件句柄未释放。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'

const dbPath = resolve(process.cwd(), process.env.NAVHUB_E2E_DB || 'data/e2e/navhub-e2e.db')
mkdirSync(dirname(dbPath), { recursive: true })

const suffixes = ['', '-journal', '-wal', '-shm']
let lastError = null
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    for (const suffix of suffixes) rmSync(`${dbPath}${suffix}`, { force: true })
    lastError = null
    break
  } catch (err) {
    lastError = err
    await new Promise((r) => setTimeout(r, 300))
  }
}
if (lastError) {
  console.error(`[e2e] 无法重置 E2E 数据库（可能仍有进程占用）：${dbPath}`)
  console.error(lastError.message)
  process.exit(1)
}

const child = spawn(process.execPath, ['scripts/dev-all.mjs'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal)
    process.exit(0)
  })
}

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('[e2e] 启动 dev-all 失败：', err.message)
  process.exit(1)
})
