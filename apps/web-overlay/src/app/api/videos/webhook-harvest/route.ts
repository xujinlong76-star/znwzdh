import { NextResponse } from 'next/server'
import { mutateVideoLibrary } from '@/lib/video-library-store'
import type { NavigationData } from '@/types/navigation'
import {
  MultiSourceConnector,
  type WebhookPayload,
} from '@/lib/video-multi-source-connector'

export const runtime = 'nodejs'

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

    // 写库走统一入口：带 ifVersion 的读-改-写 + 冲突重放。
    // 此前是「读整份 → push → 覆盖写」，两个 webhook 同时到达会丢掉一条。
    const externalId = processRes.subItem.videoConfig?.bvid || processRes.subItem.videoConfig?.videoId
    const targetDomain = body.data.domain || 'cat_ai_engineering'
    const incoming = processRes.subItem

    const outcome = await mutateVideoLibrary<
      { kind: 'no-category' } | { kind: 'duplicate' } | { kind: 'created' }
    >(
      (data) => {
        const categories = data.navigationItems ?? []
        const targetCat = categories.find(c => c.id === targetDomain) ?? categories[0]
        if (!targetCat) {
          return { next: data, result: { kind: 'no-category' as const }, skip: true }
        }

        // 同一 externalId 重复投递不应产生重复条目（此前只靠 id 前缀，挡不住重放）
        const duplicated = externalId
          ? (targetCat.items ?? []).some(it => (it.videoConfig?.bvid || it.videoConfig?.videoId) === externalId)
          : false
        if (duplicated) {
          return { next: data, result: { kind: 'duplicate' as const }, skip: true }
        }

        // 不可变更新：mutate 会随冲突重试被调用多次，直接 push 会重复追加
        const next: NavigationData = {
          ...data,
          navigationItems: categories.map(cat =>
            cat.id === targetCat.id ? { ...cat, items: [...(cat.items ?? []), incoming] } : cat
          ),
        }
        return { next, result: { kind: 'created' as const } }
      },
      `[Webhook Harvest] Ingested video ${incoming.title}`
    )

    if (!outcome.ok) {
      // 409 不是失败而是「请重试」：调用方（GitHub Actions / IFTTT）通常自带重试
      return NextResponse.json(
        { code: 409, success: false, message: '视频库正在被并发修改，请稍后重试', retryable: true },
        { status: 409 }
      )
    }

    if (outcome.result.kind === 'no-category') {
      return NextResponse.json(
        { code: 422, message: '视频库没有任何分类，无法入库' },
        { status: 422 }
      )
    }

    if (outcome.result.kind === 'duplicate') {
      return NextResponse.json({
        code: 0,
        success: true,
        data: { message: '该视频已存在，跳过入库', course: { id: incoming.id, title: incoming.title } },
      })
    }

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
