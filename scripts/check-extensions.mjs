/**
 * 浏览器与桌面扩展规范性校验工具 (CI 门禁与 pre-commit 验证)
 *
 * 验证对象：
 * 1. extensions/chrome-extension (Chrome Manifest V3 规范、资源存在性与 JS 语法)
 * 2. extensions/raycast-extension (Raycast Package 规范、命令与入口文件存在性)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.cwd()
let errors = 0

function logError(msg) {
  console.error('❌ [extensions-check] ' + msg)
  errors++
}

function logOk(msg) {
  console.log('✅ [extensions-check] ' + msg)
}

/**
 * `node --check <file>`：走 execFileSync 而不是 execSync 的字符串命令。
 * execSync 在 Windows 上把路径拼进 cmd.exe 命令行，`%`、`&`、`"` 都会被 shell
 * 二次解释；execFileSync 直接 execve，参数不进 shell。
 * 失败时把 stderr 一起打出来：`err.message` 只有「Command failed」，
 * 门禁红了却看不到是哪一行语法错，等于逼人手跑一次。
 */
function checkSyntax(file, label) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    return true
  } catch (err) {
    const detail = String(err.stderr ?? err.message ?? '').trim().split('\n').slice(0, 6).join('\n')
    logError(`${label} 语法检查失败: ${file}\n${detail}`)
    return false
  }
}

// ---- 1. Chrome Extension 校验 ----
const chromeDir = join(ROOT, 'extensions', 'chrome-extension')
const chromeManifestPath = join(chromeDir, 'manifest.json')

if (!existsSync(chromeManifestPath)) {
  logError('Chrome 扩展 manifest.json 不存在: ' + chromeManifestPath)
} else {
  // 段内错误计数：以前 ✅ 是无条件打印的，同一节里报了 10 个 ❌ 后面照样跟一句「校验通过」，
  // 读 CI 日志的人只看最后一行就会误判为绿灯。
  const errorsBefore = errors
  try {
    const raw = readFileSync(chromeManifestPath, 'utf-8')
    const manifest = JSON.parse(raw)

    if (manifest.manifest_version !== 3) {
      logError('Chrome 扩展必须使用 Manifest V3 (当前: ' + manifest.manifest_version + ')')
    }
    if (!manifest.name || !manifest.version) {
      logError('Chrome 扩展 manifest.json 缺少 name 或 version 字段')
    }

    // 检查 background service worker
    const sw = manifest.background?.service_worker
    if (!sw || !existsSync(join(chromeDir, sw))) {
      logError('Chrome service_worker 文件缺失: ' + sw)
    } else {
      checkSyntax(join(chromeDir, sw), 'Chrome service_worker')
    }

    // 检查 popup
    const popup = manifest.action?.default_popup
    if (!popup || !existsSync(join(chromeDir, popup))) {
      logError('Chrome default_popup 文件缺失: ' + popup)
    }

    // 检查 popup.js 语法
    const popupJs = join(chromeDir, 'popup.js')
    if (existsSync(popupJs)) checkSyntax(popupJs, 'Chrome popup.js')

    // 安全守卫（2026-11-06 深扫 S-5）：Bearer token 不得发往用户可配的任意 apiUrl。
    // manifest 必须有 host_permissions；两个 JS 入口都必须经过 safeApiUrl / isTrustedApiUrl
    // 校验，而不是直接返回 chrome.storage.local["apiUrl"]。
    if (!Array.isArray(manifest.host_permissions) || manifest.host_permissions.length === 0) {
      logError('Chrome 扩展缺少 host_permissions：Bearer token 可能被发往任意主机')
    }
    for (const [file, label] of [[join(chromeDir, 'background.js'), 'background.js'], [popupJs, 'popup.js']]) {
      if (!existsSync(file)) continue
      const src = readFileSync(file, 'utf-8')
      if (!src.includes('function isTrustedApiUrl')) {
        logError(`${label} 缺少 isTrustedApiUrl 白名单校验（apiUrl 可被改成攻击者服务器）`)
      }
      if (!/getApi(?:Url|Base)\(\)[\s\S]{0,300}safeApiUrl\(/.test(src)) {
        logError(`${label} 的 getApiUrl/getApiBase 未经过 safeApiUrl，Bearer 可能外泄`)
      }
    }

    // 检查图标
    if (manifest.icons && typeof manifest.icons === 'object') {
      for (const [size, iconPath] of Object.entries(manifest.icons)) {
        if (!existsSync(join(chromeDir, iconPath))) {
          logError(`Chrome 图标文件不存在 (${size}px): ${iconPath}`)
        }
      }
    }

    if (errors === errorsBefore) logOk('Chrome 扩展 (Manifest V3) 静态资源与语法校验通过')
  } catch (err) {
    logError('Chrome manifest.json JSON 解析失败: ' + err.message)
  }
}

// ---- 2. Raycast Extension 校验 ----
const raycastDir = join(ROOT, 'extensions', 'raycast-extension')
const raycastPkgPath = join(raycastDir, 'package.json')

if (!existsSync(raycastPkgPath)) {
  logError('Raycast 扩展 package.json 不存在: ' + raycastPkgPath)
} else {
  const errorsBefore = errors
  try {
    const raw = readFileSync(raycastPkgPath, 'utf-8')
    const pkg = JSON.parse(raw)

    if (!pkg.name || !pkg.title) {
      logError('Raycast 扩展缺少 name 或 title 字段')
    }

    // 检查图标
    if (pkg.icon && !existsSync(join(raycastDir, pkg.icon))) {
      logError('Raycast 扩展图标不存在: ' + pkg.icon)
    }

    // 检查 commands
    if (!Array.isArray(pkg.commands) || pkg.commands.length === 0) {
      logError('Raycast 扩展缺少 commands 配置')
    } else {
      for (const cmd of pkg.commands) {
        const tsxFile = join(raycastDir, 'src', `${cmd.name}.tsx`)
        const tsFile = join(raycastDir, 'src', `${cmd.name}.ts`)
        if (!existsSync(tsxFile) && !existsSync(tsFile)) {
          logError(`Raycast 命令入口文件缺失: src/${cmd.name}.tsx`)
        }
      }
    }

    if (errors === errorsBefore) logOk('Raycast 扩展结构与命令入口校验通过')
  } catch (err) {
    logError('Raycast package.json JSON 解析失败: ' + err.message)
  }
}

// ---- 3. 搜索请求必须携带凭据（源码级钉子） ----
// 搜索行为事件（events.search / zero_result）按请求身份归属，服务端走
// requestIdentityOf 从 Authorization 取令牌。扩展的搜索请求一旦丢掉这个头，
// 不会报错、建议列表照常显示 —— 只是所有扩展用户的搜索行为静默变成匿名，
// 「删除全部个人数据 / 导出」再也圈不到它们。这类回归没有运行时信号，
// 只能钉源码：每个 /api/search? 请求的 fetch 选项窗口里必须能读到 Authorization。
const SEARCH_CREDENTIAL_FILES = [
  { file: join(chromeDir, 'background.js'), label: 'Chrome background.js' },
  { file: join(chromeDir, 'popup.js'), label: 'Chrome popup.js' },
]
{
  const errorsBefore = errors
  for (const { file, label } of SEARCH_CREDENTIAL_FILES) {
    if (!existsSync(file)) {
      logError(`${label} 不存在，无法校验搜索凭据`)
      continue
    }
    const source = readFileSync(file, 'utf-8')
    const matches = [...source.matchAll(/\/api\/search\?/g)]
    if (matches.length === 0) {
      logError(`${label} 里找不到 /api/search 请求（搜索入口被删或换了端点？）`)
      continue
    }
    for (const match of matches) {
      // 只认 fetch 选项窗口内的 Authorization：同文件其他请求（收藏/投稿）带的头不算
      const options = source.slice(match.index, match.index + 400)
      if (!/Authorization/.test(options)) {
        const line = source.slice(0, match.index).split('\n').length
        logError(`${label}:${line} 的 /api/search 请求没有携带 Authorization —— 搜索行为会静默退化成匿名`)
      }
    }
  }
  if (errors === errorsBefore) logOk('Chrome 扩展搜索请求凭据校验通过')
}

// ---- 4. API 契约：扩展调用的每个 /api/* 都必须在后端有路由声明 ----
// 扩展是**直连** Fastify 的（默认 http://127.0.0.1:8787）。后端把某条路由改名/下线时，
// 扩展里手写的 URL 不会红——只会在用户点击时静默失效（这类回归没有编译期信号）。
// 这里把「扩展用到的端点」纳入门禁：在 apps/api/src/routes/**.ts 里找不到对应模板即判红
// （含拆分后的 routes/plugins/p1..p5.ts）。动态段取前缀匹配：`/api/plugins/` 可匹配
// `/api/plugins/:slug/install`。
{
  const errorsBefore = errors
  const collect = (dir, re) => {
    const out = []
    if (!existsSync(dir)) return out
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (re.test(entry.name)) out.push(p)
      }
    }
    walk(dir)
    return out
  }

  const templates = []
  for (const f of collect(join(ROOT, 'apps/api/src/routes'), /\.ts$/)) {
    const src = readFileSync(f, 'utf-8')
    for (const m of src.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
      if (m[1].startsWith('/api/')) templates.push(m[1])
    }
  }
  if (templates.length === 0) logError('后端路由里没扫到任何 /api/* 声明（路由目录结构变了？）')

  const used = new Set()
  for (const f of collect(join(ROOT, 'extensions'), /\.(js|ts|tsx|json|html)$/)) {
    const src = readFileSync(f, 'utf-8')
    for (const m of src.matchAll(/\/api\/[A-Za-z0-9/_:-]*/g)) {
      const p = m[0].replace(/[.,;)'"`]+$/, '')
      if (p.length > '/api/'.length) used.add(p)
    }
  }

  const templateToRe = (tpl) =>
    new RegExp('^' + tpl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+') + '$')
  for (const p of [...used].sort()) {
    const ok = p.endsWith('/')
      ? templates.some((t) => t.startsWith(p))
      : templates.some((t) => templateToRe(t).test(p))
    if (!ok) logError(`扩展调用的端点在后端没有对应声明：${p}（后端改名/下线后扩展会静默失效）`)
  }
  if (errors === errorsBefore) {
    logOk(`扩展 API 契约校验通过（${used.size} 个端点全部有后端声明；后端 ${templates.length} 条 /api/* 路由）`)
  }
}

if (errors > 0) {
  console.error(`\n❌ [extensions-check] 校验失败，共发现 ${errors} 处异常。`)
  process.exit(1)
} else {
  console.log('\n✨ [extensions-check] 全部扩展规范性检查 100% 通过！')
  process.exit(0)
}
