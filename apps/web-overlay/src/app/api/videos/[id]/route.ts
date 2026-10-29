import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { getFileContent, readStorageFresh } from '@/lib/github'
import { mutateVideoLibrary } from '@/lib/video-library-store'
import type { NavigationItem, NavigationData } from '@/types/navigation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'


export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const data = ((await readStorageFresh(VIDEOS_FILE_PATH)) ?? (await getFileContent(VIDEOS_FILE_PATH))) as NavigationData
        const item = data.navigationItems.find((item: NavigationItem) => item.id === id)

        if (!item) {
            return NextResponse.json({ error: 'Item not found' }, { status: 404 })
        }

        return NextResponse.json(item)
    } catch (error) {
        console.error('Failed to fetch videos data:', error)
        return NextResponse.json(
            {
                error: 'Failed to fetch videos data',
                details: (error as Error).message
            },
            { status: 500 }
        )
    }
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const authCheck = await verifyAdminSession()
        if (!authCheck.ok) {
            return new Response(authCheck.error, { status: authCheck.status })
        }

        const { id } = await params
        const updatedItem = await request.json()

        // 读-改-写走统一入口：带 ifVersion + 冲突重放。此前的整包覆盖写会
        // 把「打开编辑框之后」发生的采集结果整批抹掉（last-write-wins）。
        const outcome = await mutateVideoLibrary<{ kind: 'not-found' } | { kind: 'updated' }>(
            (data) => {
                const index = data.navigationItems.findIndex((item: NavigationItem) => item.id === id)
                if (index === -1) {
                    return { next: data, result: { kind: 'not-found' as const }, skip: true }
                }
                // 不可变更新 + 锁定原有 id 不被覆盖
                const next = {
                    ...data,
                    navigationItems: data.navigationItems.map((item, i) =>
                        i === index ? { ...item, ...updatedItem, id } : item
                    ),
                }
                return { next, result: { kind: 'updated' as const } }
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
        if (outcome.result.kind === 'not-found') {
            return NextResponse.json({ error: 'Item not found' }, { status: 404 })
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

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const authCheck = await verifyAdminSession()
        if (!authCheck.ok) {
            return new Response(authCheck.error, { status: authCheck.status })
        }

        const { id } = await params

        const outcome = await mutateVideoLibrary<{ kind: 'not-found' } | { kind: 'deleted' }>(
            (data) => {
                const exists = data.navigationItems.some((item: NavigationItem) => item.id === id)
                if (!exists) {
                    return { next: data, result: { kind: 'not-found' as const }, skip: true }
                }
                const next = {
                    ...data,
                    navigationItems: data.navigationItems.filter((item: NavigationItem) => item.id !== id),
                }
                return { next, result: { kind: 'deleted' as const } }
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
        if (outcome.result.kind === 'not-found') {
            return NextResponse.json({ error: 'Item not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Failed to delete videos data:', error)
        return NextResponse.json(
            {
                error: 'Failed to delete videos data',
                details: (error as Error).message
            },
            { status: 500 }
        )
    }
}
