import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { commitFile, getFileContent } from '@/lib/github'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

export const runtime = 'nodejs'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const data = await getFileContent(VIDEOS_FILE_PATH) as NavigationData
        const item = data.navigationItems.find(item => item.id === id)

        if (!item) {
            return NextResponse.json({ error: 'Navigation not found' }, { status: 404 })
        }

        return NextResponse.json(item.items)
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const authCheck = await verifyAdminSession()
        if (!authCheck.ok) {
            return new Response(authCheck.error, { status: authCheck.status })
        }

        const newItem: NavigationSubItem = await request.json()
        const data = await getFileContent(VIDEOS_FILE_PATH) as NavigationData

        const navigation = data.navigationItems.find(item => item.id === id)
        if (!navigation) {
            return NextResponse.json({ error: 'Navigation not found' }, { status: 404 })
        }

        const updatedItems = data.navigationItems.map(item => {
            if (item.id === id) {
                return {
                    ...item,
                    items: [...(item.items || []), newItem]
                }
            }
            return item
        })

        await commitFile(
            VIDEOS_FILE_PATH,
            JSON.stringify({ ...data, navigationItems: updatedItems }, null, 2),
            'Add video item',
            authCheck.githubToken || undefined
        )

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ error: 'Failed to add item' }, { status: 500 })
    }
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const authCheck = await verifyAdminSession()
        if (!authCheck.ok) {
            return new Response(authCheck.error, { status: authCheck.status })
        }

        const { index, item }: { index: number, item: NavigationSubItem } = await request.json()
        const data = await getFileContent(VIDEOS_FILE_PATH) as NavigationData

        const navigation = data.navigationItems.find(nav => nav.id === id)
        if (!navigation) {
            return NextResponse.json({ error: 'Navigation not found' }, { status: 404 })
        }

        const updatedItems = [...(navigation.items || [])]
        if (!Number.isInteger(index) || index < 0 || index >= updatedItems.length) {
            return NextResponse.json({ error: 'Invalid item index' }, { status: 400 })
        }
        updatedItems[index] = item

        const updatedNavigations = data.navigationItems.map(nav => {
            if (nav.id === id) {
                return {
                    ...nav,
                    items: updatedItems
                }
            }
            return nav
        })

        await commitFile(
            VIDEOS_FILE_PATH,
            JSON.stringify({ ...data, navigationItems: updatedNavigations }, null, 2),
            'Update video item',
            authCheck.githubToken || undefined
        )

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const authCheck = await verifyAdminSession()
        if (!authCheck.ok) {
            return new Response(authCheck.error, { status: authCheck.status })
        }

        const { index } = await request.json()
        const data = await getFileContent(VIDEOS_FILE_PATH) as NavigationData

        const navigation = data.navigationItems.find(nav => nav.id === id)
        if (!navigation) {
            return NextResponse.json({ error: 'Navigation not found' }, { status: 404 })
        }

        const currentItems = navigation.items || []
        if (!Number.isInteger(index) || index < 0 || index >= currentItems.length) {
            return NextResponse.json({ error: 'Invalid item index' }, { status: 400 })
        }

        const updatedItems = currentItems.filter((_, i) => i !== index)
        const updatedNavigations = data.navigationItems.map(nav => {
            if (nav.id === id) {
                return {
                    ...nav,
                    items: updatedItems
                }
            }
            return nav
        })

        await commitFile(
            VIDEOS_FILE_PATH,
            JSON.stringify({ ...data, navigationItems: updatedNavigations }, null, 2),
            'Delete video item',
            authCheck.githubToken || undefined
        )

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
    }
}
