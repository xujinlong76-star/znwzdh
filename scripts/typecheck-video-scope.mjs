#!/usr/bin/env node
/**
 * 视频模块的类型门禁（作用域化，但作用域内**自动发现**）。
 *
 * 为什么不能直接打开 `apps/web-overlay/next.config.js` 的 `ignoreBuildErrors`：
 * 该目录当前有 **21600+** 个既有类型错误（`plugin-url-health-panel.tsx` 单文件 618 个），
 * 一次打开必然全红，团队只能再关回去 —— 门禁变成摆设。
 *
 * 演进过程：
 *   1. 第一版是**手工清单**（16 个模块），只对「已经清零」的文件断言 0 错误；
 *   2. 第二版扩到 23 个；
 *   3. 现在是**自动发现**：`src/lib/video-*.ts` + `src/lib/webhook-*.ts` 全部纳入。
 *      理由是实测这 71 个文件已经全部 0 错误 —— 手工清单反而成了漏洞：
 *      上一版漏了 50 个，其中任何一个将来写坏都不会被拦。
 *
 * 自动发现带来的约束（这是特性不是副作用）：**新增一个 video-*.ts 就必须自身 0 错误**，
 * 否则门禁立刻红。想让它先带错误合进来，只能临时把文件放进 `SCOPE_EXEMPT` 并写明原因 ——
 * 那是一个需要 review 的动作，而不是「忘了加进清单」。
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
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OVERLAY = join(ROOT, 'apps', 'web-overlay')
const LIB = join(OVERLAY, 'src', 'lib')
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

/** 不属于 `video-*` / `webhook-*` 命名，但同属这条链路的显式条目 */
const SCOPE_EXTRA = [
  'src/types/navigation.ts',
  'src/lib/cron-auth.ts',
  'src/lib/bilibili-wbi.ts',
]

/**
 * 豁免清单：**只允许临时使用，必须写原因**。空数组是健康状态。
 * 加条目等于承认「这个文件可以带着类型错误存在」，属于需要评审的决定。
 */
const SCOPE_EXEMPT = []

if (!existsSync(LIB)) {
  console.error(`[typecheck-video] 找不到 ${LIB}，worktree 不完整？`)
  process.exit(1)
}

const discovered = readdirSync(LIB)
  .filter(name => /^(video|webhook)-[a-z0-9-]+\.ts$/.test(name))
  .sort()
  .map(name => `src/lib/${name}`)
  .filter(rel => !SCOPE_EXEMPT.includes(rel))

if (discovered.length === 0) {
  console.error('[typecheck-video] 自动发现结果为 0，路径规则或目录结构变了？拒绝静默通过。')
  process.exit(1)
}

const SCOPE = [...discovered, ...SCOPE_EXTRA]

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
  // `--incremental false` 是必需的：overlay 的 tsconfig 开着 `incremental` 且会写出
  // `apps/web-overlay/tsconfig.tsbuildinfo`。实测过同一个改动在**陈旧缓存**下会被判成
  // 「仍有 7 处错误」，而全量重算是 0 —— 门禁要么假红要么假绿，两种都不能接受。
  output = execFileSync(
    process.execPath,
    [TSC, '-p', join(OVERLAY, 'tsconfig.json'), '--noEmit', '--incremental', 'false'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    },
  )
} catch (err) {
  // tsc 有错误时以非零退出，错误内容在 stdout/stderr 里
  output = `${err.stdout ?? ''}${err.stderr ?? ''}`
}

const lines = output.split(/\r?\n/).filter(line => line.includes('error TS'))

const inScope = lines.filter(line => {
  if (ENV_NOISE.test(line)) return false
  return SCOPE.some(rel => line.includes(rel))
})

if (inScope.length > 0) {
  console.error(`[typecheck-video] ${inScope.length} 处类型错误（作用域内 ${SCOPE.length} 个文件）：`)
  for (const line of inScope) console.error('  ' + line)
  console.error(
    '\n修复后重跑。若确实是既有债务无法立刻修，把文件加进 SCOPE_EXEMPT 并写明原因 —— 不要放宽判定。',
  )
  process.exit(1)
}

const exemptNote = SCOPE_EXEMPT.length > 0 ? `，豁免 ${SCOPE_EXEMPT.length} 个` : ''
console.log(
  `[typecheck-video] OK：${SCOPE.length} 个模块 0 类型错误（自动发现 ${discovered.length} 个${exemptNote}；已排除 next/* 环境性报错）`,
)
