#!/usr/bin/env node
/**
 * 视频模块的**作用域化**类型门禁。
 *
 * 为什么不能直接打开 `apps/web-overlay/next.config.js` 的 `ignoreBuildErrors`：
 * 该目录当前有 **21553** 个既有类型错误（`plugin-url-health-panel.tsx` 单文件 618 个），
 * 一次打开必然全红，团队只能再关回去 —— 门禁变成摆设。
 *
 * 这里的做法是「按目录增量收敛」的第一步：只对**已经清零的模块**断言 0 错误。
 * 新增文件想进这个清单，前提是它自己先做到 0 错误；已列入的文件一旦退化，立刻红。
 *
 * 为什么排除 `app/api/**`：overlay 目录没有自己的 `node_modules`（pnpm workspace 显式
 * 排除），`next/server` 解析不到，所有 route 都会报 TS2307。那是环境问题不是代码问题，
 * 纳入只会让门禁永远红。route 的类型由 `apps/web` 侧构建时的 tsc 兜住。
 *
 * 用法：
 *   node scripts/typecheck-video-scope.mjs
 *   node scripts/typecheck-video-scope.mjs --list   # 只打印清单
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OVERLAY = join(ROOT, 'apps', 'web-overlay')
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

/**
 * 已清零的模块。加新条目时必须先确认它本身 0 错误 ——
 * 把有错的文件塞进来，这个门禁就失去了「只减不增」的意义。
 */
const SCOPE = [
  'src/types/navigation.ts',
  'src/lib/video-scoring.ts',
  'src/lib/video-identity.ts',
  'src/lib/video-harvest-metrics.ts',
  'src/lib/video-harvester.ts',
  'src/lib/video-task-queue.ts',
  'src/lib/video-deadlink-sweeper.ts',
  'src/lib/video-trending-harvester.ts',
  'src/lib/video-autonomous-ai-harvester.ts',
  'src/lib/video-quiz-generator.ts',
  'src/lib/video-ai-summary.ts',
  'src/lib/video-multi-source-connector.ts',
  'src/lib/webhook-signature.ts',
  'src/lib/webhook-notifier.ts',
  'src/lib/cron-auth.ts',
  'src/lib/bilibili-wbi.ts',
]

if (process.argv.includes('--list')) {
  for (const rel of SCOPE) console.log(rel)
  process.exit(0)
}

if (!existsSync(TSC)) {
  console.error('[typecheck-video] 未找到 typescript，请先安装依赖')
  process.exit(1)
}

/** 环境性错误：overlay 无 node_modules 导致 next/* 解析不到，与代码质量无关 */
const ENV_NOISE = /Cannot find module 'next(\/[^']*)?'/

let output = ''
try {
  output = execFileSync(process.execPath, [TSC, '-p', join(OVERLAY, 'tsconfig.json'), '--noEmit'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (err) {
  // tsc 有错误时以非零退出，错误内容在 stdout/stderr 里
  output = `${err.stdout ?? ''}${err.stderr ?? ''}`
}

const lines = output.split(/\r?\n/).filter(line => line.includes('error TS'))

const inScope = lines.filter(line => {
  if (ENV_NOISE.test(line)) return false
  return SCOPE.some(rel => line.includes(rel.replace(/\//g, '/')))
})

if (inScope.length > 0) {
  console.error(`[typecheck-video] ${inScope.length} 处类型错误（作用域内 ${SCOPE.length} 个文件）：`)
  for (const line of inScope) console.error('  ' + line)
  console.error('\n修复后重跑。若确认是既有债务，先从清单里移除该文件并说明原因，不要放宽判定。')
  process.exit(1)
}

console.log(`[typecheck-video] OK：${SCOPE.length} 个模块 0 类型错误（已排除 next/* 环境性报错）`)
