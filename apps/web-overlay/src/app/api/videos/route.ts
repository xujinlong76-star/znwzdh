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
        const data = ((await readStorageFresh(VIDEOS_FILE_PATH)) ?? (await getFileContent(VIDEOS_FILE_PATH))) as NavigationData
        const categories: NavigationItem[] = Array.isArray(data?.navigationItems)
            ? data.navigationItems
            : []

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

        const cursor = decodeVideoCursor(searchParams.get('cursor'))
        const pageSize = limit ?? 20

        let selected = categoryId ? categories.filter(c => c.id === categoryId) : categories
        if (compact) selected = selected.map(compactCategory)

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
            return new Response(authCheck.error, { status: authCheck.status })
        }

        const data = await request.json()

        // 整包保存也走版本校验：管理端「保存全部」与后台采集并发时，
        // 谁后写谁赢会静默丢掉对方的改动；带 ifVersion 后冲突可见（409）。
        const outcome = await mutateVideoLibrary<null>(
            () => ({ next: data as NavigationData, result: null }),
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
            return new Response(authCheck.error, { status: authCheck.status })
        }

        const data = await request.json()

        // 整包保存也走版本校验：管理端「保存全部」与后台采集并发时，
        // 谁后写谁赢会静默丢掉对方的改动；带 ifVersion 后冲突可见（409）。
        const outcome = await mutateVideoLibrary<null>(
            () => ({ next: data as NavigationData, result: null }),
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
        console.error('Failed to update videos data:', error)
        return NextResponse.json(
            {
                error: 'Failed to update videos data',
                details: (error as Error).message
            },
            { status: 500 }
        )
    }
}
