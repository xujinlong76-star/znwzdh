import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { getFileContent, readStorageFresh } from '@/lib/github'
import {
    decodeVideoCursor,
    encodeVideoCursor,
    pageCategoryByCursor,
    type VideoCursor,
} from '@/lib/video-pagination'
import { mutateVideoLibrary } from '@/lib/video-library-store'
import { isVideoShrinkBlock } from '@/lib/video-write-guard'
import { withSignedVideoIcons } from '@/lib/media-proxy'
import type { NavigationItem, NavigationData, NavigationSubItem } from '@/types/navigation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

/** 单条视频里最占体积的字段：章节大纲与逐句字幕，动辄几十 KB */
function stripHeavyFields(item: NavigationSubItem): NavigationSubItem {
  if (!item.videoConfig) return item
  // 用 delete 而不是解构丢弃：解构会留下未使用变量，触发 no-unused-vars
  const videoConfig = { ...item.videoConfig }
  delete videoConfig.chapters
  delete videoConfig.transcript
  return { ...item, videoConfig }
}

function compactCategory(cat: NavigationItem): NavigationItem {
  return {
    ...cat,
    items: (cat.items || []).map(stripHeavyFields),
    subCategories: (cat.subCategories || []).map(sub => ({
      ...sub,
      items: (sub.items || []).map(stripHeavyFields),
    })),
  }
}

/** 为管理端看板提供极轻量概要视图（剥离长描述与视频重度字段，保留条目与保鲜度用于图表与看板展示） */
function summarizeCategory(cat: NavigationItem): NavigationItem {
  const summarizeItem = (it: NavigationSubItem): NavigationSubItem => ({
    id: it.id,
    title: it.title,
    href: it.href,
    enabled: it.enabled,
    videoConfig: it.videoConfig ? {
      type: it.videoConfig.type,
      pinned: it.videoConfig.pinned,
      freshnessScore: it.videoConfig.freshnessScore,
    } : undefined,
  } as NavigationSubItem);

  return {
    ...cat,
    items: (cat.items || []).map(summarizeItem),
    subCategories: (cat.subCategories || []).map(sub => ({
      ...sub,
      items: (sub.items || []).map(summarizeItem),
    })),
  };
}


function pageCategory(cat: NavigationItem, offset: number, limit: number): NavigationItem {
  return {
    ...cat,
    items: (cat.items || []).slice(offset, offset + limit),
    subCategories: (cat.subCategories || []).map(sub => ({
      ...sub,
      items: (sub.items || []).slice(offset, offset + limit),
    })),
  }
}


function parseCount(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.floor(n)
}

/**
 * 读取视频库。
 *
 * 查询参数（全部可选，不传时行为与历史逐字一致）：
 *   - `compact=1`    剥离 `chapters` / `transcript`（单条最大字段）。列表页只需要标题/封面/作者。
 *   - `categoryId=`  只返回指定分类，便于管理端按分类加载。
 *   - `limit` / `offset`  对**每个分类内**的条目分页（结构与消费方解析方式保持一致，
 *     不把分类本身拍平成一维列表）。
 *
 * 为什么不默认精简：`/videos` 的播放页需要完整章节树，默认裁剪会让那些页面拿到空章节。
 * 需要省的调用方显式带 `compact=1`。
 *
 * 元信息走响应头（`X-Total-Items` / `X-Returned-Items`），不改响应体形状 ——
 * 现有消费方 `admin/videos/page.tsx` 直接解构 `navigationItems`，加字段会打乱它。
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const data = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData
        const categories: NavigationItem[] = Array.isArray(data?.navigationItems)
            ? data.navigationItems
            : []

        const summary = searchParams.get('summary') === '1'
        const compact = searchParams.get('compact') === '1'
        const categoryId = searchParams.get('categoryId')
        const limit = parseCount(searchParams.get('limit'))
        const offset = parseCount(searchParams.get('offset')) ?? 0

        const countItems = (cats: NavigationItem[]) =>
            cats.reduce(
                (n, c) =>
                    n +
                    (c.items?.length ?? 0) +
                    (c.subCategories ?? []).reduce((m, s) => m + (s.items?.length ?? 0), 0),
                0,
            )

        const totalItems = countItems(categories)

        const searchQuery = (searchParams.get('q') || searchParams.get('search'))?.trim().toLowerCase()
        if (searchQuery) {
            const matches: NavigationSubItem[] = []
            for (const cat of categories) {
                if (categoryId && cat.id !== categoryId) continue
                for (const it of cat.items || []) {
                    if (
                        it.title?.toLowerCase().includes(searchQuery) ||
                        it.description?.toLowerCase().includes(searchQuery) ||
                        it.videoConfig?.author?.toLowerCase().includes(searchQuery)
                    ) {
                        matches.push(it)
                    }
                }
                for (const sub of cat.subCategories || []) {
                    for (const it of sub.items || []) {
                        if (
                            it.title?.toLowerCase().includes(searchQuery) ||
                            it.description?.toLowerCase().includes(searchQuery) ||
                            it.videoConfig?.author?.toLowerCase().includes(searchQuery)
                        ) {
                            matches.push(it)
                        }
                    }
                }
            }
            const pagedMatches = matches.slice(offset, offset + (limit ?? 20)).map(stripHeavyFields)
            return NextResponse.json(
                {
                    ...data,
                    videos: pagedMatches,
                    total: matches.length,
                    navigationItems: []
                },
                {
                    headers: {
                        'X-Total-Items': String(matches.length),
                        'X-Returned-Items': String(pagedMatches.length)
                    }
                }
            )
        }

        const cursor = decodeVideoCursor(searchParams.get('cursor'))
        const pageSize = limit ?? 20

        let selected = categoryId ? categories.filter(c => c.id === categoryId) : categories
        if (summary) selected = selected.map(summarizeCategory)
        else if (compact) selected = selected.map(compactCategory)

        let nextCursor: VideoCursor | null = null
        if (cursor && categoryId) {
            // 游标模式：只在单分类内分页（跨分类的游标需要复合键，收益不抵复杂度）
            selected = selected.map(c => {
                const paged = pageCategoryByCursor(c, cursor, pageSize)
                if (paged.nextCursor) nextCursor = paged.nextCursor
                return paged.category
            })
        } else if (limit !== undefined) {
            selected = selected.map(c => pageCategory(c, offset, limit))
        }

        return NextResponse.json(
            { ...data, navigationItems: selected },
            {
                headers: {
                    'X-Total-Items': String(totalItems),
                    'X-Returned-Items': String(countItems(selected)),
                    ...(nextCursor ? { 'X-Next-Cursor': encodeVideoCursor(nextCursor) } : {}),
                },
            },
        )
    } catch (error) {
        console.error('Failed to fetch videos data:', error)
        return NextResponse.json({
            navigationItems: []
        })
    }
}


export async function POST(request: Request) {
    try {
        const authCheck = await verifyAdminSession()
        if (!authCheck.ok) {
            return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
        }

        const data = await request.json()

        // 整包保存也走版本校验：管理端「保存全部」与后台采集并发时，
        // 谁后写谁赢会静默丢掉对方的改动；带 ifVersion 后冲突可见（409）。
                const outcome = await mutateVideoLibrary<null>(
            (currentData) => {
                if (data.item || data.category) {
                    const newItem = (data.item || data.category) as NavigationItem;
                    return {
                        next: {
                            ...currentData,
                            navigationItems: [...(currentData.navigationItems || []), newItem],
                        },
                        result: null,
                    };
                }

                if (Array.isArray(data.navigationItems)) {
                    const existingMap = new Map((currentData.navigationItems || []).map(c => [c.id, c]));
                    const mergedItems = data.navigationItems.map((incomingCat: NavigationItem) => {
                        const existing = existingMap.get(incomingCat.id);
                        if (!existing) return incomingCat;
                        return {
                            ...existing,
                            ...incomingCat,
                            items: incomingCat.items && incomingCat.items.length > 0 ? incomingCat.items : existing.items,
                            subCategories: incomingCat.subCategories && incomingCat.subCategories.length > 0
                                ? incomingCat.subCategories.map(inSub => {
                                    const exSub = (existing.subCategories || []).find(s => s.id === inSub.id);
                                    if (!exSub) return inSub;
                                    return {
                                        ...exSub,
                                        ...inSub,
                                        items: inSub.items && inSub.items.length > 0 ? inSub.items : exSub.items,
                                    };
                                })
                                : existing.subCategories,
                        };
                    });

                    return {
                        next: {
                            ...currentData,
                            ...data,
                            navigationItems: mergedItems,
                        },
                        result: null,
                    };
                }

                return {
                    next: {
                        ...currentData,
                        ...data,
                    },
                    result: null,
                };
            },
            'Update videos data',
            { token: authCheck.githubToken || undefined }
        )

        if (!outcome.ok) {
            return NextResponse.json(
                { error: 'Conflict', message: '视频库正在被并发修改，请刷新后重试', retryable: true },
                { status: 409 }
            )
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Failed to save videos data:', error)
        return NextResponse.json(
            {
                error: 'Failed to save videos data',
                details: (error as Error).message
            },
            { status: 500 }
        )
    }
}

export async function PUT(request: Request) {
    try {
        const authCheck = await verifyAdminSession()
        if (!authCheck.ok) {
            return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
        }

        const payload = await request.json()
        /**
         * 缩水保护的二阶段确认参数**必须从文档里剥出来**：这两个字段是给守卫看的，
         * 留在 `next` 里会被原样写进 videos.json，污染正本且下次读取多两个野字段。
         */
        const { confirmLargeDeletion, expectedCount, ...data } = payload as NavigationData & {
            confirmLargeDeletion?: unknown
            expectedCount?: unknown
        }
        // 只认非负整数：字符串 / 小数 / 负数一律当没给，避免「带了参数但中枢解析不出」的第三种状态
        const declaredCount = Number.isInteger(expectedCount) && Number(expectedCount) >= 0 ? Number(expectedCount) : undefined

        // 整包保存也走版本校验：管理端「保存全部」与后台采集并发时，
        // 谁后写谁赢会静默丢掉对方的改动；带 ifVersion 后冲突可见（409）。
        const outcome = await mutateVideoLibrary<null>(
            () => ({ next: data as NavigationData, result: null }),
            'Update videos data',
            {
                token: authCheck.githubToken || undefined,
                confirmLargeDeletion: confirmLargeDeletion === true,
                expectedCount: declaredCount,
            }
        )

        if (!outcome.ok) {
            return NextResponse.json(
                { error: 'Conflict', message: '视频库正在被并发修改，请刷新后重试', retryable: true },
                { status: 409 }
            )
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        const message = (error as Error)?.message ?? String(error)
        /**
         * 缩水拦截是按设计被拒，不是中枢故障：返回 409 并原样带上守卫给的文案
         * （里面写着该带哪个 expectedCount），管理端才能给出可执行的下一步。
         * 走 500 的话，一次正常的确认流程会被读成「保存失败」。
         */
        if (isVideoShrinkBlock(error)) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'video_shrink_blocked',
                    message,
                    retryable: false,
                    retryWith: { confirmLargeDeletion: true },
                },
                { status: 409 }
            )
        }
        console.error('Failed to update videos data:', error)
        return NextResponse.json(
            {
                error: 'Failed to update videos data',
                details: message
            },
            { status: 500 }
        )
    }
}
