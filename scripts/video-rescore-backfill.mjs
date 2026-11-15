#!/usr/bin/env node
/**
 * 视频库全量重算回填 CLI。
 *
 * 只对导出的 JSON（备份 / 库导出）跑 `calculateQualityScore` 重算，
 * 从不直接读写在线库、不碰正在被清空的库。
 *
 * 用法：
 *   # 只验证分布，不写文件（默认）
 *   node scripts/video-rescore-backfill.mjs --input <backup.json>
 *
 *   # 写出重算后的副本（绝不覆盖输入文件；--output 与 --input 相同会直接拒绝）
 *   node scripts/video-rescore-backfill.mjs --input <backup.json> --output <rescored.json>
 *
 *   # 重采后对新库导出跑同一遍
 *   node scripts/video-rescore-backfill.mjs --input <new-export.json> --output <new-rescored.json>
 *
 *   # 把完整报告（含逐条 diff）另存为 JSON
 *   node scripts/video-rescore-backfill.mjs --input <backup.json> --report <report.json>
 *
 * 便捷入口：pnpm video:rescore -- --input <backup.json> --output <rescored.json>
 *
 * 输入格式：备份 JSON（{ navigationItems, replacementHistory? }）或裸数组。
 * 输出格式：与输入同形，只替换 navigationItems 里的两个分数；replacementHistory 原样透传。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

/**
 * 用 esbuild 把纯 TS 的回填模块打成临时 ESM 再导入：
 * Node 原生类型剥离不解析无扩展名的相对导入（./video-scoring），
 * 而改写源码加 `.ts` 扩展名会踩 tsconfig 的 allowImportingTsExtensions，
 * 打包一次是最稳的办法。临时目录用完即删。
 */
async function loadRescoreModule() {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workdir = mkdtempSync(join(tmpdir(), 'video-rescore-'))
  try {
    const outfile = join(workdir, 'video-rescore.bundle.mjs')
    await build({
      entryPoints: [join(rootDir, 'apps/web-overlay/src/lib/video-rescore.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile,
      logLevel: 'silent',
    })
    return await import(pathToFileURL(outfile).href)
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

function usage() {
  console.error(
    '用法: node scripts/video-rescore-backfill.mjs --input <backup.json> [--output <rescored.json>] [--report <report.json>] [--half-life-days 90]'
  )
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--input' || a === '--output' || a === '--report' || a === '--half-life-days') {
      args[a.slice(2)] = argv[++i]
    } else if (a === '--help' || a === '-h') {
      usage()
      process.exit(0)
    } else {
      console.error(`[rescore] 未知参数: ${a}`)
      usage()
      process.exit(1)
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.input) {
    console.error('[rescore] 缺少 --input')
    usage()
    process.exit(1)
  }
  const inputPath = resolve(args.input)
  const outputPath = args.output ? resolve(args.output) : null
  if (outputPath && outputPath === inputPath) {
    console.error('[rescore] 拒绝覆盖输入文件：--output 必须与 --input 不同')
    process.exit(1)
  }
  const halfLifeDays = args['half-life-days'] ? Number(args['half-life-days']) : 90
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
    console.error(`[rescore] --half-life-days 非法: ${args['half-life-days']}`)
    process.exit(1)
  }

  const raw = JSON.parse(readFileSync(inputPath, 'utf-8'))
  const isBareArray = Array.isArray(raw)
  const navigationItems = isBareArray ? raw : raw.navigationItems
  if (!Array.isArray(navigationItems)) {
    console.error('[rescore] 输入 JSON 里没有找到 navigationItems 数组')
    process.exit(1)
  }

  const { rescoreNavigationItems } = await loadRescoreModule()
  const { items, report } = rescoreNavigationItems(navigationItems, { halfLifeDays })

  if (outputPath) {
    const out = isBareArray ? items : { ...raw, navigationItems: items }
    writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n', 'utf-8')
    console.log(`[rescore] 已写出重算副本: ${outputPath}`)
  } else {
    console.log('[rescore] 干跑模式：未写任何文件（传 --output 写出重算副本）')
  }
  if (args.report) {
    writeFileSync(resolve(args.report), JSON.stringify(report, null, 2) + '\n', 'utf-8')
    console.log(`[rescore] 报告已保存: ${resolve(args.report)}`)
  }

  const b = report.qualityBefore
  const a = report.qualityAfter
  const modeShare = (d) =>
    d.mode ? `${d.mode.value} 分 × ${d.mode.count} 条 (${((d.mode.count / d.count) * 100).toFixed(1)}%)` : '—'
  console.log(`[rescore] 共 ${report.total} 条：重算 ${report.rescored} 条，分数变化 ${report.changed} 条，未变 ${report.unchanged} 条，无统计数据 ${report.missingStats} 条`)
  console.log(`[rescore] 重算前：中位数 ${b.median}，均值 ${b.mean}，p10 ${b.p10} / p90 ${b.p90}，众数 ${modeShare(b)}；过 60 分 ${b.passAt60} 条，过 65 分 ${b.passAt65} 条`)
  console.log(`[rescore] 重算后：中位数 ${a.median}，均值 ${a.mean}，p10 ${a.p10} / p90 ${a.p90}，众数 ${modeShare(a)}；过 60 分 ${a.passAt60} 条，过 65 分 ${a.passAt65} 条`)
  if (b.mode && b.mode.count / Math.max(1, b.count) > 0.5) {
    console.log(`[rescore] 注意：重算前 ${((b.mode.count / b.count) * 100).toFixed(1)}% 的分数扎堆在 ${b.mode.value} 分 —— 垫高遗迹`)
  }
}

main()
