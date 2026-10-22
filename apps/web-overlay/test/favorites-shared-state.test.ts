import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 收藏状态一致性守卫（S3/S4）：
 * 1. useFavorites 必须是模块级共享状态（useSyncExternalStore），
 *    否则同文档内多个实例互不联动——点星取消收藏后卡片不消失；
 * 2. 「重试同步」必须走与首挂载相同的云结果落地路径——
 *    否则重试成功后界面仍显示旧数据。
 */

const ROOT = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('useFavorites：模块级共享状态', () => {
  const src = read('src/hooks/useFavorites.ts')

  it('使用 useSyncExternalStore 订阅同一份模块状态', () => {
    expect(src).toContain('useSyncExternalStore(')
    expect(src).toContain('subscribeFavorites')
    expect(src).toContain('getFavoritesSnapshot')
    expect(src).toContain('applyLocalFavorites')
  })

  it('不再保留每实例的 itemsRef（共享状态即最新快照）', () => {
    expect(src).not.toContain('itemsRef')
  })

  it('写入路径统一经过 applyLocalFavorites 后再落盘', () => {
    const persistBody = src.slice(src.indexOf('const persist = useCallback'), src.indexOf('const resetLocal = useCallback'))
    expect(persistBody).toMatch(/if \(storageBlocked\) return false/)
    expect(persistBody).toContain('applyLocalFavorites(')
    expect(persistBody).toContain('saveLocal(')
  })
})

describe('收藏页：重试同步与首挂载共用落地路径', () => {
  const src = read('src/app/favorites/page.tsx')

  it('存在 applyCloudResult 且首挂载与重试都调用它', () => {
    expect(src).toContain('applyCloudResult')
    // 首挂载 effect
    expect(src).toMatch(/runCloudSync\(\)[\s\S]{0,120}applyCloudResult\(result\)/)
    // 重试按钮
    expect(src).toMatch(/重试同步[\s\S]{0,300}applyCloudResult\(result\)|applyCloudResult\(result\)[\s\S]{0,300}重试同步/)
  })
})
