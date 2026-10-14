import { NextResponse } from 'next/server'
import { getFileContent } from '@/lib/github'

export const runtime = 'edge'

const NAVIGATION_PATH = 'src/navsphere/content/navigation.json'

export async function GET() {
  try {
    const data = await getFileContent(NAVIGATION_PATH)
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate',
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    console.error('Error in navigation API:', error)
    return NextResponse.json(
      { error: '获取导航数据失败' },
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
  }
}