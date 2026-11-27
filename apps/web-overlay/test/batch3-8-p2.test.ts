/**
 * Batch 3 第 8 项 P2 · 体验收尾。
 *
 * 锁：
 *   - manifest 加 /offline 快捷方式（事实源 apps/web-overlay/src/app/manifest.ts）
 *   - /offline 标题过滤：只过滤本机快照标题（最近访问 + 收藏 + 稍后再看/续播），
 *     不调 /api/search、不建全文索引，占位文案写明「仅搜本机内容」
 *   - data-prefetch-target 认领：Provider 扫描时优先处理带标记的卡片链接
 *     （选了「认领」而非「删除」：标记在外站卡片链接上，与 A0 预连接扫描
 *     天然匹配，改动只是调整扫描顺序；删除则丢掉卡片优先级的语义）
 *   - speculative-prerender 去留：保留 + 文件头注明「仅演示用、生产不用」，
 *     守卫钉死生产代码无调用方（选了保留而非删除：删除要动演示页，
 *     演示页由 algorithm-lab-structure.test.ts 与 e2e 双守卫锁定）
 *   - P1 遗留：场景切换成功后发事件，Provider 空闲预取目标场景首页 1 条
 *   - P0 遗留：/me/data「离线可看」改成「元数据已存本机」，守卫钉死不再出现
 *
 * 体例：纯函数直接测，组件接线用源码守卫（仿 route-prefetch.test.ts）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  SCENE_SWITCHED_EVENT,
  buildSceneLandingCandidate,
  createRoutePrefetchSession,
  pickIdlePrefetchCandidate,
} from '@/lib/route-prefetch'
import { matchesOfflineTitle } from '@/lib/offline-shell'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

/** 定位仓库根下的文件（core 事实源等不在 overlay 里的文件） */
function repoSource(rel: string): string {
  const hit = resolve(HERE, '..', '..', '..', rel)
  if (!existsSync(hit)) throw new Error('无法定位仓库文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('matchesOfflineTitle：只过滤本机标题', () => {
  it('空查询不过滤', () => {
    expect(matchesOfflineTitle('任意标题', '')).toBe(true)
    expect(matchesOfflineTitle('任意标题', '   ')).toBe(true)
  })

  it('子串匹配，去空格、大小写不敏感', () => {
    expect(matchesOfflineTitle('React 官方文档', 'react')).toBe(true)
    expect(matchesOfflineTitle('React 官方文档', ' 官方 ')).toBe(true)
    expect(matchesOfflineTitle('React 官方文档', 'Vue')).toBe(false)
  })
})

describe('manifest：/offline 快捷方式', () => {
  it('shortcuts 里有离线阅读 /offline，既有三条不动', () => {
    const src = overlaySource('src/app/manifest.ts')
    expect(src).toContain("{ name: '离线阅读', url: '/offline' }")
    expect(src).toContain("url: '/hot'")
    expect(src).toContain("url: '/tags'")
    expect(src).toContain("url: '/favorites'")
  })
})

describe('/offline 标题过滤：三个分区共用同一查询，不调搜索接口', () => {
  it('过滤框在客户端容器里，占位文案写明仅搜本机内容', () => {
    const src = overlaySource('src/components/offline-content.tsx')
    expect(src).toContain('仅搜本机内容')
    expect(src).toContain('OfflineSnapshotSections query={query}')
    expect(src).toContain('OfflineRecentList query={query}')
    // 不调搜索接口：无 fetch 调用、无 '/api/search' 字面量
    //（文件头注释里「不调 /api/search」是约束说明，不算调用）
    expect(src).not.toContain('fetch(')
    expect(src).not.toContain("'/api/search'")
    expect(src).not.toContain('"/api/search"')
    expect(src).not.toContain('已下载')
    expect(src).not.toContain('离线可播')
  })

  it('/offline 页挂客户端容器，不再直挂两个分区', () => {
    const page = overlaySource('src/app/offline/page.tsx')
    expect(page).toContain('OfflineContent')
    expect(page).not.toContain('OfflineSnapshotSections')
    expect(page).not.toContain('OfflineRecentList')
  })

  it('三个分区都用 matchesOfflineTitle 过滤标题，无匹配时不明说「还没有」', () => {
    const sections = overlaySource('src/components/offline-snapshot-sections.tsx')
    expect(sections).toContain('matchesOfflineTitle(f.title, query)')
    expect(sections).toContain('matchesOfflineTitle(row.title, query)')
    expect(sections).toContain('没有标题包含')
    expect(sections).not.toContain('fetch(')
    expect(sections).not.toContain("'/api/search'")
    const recent = overlaySource('src/components/offline-recent-list.tsx')
    expect(recent).toContain('matchesOfflineTitle(v.title, query)')
    expect(recent).toContain('没有标题包含')
    expect(recent).not.toContain('fetch(')
    expect(recent).not.toContain("'/api/search'")
  })
})

describe('data-prefetch-target 认领：Provider 扫描优先处理带标记的卡片链接', () => {
  it('navigation-card 三处标记都在（外站卡片链接），未被删除', () => {
    const card = overlaySource('src/components/navigation-card.tsx')
    expect((card.match(/data-prefetch-target="true"/g) ?? []).length).toBe(3)
  })

  it('Provider 的 A0 扫描先扫标记链接、再补位普通 http 链接，仍只取前 12 个', () => {
    const src = overlaySource('src/components/predictive-prefetch-provider.tsx')
    const markedIdx = src.indexOf('a[data-prefetch-target="true"]')
    expect(markedIdx).toBeGreaterThan(-1)
    expect(markedIdx).toBeLessThan(src.indexOf('a[href^="http"]'))
    expect(src).toContain('Math.min(orderedLinks.length, 12)')
  })
})

describe('speculative-prerender 去留：只留实验室演示，生产不用', () => {
  it('core 事实源文件头注明仅演示用、生产不用', () => {
    const src = repoSource('packages/core/src/speculative-prerender.ts')
    expect(src).toContain('仅演示用、生产不用')
    expect(src).toContain('唯一调用方是算法实验室演示页')
  })

  it('生产代码无调用方：除算法实验室演示页与库本身外，全仓 overlay 源码无引用', () => {
    const srcDir = resolve(HERE, '..', '..', 'web-overlay', 'src')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue
        const rel = full.replace(/\\/g, '/')
        if (rel.includes('/algorithm-lab/')) continue
        if (rel.endsWith('/lib/speculative-prerender.ts')) continue
        // 实验室纯函数层：只被 algorithm-lab 三组件（intent-panel /
        // speculation-panel / trajectory-lab）与自身单测引用，不做任何
        // 预取/预渲染，只给演示页做规则编译与候选分类；与 algorithm-lab/
        // 同属演示代码，不算生产调用方，故与演示页一并排除。
        if (rel.endsWith('/lib/trajectory-hit.ts')) continue
        if (readFileSync(full, 'utf8').includes('speculative-prerender')) offenders.push(rel)
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })

  it('trajectory-hit.ts 无非实验室调用方：只允许 algorithm-lab 组件引用', () => {
    // WHY：trajectory-hit.ts import 了 speculative-prerender；若生产组件
    // 引用它，会把「仅演示用」的预渲染逻辑传递拉进生产，而上一个守卫
    // 只查直接出现的 'speculative-prerender' 字面量，拦不住这种传递
    // 引用，所以这里直接钉死 trajectory-hit.ts 的调用方范围。
    const srcDir = resolve(HERE, '..', '..', 'web-overlay', 'src')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue
        const rel = full.replace(/\\/g, '/')
        if (rel.endsWith('/lib/trajectory-hit.ts')) continue
        if (!readFileSync(full, 'utf8').includes('trajectory-hit')) continue
        if (!rel.includes('/algorithm-lab/')) offenders.push(rel)
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })

  it('测试里只有 trajectory-hit.test.ts 引用 trajectory-hit', () => {
    // 守卫本身（本文件）只含字面量与路径排除，不算引用方，故排除。
    // 例外：algo-numbers-verify.test.ts 引用 trajectory-hit 的 median 与
    // 预渲染/预取阈值常量（PRERENDER/PREFETCH_CONFIDENCE_THRESHOLD、
    // SANDBOX_CANDIDATE_PATHS、toAbsoluteCandidates），只为校验 algo-lab
    // 展示数字与真实计算一致（2c1f4bd）；测试内引用，不接生产调用，
    // 不违反「生产不用 speculative-prerender」的本意，故放行。
    const importers: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.test\.(ts|tsx)$/.test(entry)) continue
        const rel = full.replace(/\\/g, '/')
        if (rel.endsWith('/test/batch3-8-p2.test.ts')) continue
        if (rel.endsWith('/test/algo-numbers-verify.test.ts')) continue
        if (readFileSync(full, 'utf8').includes('trajectory-hit')) importers.push(rel)
      }
    }
    walk(HERE)
    expect(importers).toHaveLength(1)
    expect(importers[0]).toContain('/test/trajectory-hit.test.ts')
  })
})

describe('场景切换后空闲预取目标场景首页 1 条（P1 遗留）', () => {
  it('事件名是常量，值为 navhub:scene-switched', () => {
    expect(SCENE_SWITCHED_EVENT).toBe('navhub:scene-switched')
    const lib = overlaySource('src/lib/route-prefetch.ts')
    expect(lib).toContain("export const SCENE_SWITCHED_EVENT = 'navhub:scene-switched'")
  })

  it('performSceneSwitch 成功时发事件（带 sceneId），失败 / 已是当前场景不发', () => {
    const src = overlaySource('src/components/scene-switcher.tsx')
    expect(src).toContain('SCENE_SWITCHED_EVENT')
    expect(src).toContain('detail: { sceneId: scene.id }')
    // 事件只在成功分支发：dispatch 出现在最后一个 return true 之前，
    // 而「已是当前场景」「切换失败」两个提前 return 在它之前。
    const dispatchIdx = src.indexOf('new CustomEvent(SCENE_SWITCHED_EVENT')
    const alreadyIdx = src.indexOf("title: '已是当前场景'")
    const failedIdx = src.indexOf("title: '场景切换失败，已恢复到切换前状态'")
    expect(dispatchIdx).toBeGreaterThan(alreadyIdx)
    expect(dispatchIdx).toBeGreaterThan(failedIdx)
  })

  it('Provider 接事件：空闲预取 buildSceneLandingCandidate 的 1 条候选', () => {
    const src = overlaySource('src/components/predictive-prefetch-provider.tsx')
    expect(src).toContain('addEventListener(SCENE_SWITCHED_EVENT, onSceneSwitched)')
    expect(src).toContain('buildSceneLandingCandidate(sceneId)')
    expect(src).toContain('pickIdlePrefetchCandidate([candidate]')
    expect(src).toContain('router.prefetch(picked.href)')
  })

  it('单候选拾取只认领 1 条，重复拾取不再认领', () => {
    const candidate = buildSceneLandingCandidate('s1')
    expect(candidate).toMatchObject({ href: '/scenes/s1', priority: 'low', source: 'scene-landing' })
    const session = createRoutePrefetchSession()
    const picked = pickIdlePrefetchCandidate([candidate!], session, {
      networkAllowed: true,
      currentHref: '/',
    })
    expect(picked?.href).toBe('/scenes/s1')
    expect(session.claimed.size).toBe(1)
    expect(
      pickIdlePrefetchCandidate([candidate!], session, { networkAllowed: true, currentHref: '/' }),
    ).toBeNull()
  })
})

describe('/me/data 文案诚实：不再出现「离线可看」', () => {
  it('视频卡片写「元数据已存本机」，全文件无「离线可看」', () => {
    const src = overlaySource('src/components/user-center/local-data-manager.tsx')
    expect(src).not.toContain('离线可看')
    expect(src).toContain('元数据已存本机')
  })
})
