import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { getFileContent, readStorageFresh } from '@/lib/github'
import { mutateVideoLibrary } from '@/lib/video-library-store'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

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
        const category = data.navigationItems.find(item => item.id === id)

        if (!category) {
            return NextResponse.json({ error: 'Navigation not found' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const subCategoryId = searchParams.get('subCategoryId')

        if (subCategoryId) {
            const sub = category.subCategories?.find(s => s.id === subCategoryId)
            return NextResponse.json(sub?.items || [])
        }

        return NextResponse.json(category.items || [])
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

        const body = await request.json()
        const newItem: NavigationSubItem = body.item || body
        const subCategoryId: string | undefined = body.subCategoryId

        const outcome = await mutateVideoLibrary<{ kind: 'ok' } | { kind: 'not-found' }>(
            (data) => {
                const navIndex = data.navigationItems.findIndex(item => item.id === id)
                if (navIndex === -1) {
                    return { next: data, result: { kind: 'not-found' as const }, skip: true }
                }

                const category = data.navigationItems[navIndex]
                let updatedCategory = { ...category }

                if (subCategoryId) {
                    const subCategories = (category.subCategories || []).map(sub => {
                        if (sub.id === subCategoryId) {
                            return {
                                ...sub,
                                items: [...(sub.items || []), newItem]
                            }
                        }
                        return sub
                    })
                    updatedCategory.subCategories = subCategories
                } else {
                    updatedCategory.items = [...(category.items || []), newItem]
                }

                const updatedNavigations = data.navigationItems.map((c, i) =>
                    i === navIndex ? updatedCategory : c
                )

                return {
                    next: { ...data, navigationItems: updatedNavigations },
                    result: { kind: 'ok' as const }
                }
            },
            'Add video item',
            { token: authCheck.githubToken || undefined }
        )

        if (!outcome.ok) {
            return NextResponse.json({ error: 'Conflict' }, { status: 409 })
        }
        if (outcome.result.kind === 'not-found') {
            return NextResponse.json({ error: 'Category not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ error: 'Failed to add item', details: (error as Error).message }, { status: 500 })
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

        const { index, item, subCategoryId }: { index: number; item: NavigationSubItem; subCategoryId?: string } = await request.json()

        const outcome = await mutateVideoLibrary<{ kind: 'ok' } | { kind: 'not-found' } | { kind: 'invalid-index' }>(
            (data) => {
                const navIndex = data.navigationItems.findIndex(item => item.id === id)
                if (navIndex === -1) {
                    return { next: data, result: { kind: 'not-found' as const }, skip: true }
                }

                const category = data.navigationItems[navIndex]
                let updatedCategory = { ...category }

                if (subCategoryId) {
                    const subIndex = (category.subCategories || []).findIndex(s => s.id === subCategoryId)
                    if (subIndex === -1) {
                        return { next: data, result: { kind: 'not-found' as const }, skip: true }
                    }
                    const targetSub = category.subCategories![subIndex]
                    const targetItems = [...(targetSub.items || [])]
                    if (!Number.isInteger(index) || index < 0 || index >= targetItems.length) {
                        return { next: data, result: { kind: 'invalid-index' as const }, skip: true }
                    }
                    targetItems[index] = item
                    const updatedSubs = [...category.subCategories!]
                    updatedSubs[subIndex] = { ...targetSub, items: targetItems }
                    updatedCategory.subCategories = updatedSubs
                } else {
                    const targetItems = [...(category.items || [])]
                    if (!Number.isInteger(index) || index < 0 || index >= targetItems.length) {
                        return { next: data, result: { kind: 'invalid-index' as const }, skip: true }
                    }
                    targetItems[index] = item
                    updatedCategory.items = targetItems
                }

                const updatedNavigations = data.navigationItems.map((c, i) =>
                    i === navIndex ? updatedCategory : c
                )

                return {
                    next: { ...data, navigationItems: updatedNavigations },
                    result: { kind: 'ok' as const }
                }
            },
            'Update video item',
            { token: authCheck.githubToken || undefined }
        )

        if (!outcome.ok) {
            return NextResponse.json({ error: 'Conflict' }, { status: 409 })
        }
        if (outcome.result.kind === 'not-found') {
            return NextResponse.json({ error: 'Target not found' }, { status: 404 })
        }
        if (outcome.result.kind === 'invalid-index') {
            return NextResponse.json({ error: 'Invalid item index' }, { status: 400 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update item', details: (error as Error).message }, { status: 500 })
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

        const { index, subCategoryId }: { index: number; subCategoryId?: string } = await request.json()

        const outcome = await mutateVideoLibrary<{ kind: 'ok' } | { kind: 'not-found' } | { kind: 'invalid-index' }>(
            (data) => {
                const navIndex = data.navigationItems.findIndex(item => item.id === id)
                if (navIndex === -1) {
                    return { next: data, result: { kind: 'not-found' as const }, skip: true }
                }

                const category = data.navigationItems[navIndex]
                let updatedCategory = { ...category }

                if (subCategoryId) {
                    const subIndex = (category.subCategories || []).findIndex(s => s.id === subCategoryId)
                    if (subIndex === -1) {
                        return { next: data, result: { kind: 'not-found' as const }, skip: true }
                    }
                    const targetSub = category.subCategories![subIndex]
                    const targetItems = [...(targetSub.items || [])]
                    if (!Number.isInteger(index) || index < 0 || index >= targetItems.length) {
                        return { next: data, result: { kind: 'invalid-index' as const }, skip: true }
                    }
                    const filtered = targetItems.filter((_, i) => i !== index)
                    const updatedSubs = [...category.subCategories!]
                    updatedSubs[subIndex] = { ...targetSub, items: filtered }
                    updatedCategory.subCategories = updatedSubs
                } else {
                    const targetItems = [...(category.items || [])]
                    if (!Number.isInteger(index) || index < 0 || index >= targetItems.length) {
                        return { next: data, result: { kind: 'invalid-index' as const }, skip: true }
                    }
                    updatedCategory.items = targetItems.filter((_, i) => i !== index)
                }

                const updatedNavigations = data.navigationItems.map((c, i) =>
                    i === navIndex ? updatedCategory : c
                )

                return {
                    next: { ...data, navigationItems: updatedNavigations },
                    result: { kind: 'ok' as const }
                }
            },
            'Delete video item',
            { token: authCheck.githubToken || undefined }
        )

        if (!outcome.ok) {
            return NextResponse.json({ error: 'Conflict' }, { status: 409 })
        }
        if (outcome.result.kind === 'not-found') {
            return NextResponse.json({ error: 'Target not found' }, { status: 404 })
        }
        if (outcome.result.kind === 'invalid-index') {
            return NextResponse.json({ error: 'Invalid item index' }, { status: 400 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete item', details: (error as Error).message }, { status: 500 })
    }
}
