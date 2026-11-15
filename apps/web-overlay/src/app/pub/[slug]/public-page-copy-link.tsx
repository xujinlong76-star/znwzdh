'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'
import { publicPageUrl } from '@/lib/public-pages'

/**
 * 公开导航页的「复制链接」按钮（只读页上唯一的交互）。
 *
 * 复制失败不静默：按钮文案会变成「复制失败，手动复制地址栏」，不让用户
 * 以为复制成功了才发现发出去的是空剪贴板。
 */
export default function PublicPageCopyLink({ slug }: { slug: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const handleCopy = async () => {
    const result = await copyText(publicPageUrl(slug))
    setState(result.ok ? 'copied' : 'failed')
    if (result.ok) {
      window.setTimeout(() => setState('idle'), 2000)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} className="min-h-11">
      {state === 'copied' ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {state === 'copied' ? '链接已复制' : state === 'failed' ? '复制失败，请手动复制地址栏' : '复制公开链接'}
    </Button>
  )
}
