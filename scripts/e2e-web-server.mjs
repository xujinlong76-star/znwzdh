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

const dbPath = process.env.NAVHUB_E2E_DB_PATH
  ? resolve(process.cwd(), process.env.NAVHUB_E2E_DB_PATH)
  : resolve(process.cwd(), 'data/e2e/navhub-e2e.db')
mkdirSync(dirname(dbPath), { recursive: true })

const suffixes = ['', '-journal', '-wal', '-shm']
let lastError = null
/**
 * 30 次 × 500ms ≈ 15 秒。
 *
 * 原来是 20 × 300ms = 6 秒：Windows 上被强杀的 API 释放文件句柄可能正好卡在
 * 6 秒边界，实测等 6 秒再删就能成功——说明重试窗口给短了，不是「删不掉」。
 */
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    for (const suffix of suffixes) rmSync(`${dbPath}${suffix}`, { force: true })
    lastError = null
    break
  } catch (err) {
    lastError = err
    await new Promise((r) => setTimeout(r, 500))
  }
}
if (lastError) {
  console.error(`[e2e] 无法重置 E2E 数据库（可能仍有进程占用）：${dbPath}`)
  console.error(lastError.message)
  /**
   * 给出可执行的排查路径，而不是只报「被占用」。
   *
   * 实测最常见的成因：上一轮 E2E 被强杀（Ctrl+C 没传导到子进程 / 代理超时），
   * `e2e-web-server.mjs` 的 API 子进程仍在监听 E2E 端口并持有这个库文件。
   * 此时重跑永远失败，而错误信息只说「可能仍有进程占用」，不知道下一步做什么。
   */
  const apiPort = Number(process.env.NAVHUB_API_PORT || 8787)
  console.error('')
  console.error('[e2e] 排查步骤：')
  console.error(`  1) netstat -ano | findstr :${apiPort}      找到占用 E2E API 端口的 PID`)
  console.error('  2) taskkill /PID <pid> /F                  只杀那个进程')
  console.error(`  3) 确认端口已空：netstat -ano | findstr :${apiPort}`)
  console.error('')
  console.error('[e2e] 注意：只清理 E2E 端口的进程。常驻开发栈通常占用 :3000 / :8787，')
  console.error('[e2e] 动它会打断正在使用页面的其他人；换端口跑更安全：')
  console.error('[e2e]   node scripts/e2e-local.mjs            （自动挑一对空闲端口）')
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
