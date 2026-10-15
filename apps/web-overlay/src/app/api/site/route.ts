import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { commitFile, getFileContent } from '@/lib/github'
import type { SiteInfo } from '@/types/site'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const data = await getFileContent('src/navsphere/content/site.json') as SiteInfo
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to read site data:', error)
    return NextResponse.json({
      basic: {
        title: '',
        description: '',
        keywords: ''
      },
      appearance: {
        logo: '',
        favicon: '',
        theme: 'system'
      },
      navigation: {
        linkTarget: '_blank'
      }
    })
  }
}

export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const data: SiteInfo = await request.json()

    // 提交到存储层（HTTP 适配器直存 NavHub / GitHub 适配器提交仓库）
    await commitFile(
      'src/navsphere/content/site.json',
      JSON.stringify(data, null, 2),
      'Update site configuration',
      authCheck.githubToken || undefined
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to save site data:', error)
    return NextResponse.json(
      { error: 'Failed to save site data' },
      { status: 500 }
    )
  }
}