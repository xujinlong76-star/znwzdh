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
const script = `#!/bin/sh
# NavHub Pre-commit Hook
# 自动校验覆盖层对齐与扩展规范

node scripts/check-web-overlay.mjs || exit 1
node scripts/check-extensions.mjs || exit 1
`

writeFileSync(preCommitPath, script, { encoding: 'utf-8', mode: 0o755 })
try {
  chmodSync(preCommitPath, 0o755)
} catch {
  // Windows 上可能不支持 chmod，忽略
}

console.log('✅ Git pre-commit hook 安装成功 (.git/hooks/pre-commit)')
