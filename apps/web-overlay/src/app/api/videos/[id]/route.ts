import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { commitFile, getFileContent } from '@/lib/github'
import type { NavigationItem, NavigationData } from '@/types/navigation'

export const runtime = 'nodejs'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

async function validateAndSaveVideosData(data: NavigationData, accessToken?: string) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid videos data')
    }

    await commitFile(
        VIDEOS_FILE_PATH,
        JSON.stringify(data, null, 2),
        'Update videos data',
        accessToken
    )
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const data = await getFileContent(VIDEOS_FILE_PATH)
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
        const data = await getFileContent(VIDEOS_FILE_PATH)

        const index = data.navigationItems.findIndex((item: NavigationItem) => item.id === id)
        if (index === -1) {
            return NextResponse.json({ error: 'Item not found' }, { status: 404 })
        }

        // 更新项目并锁定原有 id 不被覆盖
        data.navigationItems[index] = {
            ...data.navigationItems[index],
            ...updatedItem,
            id,
        }

        await validateAndSaveVideosData(data, authCheck.githubToken || undefined)

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
        const data = await getFileContent(VIDEOS_FILE_PATH)

        const index = data.navigationItems.findIndex((item: NavigationItem) => item.id === id)
        if (index === -1) {
            return NextResponse.json({ error: 'Item not found' }, { status: 404 })
        }

        // 删除项目
        data.navigationItems.splice(index, 1)

        await validateAndSaveVideosData(data, authCheck.githubToken || undefined)

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
