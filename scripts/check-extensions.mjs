/**
 * 浏览器与桌面扩展规范性校验工具 (CI 门禁与 pre-commit 验证)
 *
 * 验证对象：
 * 1. extensions/chrome-extension (Chrome Manifest V3 规范、资源存在性与 JS 语法)
 * 2. extensions/raycast-extension (Raycast Package 规范、命令与入口文件存在性)
 */

import { readFileSync, existsSync } from 'node:fs'
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

if (errors > 0) {
  console.error(`\n❌ [extensions-check] 校验失败，共发现 ${errors} 处异常。`)
  process.exit(1)
} else {
  console.log('\n✨ [extensions-check] 全部扩展规范性检查 100% 通过！')
  process.exit(0)
}
