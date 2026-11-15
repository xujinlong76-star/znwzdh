/**
 * 回收站页（app/favorites/trash/page.tsx）守卫型测试：
 *  - 入口齐全：恢复选中 / 恢复全部 / 清空回收站；
 *  - 彻底删除与清空回收站仍有确认（真正不可逆的操作不裸奔）；
 *  - 删除确认框文案里不再出现「删除后无法恢复」（stale/page 的旧文案必须改掉）；
 *  - 空态文案钉死。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const trashPage = overlaySource('src/app/favorites/trash/page.tsx')

describe('回收站页：入口齐全', () => {
  it('有搜索框（按标题/备注过滤）、全选、恢复选中 / 恢复全部 / 清空回收站', () => {
    expect(trashPage).toContain('恢复选中')
    expect(trashPage).toContain('恢复全部')
    expect(trashPage).toContain('清空回收站')
    expect(trashPage).toContain('全选')
    // 搜索按标题/备注过滤
    expect(trashPage).toMatch(/note|备注/)
    expect(trashPage).toContain('placeholder')
  })

  it('每行显示标题 / 原分类 / 删除时间 / 剩余天数，行内有「恢复」与「彻底删除」', () => {
    expect(trashPage).toContain('恢复')
    expect(trashPage).toContain('彻底删除')
    expect(trashPage).toContain('formatTrashRemaining')
    expect(trashPage).toContain('deletedAt')
    expect(trashPage).toContain('folderName')
  })

  it('空态：标题"回收站是空的"，说明"删除的收藏会在这里保留 30 天"', () => {
    expect(trashPage).toContain('回收站是空的')
    expect(trashPage).toContain('删除的收藏会在这里保留 30 天')
  })

  it('原站点已不存在的条目按钮置灰、不从回收站清掉', () => {
    expect(trashPage).toContain('原站点已不存在，无法恢复')
    expect(trashPage).toContain('siteGone')
  })

  it('原收藏夹已不存在时恢复到未分组并说清楚', () => {
    expect(trashPage).toContain('folderLost')
    expect(trashPage).toContain('原收藏夹已不存在，已恢复到未分组')
  })

  it('登录后以云端墓碑列表为准；本地多余条目只在有成功同步记录时丢弃并出提示', () => {
    expect(trashPage).toContain('readSyncStatus')
    expect(trashPage).toContain('仅本机')
  })
})

describe('回收站页：彻底删除仍有确认', () => {
  it('彻底删除与清空回收站保留 window.confirm（文案"彻底删除后无法恢复"）', () => {
    expect(trashPage).toContain('彻底删除后无法恢复')
    expect(trashPage).toContain('window.confirm')
  })
})

describe('旧文案清零：任何删除确认框里不再出现"删除后无法恢复"', () => {
  it('stale/page 的删除确认已去掉，文案改为"8 秒内可撤销，也可在回收站恢复"', () => {
    const stale = overlaySource('src/app/favorites/stale/page.tsx')
    expect(stale).not.toContain('删除后无法恢复')
    expect(stale).not.toContain("window.confirm('确定要删除收藏")
    expect(stale).toContain('8 秒内可撤销，也可在回收站恢复')
    expect(stale).toContain('已归档「')
    expect(stale).toContain('可在回收站恢复')
  })

  it('favorites/page 的批量删除确认已去掉（改为执行 + 8 秒条 + 回收站）', () => {
    const page = overlaySource('src/app/favorites/page.tsx')
    expect(page).not.toContain('确定要删除选中的')
    expect(page).toContain('🗑 回收站')
    expect(page).toContain('/favorites/trash')
    // 清空仍保留两步确认（D7），但确认后同样进撤销条 + 回收站
    expect(page).toContain('favorites.clear(')
    expect(page).toContain('restoreFolders')
  })

  it('撤销条上有"查看回收站"入口与统一副标题', () => {
    const bar = overlaySource('src/components/undo-bar.tsx')
    expect(bar).toContain('查看回收站')
    expect(bar).toContain('/favorites/trash')
    expect(bar).toContain('UNDO_SUBLABEL')
    // 副标题字面在 undo-stack.ts 里钉死
    const stack = overlaySource('src/lib/undo-stack.ts')
    expect(stack).toContain("UNDO_SUBLABEL = '8 秒内可撤销 · Ctrl+Z 也可以 · 回收站保留 30 天'")
  })
})
