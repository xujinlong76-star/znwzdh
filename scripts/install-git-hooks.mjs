/**
 * 自动安装 Git 本地钩子 (Pre-commit Hook)
 *
 * 功用：在提交前自动拦截 web-overlay 未同步与扩展配置错误，避免污染 CI。
 */

import { writeFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

const gitHooksDir = join(process.cwd(), '.git', 'hooks')

if (!existsSync(gitHooksDir)) {
  console.log('未检测到 .git/hooks 目录，跳过 Git 钩子安装。')
  process.exit(0)
}

const preCommitPath = join(gitHooksDir, 'pre-commit')
// 提交前门禁（升级建议：把 CI 里已有的检查尽可能左移）：
//   1) 覆盖层对齐（严格）+ 扩展规范 + 上游 ref 一致性：秒级
//   2) 类型门禁：@navhub/* 的 tsc --noEmit（前端走 CI 的 test-web，避免本地几十秒）
//   3) 变更相关测试：vitest run --changed（只跑受本次改动影响的用例）
// 提交变慢时可临时跳过：NAVHUB_SKIP_PRECOMMIT=1 git commit ...（或 --no-verify，但请别滥用）
const script = `#!/bin/sh
# NavHub Pre-commit Hook
# 自动校验覆盖层对齐、扩展规范、上游 ref、类型与变更相关测试

if [ "$NAVHUB_SKIP_PRECOMMIT" = "1" ]; then
  echo "[pre-commit] NAVHUB_SKIP_PRECOMMIT=1，跳过全部检查"
  exit 0
fi

node scripts/check-web-overlay.mjs || exit 1
node scripts/check-extensions.mjs || exit 1
node scripts/check-upstream-ref.mjs || exit 1

pnpm -r --filter "@navhub/*" exec tsc --noEmit || exit 1
npx vitest run --changed --passWithNoTests || exit 1
`

writeFileSync(preCommitPath, script, { encoding: 'utf-8', mode: 0o755 })
try {
  chmodSync(preCommitPath, 0o755)
} catch {
  // Windows 上可能不支持 chmod，忽略
}

console.log('✅ Git pre-commit hook 安装成功 (.git/hooks/pre-commit)')
