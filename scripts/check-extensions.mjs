/**
 * 浏览器与桌面扩展规范性校验工具 (CI 门禁与 pre-commit 验证)
 *
 * 验证对象：
 * 1. extensions/chrome-extension (Chrome Manifest V3 规范、资源存在性与 JS 语法)
 * 2. extensions/raycast-extension (Raycast Package 规范、命令与入口文件存在性)
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()
let errors = 0

function logError(msg) {
  console.error('❌ [extensions-check] ' + msg)
  errors++
}

function logOk(msg) {
  console.log('✅ [extensions-check] ' + msg)
}

// ---- 1. Chrome Extension 校验 ----
const chromeDir = join(ROOT, 'extensions', 'chrome-extension')
const chromeManifestPath = join(chromeDir, 'manifest.json')

if (!existsSync(chromeManifestPath)) {
  logError('Chrome 扩展 manifest.json 不存在: ' + chromeManifestPath)
} else {
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
      // 语法合法性检验
      try {
        execSync(`node --check "${join(chromeDir, sw)}"`, { stdio: 'pipe' })
      } catch (err) {
        logError('Chrome service_worker 语法检查失败: ' + err.message)
      }
    }

    // 检查 popup
    const popup = manifest.action?.default_popup
    if (!popup || !existsSync(join(chromeDir, popup))) {
      logError('Chrome default_popup 文件缺失: ' + popup)
    }

    // 检查 popup.js 语法
    const popupJs = join(chromeDir, 'popup.js')
    if (existsSync(popupJs)) {
      try {
        execSync(`node --check "${popupJs}"`, { stdio: 'pipe' })
      } catch (err) {
        logError('Chrome popup.js 语法检查失败: ' + err.message)
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

    logOk('Chrome 扩展 (Manifest V3) 静态资源与语法校验通过')
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

    logOk('Raycast 扩展结构与命令入口校验通过')
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
