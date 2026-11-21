#!/usr/bin/env node
/**
 * 根目录卫生门禁（2026-11-21 保洁）。
 *
 * 背景：一轮首屏调优之后，仓库根目录堆了 38 个一次性脚本
 * （diag-*.mjs / measure-*.mjs / verify-*.mjs / shot-*.mjs / probe-*.mjs）
 * 和 4 份 codeql-*-notes.md，全部被误提交进版本库。根目录是项目的「门面」，
 * 不该出现一次性产物——既干扰阅读，也让真正的入口文件（package.json、
 * README、配置文件）难以辨认。
 *
 * 本门禁检查**已被 git 跟踪的**根目录文件，命中下面任一模式即报错：
 *   - 一次性探针脚本：diag-*.mjs / measure-*.mjs / verify-*.mjs /
 *     shot-*.mjs / probe-*.mjs
 *   - 过程笔记：*-notes.md（审计结论应进 docs/audits/）
 *   - 验证据目录：verify-evidence/、*-evidence/
 *
 * 只检查根目录**第一层**：scripts/、docs/、e2e/ 下的同名文件不受影响
 * （scripts/perf/first-screen.mjs 是长期探针，正是允许的位置）。
 *
 * 用法：
 *   node scripts/check-root-hygiene.mjs            # 报告
 *   node scripts/check-root-hygiene.mjs --strict   # 有违规即退出码 1（CI 用）
 */

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

/** 根目录禁止出现的文件名模式（只匹配第一层）。 */
export const FORBIDDEN_ROOT_PATTERNS = [
  { re: /^(diag|measure|verify|shot|probe)-.+.(mjs|mts|cjs|js)$/, why: '一次性探针脚本' },
  { re: /-notes\.md$/, why: '过程笔记（审计结论请放 docs/audits/）' },
  { re: /^verify-evidence$/, why: '验证据目录' },
  { re: /-evidence$/, why: '验证据目录' },
]

/**
 * 判定一个根目录文件名是否违规。
 * 返回 `{ forbidden: true, why }` 或 `{ forbidden: false }`。
 */
export function classifyRootEntry(name) {
  for (const { re, why } of FORBIDDEN_ROOT_PATTERNS) {
    if (re.test(name)) return { forbidden: true, why }
  }
  return { forbidden: false }
}

/** 列出被 git 跟踪的根目录条目（名字，不含子目录内部文件）。 */
function trackedRootEntries() {
  const raw = execFileSync('git', ['ls-files', '-z', '--', ':/*'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const names = new Set()
  for (const line of raw.split('\0')) {
    if (!line) continue
    const slash = line.indexOf('/')
    // 只保留第一层；子目录内部文件不计入根目录卫生
    names.add(slash === -1 ? line : line.slice(0, slash))
  }
  return [...names].sort()
}

function main(argv) {
  const strict = argv.includes('--strict')
  const entries = trackedRootEntries()
  const violations = entries
    .map((name) => ({ name, ...classifyRootEntry(name) }))
    .filter((e) => e.forbidden)

  console.log('='.repeat(62))
  console.log(`[check-root-hygiene] 根目录已跟踪条目 ${entries.length} 个`)
  if (violations.length === 0) {
    console.log('  ✅ 无临时探针 / 过程笔记残留')
  } else {
    console.log(`  ❌ 发现 ${violations.length} 处违规：`)
    for (const v of violations) console.log(`     ${v.name}  —— ${v.why}`)
    console.log('\n  处理方式：')
    console.log('   • 长期探针 → 移到 scripts/perf/ 并在 package.json 登记')
    console.log('   • 审计笔记 → 合并进 docs/audits/')
    console.log('   • 一次性产物 → git rm 删除')
  }
  console.log('='.repeat(62))

  if (strict && violations.length > 0) {
    console.error(`[check-root-hygiene] --strict：${violations.length} 处根目录违规`)
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('check-root-hygiene.mjs')) {
  main(process.argv.slice(2))
}
