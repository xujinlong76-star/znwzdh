'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/registry/new-york/ui/input'
import { Label } from '@/registry/new-york/ui/label'
import type { VideoHarvestPolicy } from '@/types/navigation'

interface HarvestPolicyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categoryTitle: string
  policy?: VideoHarvestPolicy
  onSave: (policy: VideoHarvestPolicy) => Promise<void>
}

export function HarvestPolicyDialog({
  open,
  onOpenChange,
  categoryTitle,
  policy,
  onSave,
}: HarvestPolicyDialogProps) {
  const [enabled, setEnabled] = useState(policy?.enabled ?? true)
  const [keywords, setKeywords] = useState((policy?.keywords || []).join(', '))
  const [syncSiteHotTrends, setSyncSiteHotTrends] = useState(policy?.syncSiteHotTrends ?? true)
  const [maxItems, setMaxItems] = useState(policy?.maxItems ?? 12)
  const [minQualityScore, setMinQualityScore] = useState(policy?.minQualityScore ?? 60)
  const [minDurationSec, setMinDurationSec] = useState(policy?.minDurationSec ?? 180)
  const [freshnessHalfLifeDays, setFreshnessHalfLifeDays] = useState(policy?.freshnessHalfLifeDays ?? 90)
  const [autoReplaceOutdated, setAutoReplaceOutdated] = useState(policy?.autoReplaceOutdated ?? true)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const parsedKeywords = keywords
        .split(/[,，\n]/)
        .map(k => k.trim())
        .filter(Boolean)

      const updatedPolicy: VideoHarvestPolicy = {
        enabled,
        keywords: parsedKeywords,
        syncSiteHotTrends,
        platforms: ['bilibili', 'youtube'],
        maxItems: Number(maxItems) || 12,
        minQualityScore: Number(minQualityScore) || 60,
        minDurationSec: Number(minDurationSec) || 180,
        freshnessHalfLifeDays: Number(freshnessHalfLifeDays) || 90,
        autoReplaceOutdated,
      }

      await onSave(updatedPolicy)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>「{categoryTitle}」自动采集与轮换策略</span>
          </DialogTitle>
          <DialogDescription>
            配置该分类的自动热点采集关键词、质量门槛与保鲜淘汰机制
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/40">
            <div>
              <div className="font-medium">启用本分类自动热点采集</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                开启后，系统将定期根据配置词搜索并自动收录优质视频
              </div>
            </div>
            <input
              type="checkbox"
              id="policy-enabled"
              aria-label="启用本分类自动热点采集"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="policy-keywords" className="text-xs font-medium">主题采集关键词 (以逗号隔开)</Label>
            <Input
              id="policy-keywords"
              placeholder="例如：Cursor 教程, MCP 协议, DeepSeek 实战"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              用于搜索匹配高赞视频，建议设置 3-6 个精准核心词。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="policy-hot-sync"
              checked={syncSiteHotTrends}
              onChange={(e) => setSyncSiteHotTrends(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <Label htmlFor="policy-hot-sync" className="text-xs cursor-pointer">
              自动融合本站热门站点与精选专题热词 (推荐)
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="policy-max-items" className="text-xs font-medium">分类最大容量 (个)</Label>
              <Input
                id="policy-max-items"
                type="number"
                min={3}
                max={50}
                value={maxItems}
                onChange={(e) => setMaxItems(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="policy-min-score" className="text-xs font-medium">最低准入质量分 (0-100)</Label>
              <Input
                id="policy-min-score"
                type="number"
                min={30}
                max={95}
                value={minQualityScore}
                onChange={(e) => setMinQualityScore(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="policy-min-duration" className="text-xs font-medium">最短时长过滤 (秒)</Label>
              <Input
                id="policy-min-duration"
                type="number"
                min={30}
                step={30}
                value={minDurationSec}
                onChange={(e) => setMinDurationSec(Number(e.target.value))}
              />
              <p className="text-[11px] text-muted-foreground">180秒 = 3分钟，过滤纯碎片短视频</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="policy-halflife" className="text-xs font-medium">保鲜半衰期 (天)</Label>
              <Input
                id="policy-halflife"
                type="number"
                min={15}
                max={365}
                value={freshnessHalfLifeDays}
                onChange={(e) => setFreshnessHalfLifeDays(Number(e.target.value))}
              />
              <p className="text-[11px] text-muted-foreground">AI资讯建议45天，基础架构建议90-120天</p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t">
            <input
              type="checkbox"
              id="policy-auto-replace"
              checked={autoReplaceOutdated}
              onChange={(e) => setAutoReplaceOutdated(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <Label htmlFor="policy-auto-replace" className="text-xs cursor-pointer">
              开启优胜劣汰：当容量满或内容过时时，允许用高分新视频自动替换
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={saving} onClick={handleSave}>
            {saving ? '保存中...' : '保存策略'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
