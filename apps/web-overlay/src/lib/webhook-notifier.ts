/**
 * 视频采集与内容轮换 Webhook 消息通知引擎
 * 
 * 支持飞书 (Lark)、钉钉 (DingTalk)、企业微信、Slack 及通用 JSON Webhook，
 * 将自动采集轮换执行产出的结构化摘要推送给站长与运维团队。
 */

import type { VideoHarvestReport } from './video-harvester'

export interface WebhookConfig {
  url?: string
  platform?: 'feishu' | 'dingtalk' | 'wecom' | 'slack' | 'generic'
}

/**
 * 生成 Markdown 格式的采集与轮换简报。
 *
 * 历史问题：本函数读的是 `report.dryRun` / `categoriesProcessed` / `totalHarvested` /
 * `summary.freshnessScoreAverage` / `details[]` —— 这套字段**不属于** `VideoHarvestReport`
 * （真实字段是 totalCheckedCategories / totalAddedCount / totalReplacedCount /
 * categorySummaries / degradedKeywords）。两套结构从未对齐，只是因为类型名
 * `HarvestRunReport` 根本不存在、又被 `ignoreBuildErrors` 放行，才一直没报错。
 *
 * 后果：配置 HARVEST_WEBHOOK_URL 后，`report.summary.freshnessScoreAverage` 会抛
 * TypeError，而调用方是 `void sendHarvestWebhookNotification(...)` → unhandled rejection。
 */
export function formatHarvestMarkdownReport(report: VideoHarvestReport): string {
  const lines: string[] = []
  lines.push('### 🚀 NavHub 视频知识库自动巡检与轮换简报')
  lines.push(`> 执行时间: ${new Date(report.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)
  lines.push(`- **巡检分类**: ${report.totalCheckedCategories} 个`)
  lines.push(`- **本次新入库**: **${report.totalAddedCount}** 部`)
  lines.push(`- **替换过时内容**: **${report.totalReplacedCount}** 部`)

  const scanned = report.categorySummaries ?? []
  const withItems = scanned.filter(c => c.currentCount > 0)
  const avgFreshness = withItems.length > 0
    ? Math.round(withItems.reduce((sum, c) => sum + c.averageFreshness, 0) / withItems.length)
    : 100
  lines.push(`- **全库平均新鲜度**: ${avgFreshness} 分`)

  const changed = scanned.filter(c => c.addedCount > 0 || c.replacedCount > 0)
  if (changed.length > 0) {
    lines.push('', '#### 📌 各分类变更详情:')
    for (const c of changed) {
      lines.push(
        `- **${c.categoryTitle}**: 新增 +${c.addedCount}，替换 -${c.replacedCount}（当前均分 ${c.averageFreshness}）`
      )
    }
  }

  const degraded = report.degradedKeywords ?? []
  if (degraded.length > 0) {
    lines.push('', `#### ⚠️ 采集失败/跳过的关键词（${degraded.length}）:`)
    for (const d of degraded.slice(0, 10)) {
      lines.push(`- \`${d.keyword}\`：${d.reason}`)
    }
    if (degraded.length > 10) lines.push(`- …另有 ${degraded.length - 10} 条`)
  }

  return lines.join('\n')
}

/**
 * 分发推送 Webhook 告警通知
 */
export async function sendHarvestWebhookNotification(
  report: VideoHarvestReport,
  config?: WebhookConfig
): Promise<{ success: boolean; error?: string }> {
  const webhookUrl = config?.url || process.env.HARVEST_WEBHOOK_URL
  if (!webhookUrl) {
    return { success: true } // 未配置时静默忽略
  }

  try {
    // 放在 try 内：格式化本身也可能因为脏数据抛错，
    // 之前它在 try 外，调用方又是 `void ...` → unhandled rejection。
    const markdownContent = formatHarvestMarkdownReport(report)
    let payload: Record<string, unknown>

    if (webhookUrl.includes('feishu.cn') || webhookUrl.includes('larksuite.com')) {
      // 飞书富文本/卡片消息
      payload = {
        msg_type: 'interactive',
        card: {
          header: {
            title: {
              tag: 'plain_text',
              content: `🎬 视频库自动轮换通知 [${report.dryRun ? '预览（未写库）' : '已应用'}]`
            },
            template: report.totalReplacedCount > 0 ? 'orange' : 'blue'
          },
          elements: [
            {
              tag: 'markdown',
              content: markdownContent
            }
          ]
        }
      }
    } else if (webhookUrl.includes('dingtalk.com')) {
      // 钉钉 Markdown 消息
      payload = {
        msgtype: 'markdown',
        markdown: {
          title: '🎬 视频知识库自动轮换报告',
          text: markdownContent
        }
      }
    } else if (webhookUrl.includes('slack.com')) {
      // Slack 消息
      payload = {
        text: `*🎬 视频知识库自动轮换报告*\n\n${markdownContent}`
      }
    } else {
      // 通用 Webhook 规范
      payload = {
        event: 'video.harvest.completed',
        report,
        markdown: markdownContent,
        sentAt: Date.now()
      }
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    })

    if (!response.ok) {
      const errText = await response.text()
      return { success: false, error: `Webhook returned HTTP ${response.status}: ${errText}` }
    }

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[WebhookNotifier] Failed to send notification:', err)
    return { success: false, error: msg }
  }
}
