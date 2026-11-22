#!/usr/bin/env node
/**
 * 分批跑全量 E2E（2026-11-22）。
 *
 * ## 为什么要分批
 *
 * 单跑 `playwright test` 会在一个 webServer 上串行跑完 44 个 spec / 335 条用例，
 * 本机实测 31 分钟里 dev server 因内存累积崩溃，后续测试全部连锁失败
 * （12 个假红，但单独跑全部通过）。机器只有 16GB，长跑后仅剩 4GB 可用。
 *
 * ## 做法
 *
 * 按 spec 文件分批，每批由独立的 playwright CLI 调用启动自己的 webServer，
 * 批结束时 webServer 随 CLI 退出而关闭，内存自然释放。批间可插入冷却等待。
 *
 * ## 用法
 *
 *   node scripts/run-e2e-batches.mjs          # 默认 8 个 spec/批
 *   node scripts/run-e2e-batches.mjs 5        # 5 个/批（更保守）
 *   BATCH_COOLDOWN_MS=3000 node scripts/run-e2e-batches.mjs
 *
 * 额外参数透传给 playwright（如 --grep）：
 *   node scripts/run-e2e-batches.mjs 8 -- --grep hot
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const batchSize = Number(process.argv[2]) || 8
const extra = process.argv.indexOf('--') >= 0 ? process.argv.slice(process.argv.indexOf('--') + 1) : []
const cooldown = Number(process.env.BATCH_COOLDOWN_MS || 2000)
const specs = readdirSync('e2e')
  .filter((f) => f.endsWith('.spec.ts'))
  .sort()
  // 正斜杠：playwright 的文件过滤器不认 Windows 反斜杠路径（实测 0 tests）
  .map((f) => 'e2e/' + f)

if (specs.length === 0) {
  console.error('[e2e-batch] e2e/ 下没有 .spec.ts')
  process.exit(2)
}

const batches = []
for (let i = 0; i < specs.length; i += batchSize) {
  batches.push(specs.slice(i, i + batchSize))
}

console.log(
  '[e2e-batch] ' + specs.length + ' 个 spec / ' +
    batches.length + ' 批（每批 ' + batchSize + ' 个），批间冷却 ' + cooldown + 'ms',
)

let failedBatches = 0
for (let i = 0; i < batches.length; i++) {
  const batch = batches[i]
  console.log('\n[e2e-batch] === 第 ' + (i + 1) + '/' + batches.length + ' 批 ===')
  console.log('[e2e-batch] ' + batch.map((f) => f.split(/[\\/]/).pop()).join(', '))

  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['playwright', 'test', ...batch, '--reporter=line', ...extra],
    { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' },
  )
  if (r.status !== 0) {
    failedBatches++
    console.error('[e2e-batch] 第 ' + (i + 1) + ' 批失败（exit ' + r.status + '）')
  }
  if (i < batches.length - 1 && cooldown > 0) {
    spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'sleep',
      process.platform === 'win32' ? ['/c', 'timeout /t ' + Math.ceil(cooldown / 1000) + ' /nobreak']
        : [String(cooldown / 1000)],
      { stdio: 'ignore' })
  }
}

console.log('\n[e2e-batch] 完成：' + (batches.length - failedBatches) + '/' + batches.length + ' 批通过')
process.exit(failedBatches > 0 ? 1 : 0)
