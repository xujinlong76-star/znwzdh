import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { commitFile, getFileContent } from '@/lib/github'
import type { NavigationData, NavigationItem } from '@/types/navigation'

export const runtime = 'nodejs'

/** 整包导航文档的存储路径（后台「保存」与站点目录写回共用） */
const NAVIGATION_FILE_PATH = 'src/navsphere/content/navigation.json'

/** 出错时一行日志最多列几个 id —— 再多不属于日志，属于附件 */
const MAX_REPORTED_IDS = 20

export async function GET() {
  try {
    const data = await getFileContent(NAVIGATION_FILE_PATH)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch navigation data:', error)
    // 返回默认数据结构
    return NextResponse.json({
      navigationItems: []
    })
  }
}

/**
 * 一次保存的体量摘要：只有计数与字节数，不含任何条目内容。
 * 站点条数按「顶层 items + 子分类 items」统计，与中枢那份缩水保护的计数口径一致。
 */
function summarizeNavigation(data: NavigationData) {
  let subCategories = 0
  let items = 0
  for (const category of data.navigationItems ?? []) {
    items += category.items?.length || 0
    for (const sub of category.subCategories ?? []) {
      subCategories++
      items += sub.items?.length || 0
    }
  }
  return {
    categories: data.navigationItems?.length || 0,
    subCategories,
    items,
    bytes: JSON.stringify(data).length,
  }
}

async function validateAndSaveNavigationData(data: NavigationData, accessToken?: string) {
  // 严格验证数据结构
  if (!data || typeof data !== 'object') {
    console.error('Invalid navigation data: not an object')
    throw new Error('Invalid navigation data: not an object')
  }

  if (!('navigationItems' in data)) {
    console.error('Missing navigationItems key')
    throw new Error('Invalid navigation data: missing navigationItems')
  }

  if (!Array.isArray(data.navigationItems)) {
    console.error('navigationItems is not an array', typeof data.navigationItems)
    throw new Error('Invalid navigation data: navigationItems must be an array')
  }

  // 额外的数据验证
  const invalidItems = data.navigationItems.filter((item: NavigationItem) =>
    !item.id ||
    !item.title ||
    (item.items && !Array.isArray(item.items)) ||
    (item.subCategories && !Array.isArray(item.subCategories))
  )

  if (invalidItems.length > 0) {
    // 只列可疑项的 id，不打整包：这几个对象可能各自挂着上千条站点
    const reported = invalidItems.slice(0, MAX_REPORTED_IDS).map((item: NavigationItem) => item.id || '(无 id)')
    console.error(
      `Invalid navigation items: ${invalidItems.length} 个类目结构不合法` +
        `（${reported.join(', ')}${invalidItems.length > reported.length ? ' …' : ''}）`,
    )
    throw new Error('Invalid navigation data: some items are malformed')
  }

  // 日志只记「这次到底写了多大一坨」，不记内容：
  // 原来是把整份 navigation.json 逐字节 JSON.stringify 打到 stdout——一次保存几 MB，
  // 后台多点几次保存就把容器日志盘撑满，而这份文档里全是用户可见的标题与描述。
  // 计数与字节数足够回答运维真正会问的问题（是不是空包？比上一版瘦了多少？）。
  const summary = summarizeNavigation(data)
  console.log(
    `Navigation save: ${summary.categories} 类目 / ${summary.subCategories} 子类 / ` +
      `${summary.items} 条站点, ${summary.bytes} bytes`,
  )

  await commitFile(
    NAVIGATION_FILE_PATH,
    JSON.stringify(data, null, 2),
    'Update navigation data',
    accessToken
  )
}

export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const data = await request.json()
    await validateAndSaveNavigationData(data, authCheck.githubToken || undefined)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to save navigation data:', error)
    return NextResponse.json(
      {
        error: 'Failed to save navigation data',
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
    await validateAndSaveNavigationData(data, authCheck.githubToken || undefined)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update navigation data:', error)
    return NextResponse.json(
      {
        error: 'Failed to update navigation data',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}