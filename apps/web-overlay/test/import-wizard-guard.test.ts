import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 第 2 批第 11 项「导入向导补完」守卫测试。
 *
 * 大多是源码级断言：向导是纯客户端组件（node 环境、无 jsdom），
 * 行为级覆盖在 import-dedup-report.test.ts；这里钉住的是
 * “绝不能悄悄变回去”的诚实性红线：上限、取消、撤销、数字同源、无假功能。
 */

const IMPORTER = readFileSync(
  fileURLToPath(new URL('../src/components/bookmark-importer.tsx', import.meta.url)),
  'utf8',
)
const HOOK = readFileSync(
  fileURLToPath(new URL('../src/hooks/useFavorites.ts', import.meta.url)),
  'utf8',
)
const REPORT = readFileSync(
  fileURLToPath(new URL('../src/lib/import-dedup-report.ts', import.meta.url)),
  'utf8',
)
const UNDO = readFileSync(
  fileURLToPath(new URL('../src/lib/undo-stack.ts', import.meta.url)),
  'utf8',
)
const PARSER = readFileSync(
  fileURLToPath(new URL('../src/lib/favorites-export-import.ts', import.meta.url)),
  'utf8',
)

/** 只留代码，注释里的提及不算命中 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const CODE = codeOnly(IMPORTER)

describe('向导步骤机与无障碍', () => {
  it('4 步步骤条存在，当前步 aria-current="step"，不可点击跳步前进', () => {
    expect(IMPORTER).toContain('WIZARD_STEPS')
    expect(IMPORTER).toContain("aria-current={current ? 'step' : undefined}")
    expect(IMPORTER).toContain('aria-disabled={!current}')
    // 只有已完成的步骤是按钮（可回退），未来步骤是纯文本
    expect(IMPORTER).toContain('回到第 ${s} 步')
  })

  // 第 3 批第 1 项取代了本批「不加 CSV」的决定：Reddit / GitHub 的导出就是 CSV，
  // 但 .csv / .js 只许出现在社交来源分支，浏览器书签仍只认原来的 4 种格式。
  it('Step 1 的 .csv / .js 只在社交来源出现：浏览器书签仍只认 4 种格式', () => {
    expect(IMPORTER).toContain("accept={sourceKind === 'social' ? '.html,.htm,.md,.json,.txt,.csv,.js' : '.html,.htm,.md,.json,.txt'}")
    expect(IMPORTER).toContain("'.html,.htm,.md,.json,.txt'")
    expect(IMPORTER).toContain("'.html,.htm,.md,.json,.txt,.csv,.js'")
  })

  it('Step 2 只读、Step 3 可编辑：预览态勾选框被禁用', () => {
    expect(IMPORTER).toContain('disabled={step === 2 || mode === \'public\'}')
    expect(IMPORTER).toContain('disabled={step === 2 || b.publicLocked || mode === \'private\'}')
  })
})

describe('上限与超限诚实', () => {
  it('文件超 10 MB 在 Step 1 硬拦：读文件前查 size，不读文件', () => {
    expect(IMPORTER).toContain('file.size > IMPORT_MAX_FILE_BYTES')
    expect(IMPORTER).toContain('文件超过 10 MB 上限')
    expect(REPORT).toContain('IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024')
    expect(REPORT).toContain('IMPORT_MAX_ITEMS = 5000')
  })

  it('超限 totalMatched 必须是真实命中总数，拿不到就写“可能还有更多”，不许编数字', () => {
    expect(IMPORTER).toContain('条上限，文件可能还有更多')
    expect(IMPORTER).toContain('文件共约 ${parseMeta.totalMatched} 条链接')
    expect(PARSER).toContain('totalMatched')
    expect(PARSER).toContain('truncated')
  })

  it('预览分页每页 50 条固定', () => {
    expect(IMPORTER).toContain('IMPORT_PREVIEW_PAGE_SIZE')
    expect(IMPORTER).toContain('每页 50 条')
    expect(REPORT).toContain('IMPORT_PREVIEW_PAGE_SIZE = 50')
  })

  it('个人收藏写入每 100 条一次 importJson，chunk 间让出主线程', () => {
    expect(IMPORTER).toContain('IMPORT_PRIVATE_CHUNK_SIZE')
    expect(IMPORTER).toContain('requestAnimationFrame')
    expect(REPORT).toContain('IMPORT_PRIVATE_CHUNK_SIZE = 100')
  })
})

describe('数字同源：报告、确认文案、汇总页同一份来源', () => {
  it('执行读冻结清单：handleImport 先 freezeExecutionPlan 再执行', () => {
    expect(IMPORTER).toContain('freezeExecutionPlan(dedupReport)')
    expect(IMPORTER).toContain('executeImport(plan, skipped)')
    // 确认文案的数字来自同一份 plan，不另算
    expect(IMPORTER).toContain('confirmPlan.privateCount')
    expect(IMPORTER).toContain('confirmPlan.publicCount')
  })

  it('不存在第二处独立计数逻辑：imported 不许再拿 valid.length 冒充新增', () => {
    expect(HOOK).not.toContain('imported: valid.length')
    expect(HOOK).toContain('return { ok: true, imported, updated, alreadyExisted, addedSiteIds, skippedInvalid: skippedInvalid + extraSkippedInvalid }')
  })

  it('importJson 合并键是指纹，不是 siteId', () => {
    expect(HOOK).toContain('fingerprintUrl(ex.href)')
    expect(HOOK).toContain('byFingerprint')
    expect(HOOK).toContain('alreadyExisted')
    expect(HOOK).toContain('addedSiteIds')
  })

  it('三处只 import fingerprintUrl，不各写一份归一化', () => {
    expect(PARSER).toContain("import { fingerprintUrl } from './import-workbench'")
    expect(REPORT).toContain("import { fingerprintUrl, inspectPrivacy } from './import-workbench'")
    // 解析层不再用 sanitize 结果做比对键
    expect(PARSER).not.toContain('seenUrls')
  })
})

describe('取消诚实', () => {
  it('取消只在 chunk 边界生效，汇总写“已取消，未导入”，不说“导入完成”', () => {
    expect(IMPORTER).toContain('cancelRequestedRef')
    expect(IMPORTER).toContain('已取消，未导入')
    expect(IMPORTER).toContain('停在 chunk 边界')
    expect(IMPORTER).toContain('导入已取消')
  })

  it('部分失败停在该 chunk，给“重试剩余”与“下载剩余清单”', () => {
    expect(IMPORTER).toContain('重试剩余')
    expect(IMPORTER).toContain('下载剩余清单')
    expect(IMPORTER).toContain('retryRemaining')
  })
})

describe('撤销诚实', () => {
  it('UndoableKind 有 favorite.import-batch，撤销删同一批 addedSiteIds', () => {
    expect(UNDO).toContain("'favorite.import-batch'")
    expect(IMPORTER).toContain("kind: 'favorite.import-batch'")
    expect(IMPORTER).toContain('snapshotAndRemoveLocal(addedSiteIds')
  })

  it('汇总页分开写：个人收藏可撤销，公共库已提交不可撤销', () => {
    expect(IMPORTER).toContain('条可撤销；公共库')
    expect(IMPORTER).toContain('条已提交，不可撤销')
  })

  it('汇总页持久撤销按钮文案点名 30 天回收站', () => {
    expect(IMPORTER).toContain('删除本次导入的 ${addedCount} 条（可在回收站找回 30 天）')
    expect(IMPORTER).toContain('撤销本次导入')
  })
})

describe('汇总页诚实', () => {
  it('全部跳过时不说“导入完成”，说“没有新增内容：N 条均已存在”', () => {
    expect(IMPORTER).toContain('没有新增内容：')
    expect(IMPORTER).toContain('条均已存在')
  })

  it('B-2：汇总跳过数从冻结 plan / 报告派生，isAllSkippedSummary 真正被汇总页用', () => {
    // 跳过 = totalParsed - totalSelected，不许再拿 writePrivate 的 alreadyExisted（恒为 0）
    expect(IMPORTER).toContain('isAllSkippedSummary(importResult.plan')
    expect(IMPORTER).toContain('collectSkippedItems(dedupReport)')
    expect(IMPORTER).toContain('skippedCount: skipped?.skippedCount')
    expect(IMPORTER).not.toContain('跳过（已存在）{importResult.privateAlreadyExisted}')
  })

  it('B-2：0 选中也能进 Step 4 看全跳过汇总（下一步按钮不再因 0 选中禁用）', () => {
    expect(IMPORTER).not.toContain('disabled={counts.privateSelected + counts.publicSelected === 0}')
    expect(IMPORTER).toContain('下一步：查看全跳过汇总')
    expect(IMPORTER).toContain('查看汇总（没有新增内容）')
  })

  it('B-3：解析器被丢的重复条进 droppedDuplicates，stage 对原始命中清单建报告', () => {
    expect(PARSER).toContain('droppedDuplicates')
    expect(IMPORTER).toContain('droppedDuplicates')
    expect(IMPORTER).toContain('[...parsed, ...(dropped ?? [])]')
    // 旧注释声称“原始解析产物未做 href 去重”是错的：解析器先去重，报告靠 droppedDuplicates 补
    expect(IMPORTER).not.toContain('未做 href 去重')
    // 两处数字互不重叠：批内重复丢弃与解析跳过不再双算同一条
    expect(IMPORTER).toContain('批内重复丢弃 {parseMeta?.duplicates ?? 0} 条')
  })

  it('B-4：verdict 查询按条目 id 建键，dup 不许再按指纹覆盖保留条', () => {
    expect(IMPORTER).not.toContain('reportByFp')
    expect(IMPORTER).not.toContain('reportItemByFp')
    expect(IMPORTER).toContain('reportItemById')
    expect(IMPORTER).toContain('id: verdict.id')
    expect(IMPORTER).toContain('activeVariantForKept')
    expect(IMPORTER).toContain('改用这一条')
  })

  it('B-5：importJson 检查 persist 返回值，失败返回 ok:false；首 chunk 成功计数保留', () => {
    expect(HOOK).toContain('if (!persist(merged))')
    expect(HOOK).toContain("error: '本地存储不可用'")
    // writePrivate 停在失败 chunk：首 chunk 的 imported / updated / alreadyExisted 不许按 ok 清零
    expect(IMPORTER).toContain('privateImported: privateResult.imported,')
    expect(IMPORTER).toContain('privateUpdated: privateResult.updated,')
    expect(IMPORTER).not.toContain('privateResult.ok ? privateResult.imported : 0')
    // 已写入前缀可撤销：撤销推送条件不再要求 privateResult.ok
    expect(IMPORTER).not.toContain('(addedCount > 0 || updatedCount > 0) && privateResult.ok')
    expect(IMPORTER).toContain('if (addedCount > 0 || updatedCount > 0) {')
  })

  it('“查看导入结果”只跳 /favorites，不做假高亮', () => {
    expect(IMPORTER).toContain('查看导入结果')
    expect(CODE).not.toContain('已高亮')
    expect(CODE).not.toContain('highlight=')
  })

  it('2xx 读不出条数仍记未确认（沿用旧台账口径）', () => {
    expect(IMPORTER).toContain('unconfirmedCount += chunk.length')
    expect(IMPORTER).toContain('未能确认')
  })
})

describe('隐私红线与快照', () => {
  it('private-blocked 的公共投稿在任何步骤都不可勾选', () => {
    expect(REPORT).toContain("verdict === 'private-blocked'")
    expect(IMPORTER).toContain('publicLocked')
  })

  it('sessionStorage 只存指纹/标题/URL 级快照，不存文件原文；刷新后文件需重选，文案写明', () => {
    expect(IMPORTER).toContain('IMPORT_WIZARD_RESUME_KEY')
    expect(IMPORTER).toContain('文件原文未保存')
    expect(IMPORTER).not.toContain('sessionStorage.setItem(IMPORT_WIZARD_RESUME_KEY, JSON.stringify({ version: 1, mode, rawText')
  })
})
