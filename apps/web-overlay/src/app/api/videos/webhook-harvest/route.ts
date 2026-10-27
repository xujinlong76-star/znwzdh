import { NextResponse } from 'next/server'
import { getFileContent, commitFile } from '@/lib/github'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'
import {
  MultiSourceConnector,
  type WebhookPayload,
} from '@/lib/video-multi-source-connector'

export const runtime = 'nodejs'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

/**
 * 未配置密钥就是「关闭」，不是「用默认密钥」。
 *
 * 历史实现回落到了仓库里硬编码的 `navhub_video_webhook_secret_2026` —— 任何人读源码
 * 就能伪造合法请求，等于给匿名写入口。
 */
const WEBHOOK_SECRET = (process.env.NAVHUB_VIDEO_WEBHOOK_SECRET ?? '').trim()
const connector = new MultiSourceConnector(WEBHOOK_SECRET)

export async function GET() {
  try {
    const configured = Boolean(WEBHOOK_SECRET)
    return NextResponse.json({
      code: 0,
      data: {
        status: configured ? 'active' : 'disabled',
        // 不配置密钥时明确告知：该端点不会接受任何写入
        hint: configured ? undefined : '未配置 NAVHUB_VIDEO_WEBHOOK_SECRET，本端点已关闭',
        endpoint: '/api/videos/webhook-harvest',
        supportedSources: ['bilibili', 'youtube', 'github_trending', 'custom'],
        signatureAlgorithm: 'HMAC-SHA256 over raw body (Header: X-Hub-Signature-256, 必须带 sha256= 前缀)',
        description: '自动接收外部自动化流 (GitHub Actions / IFTTT / RSS Poller) 触发的视频发布事件并完成 AI 审核入库',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { code: 500, message: (error as Error).message },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    if (!WEBHOOK_SECRET) {
      return NextResponse.json(
        { code: 503, message: 'Webhook 入口未启用：缺少 NAVHUB_VIDEO_WEBHOOK_SECRET' },
        { status: 503 }
      )
    }

    const signature =
      request.headers.get('x-hub-signature-256') ||
      request.headers.get('x-webhook-signature') ||
      ''

    // 必须用原文验签：先 text() 再 parse，不能反过来。
    const rawBody = await request.text()

    let body: WebhookPayload
    try {
      body = JSON.parse(rawBody) as WebhookPayload
    } catch {
      return NextResponse.json(
        { code: 400, message: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    if (!body || !body.data || !body.data.id || !body.data.title) {
      return NextResponse.json(
        { code: 400, message: 'Invalid webhook payload structure: missing data.id or data.title' },
        { status: 400 }
      )
    }

    const processRes = connector.processWebhook(body, signature, rawBody)

    if (!processRes.ok || !processRes.subItem) {
      // 签名失败是鉴权问题（401），内容未过审是 422 —— 分开才能被监控区分
      const isAuthFailure = processRes.message.includes('签名') || processRes.message.includes('密钥')
      return NextResponse.json(
        {
          code: isAuthFailure ? 401 : 422,
          success: false,
          message: processRes.message,
          evaluation: processRes.evaluation,
        },
        { status: isAuthFailure ? 401 : 422 }
      )
    }

    // Persist into videos.json if valid
    const currentData = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData
    const categories = currentData.navigationItems || []
    const targetDomain = body.data.domain || 'cat_ai_engineering'

    let targetCat = categories.find(c => c.id === targetDomain)
    if (!targetCat) {
      targetCat = categories[0]
    }

    if (!targetCat) {
      return NextResponse.json(
        { code: 422, message: '视频库没有任何分类，无法入库' },
        { status: 422 }
      )
    }

    targetCat.items = targetCat.items || []
    // 同一 externalId 重复投递不应产生重复条目（此前只靠 id 前缀，挡不住重放）
    const externalId = processRes.subItem.videoConfig?.bvid || processRes.subItem.videoConfig?.videoId
    const duplicated = externalId
      ? targetCat.items.some(it => (it.videoConfig?.bvid || it.videoConfig?.videoId) === externalId)
      : false

    if (duplicated) {
      return NextResponse.json({
        code: 0,
        success: true,
        data: { message: '该视频已存在，跳过入库', course: { id: processRes.subItem.id, title: processRes.subItem.title } },
      })
    }

    targetCat.items.push(processRes.subItem)

    // 写失败必须冒泡：此前 catch + console.warn 后仍返回「处理成功且通过 AI 深度审核」。
    await commitFile(
      VIDEOS_FILE_PATH,
      JSON.stringify(currentData, null, 2),
      `[Webhook Harvest] Ingested video ${processRes.subItem.title}`
    )

    return NextResponse.json({
      code: 0,
      success: true,
      data: {
        message: 'Webhook 处理成功，已通过规则初筛（关键词 / 时长 / 互动加权）',
        course: {
          id: processRes.subItem.id,
          title: processRes.subItem.title,
          qualityScore: processRes.subItem.videoConfig?.qualityScore,
          chaptersCount: processRes.subItem.videoConfig?.chapters?.length || 0,
        },
        evaluation: processRes.evaluation,
      },
    })
  } catch (error) {
    console.error('Webhook harvest handler failed:', error)
    return NextResponse.json(
      { code: 500, message: (error as Error).message, retryable: true },
      { status: 500 }
    )
  }
}
