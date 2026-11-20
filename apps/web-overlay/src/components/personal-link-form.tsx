'use client'

/**
 * 自定义链接表单（2026-11-20 20:00 战略研究 W9 落地）。
 *
 * 名称 + URL；仅 http/https，格式当场校验、错误就地提示；
 * 图标优先用本地 brand-icons（`resolveSiteIcon`），无匹配时用字母徽标，
 * 不自动抓取第三方 favicon。数据只存浏览器本地。
 */
import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePersonalData } from '@/hooks/usePersonalData'
import { useToast } from '@/components/ui/use-toast'
import { validateCustomLinkUrl } from '@/lib/personal-data'

interface PersonalLinkFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PersonalLinkForm({ open, onOpenChange }: PersonalLinkFormProps) {
  const personal = usePersonalData()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const checked = validateCustomLinkUrl(url)
    if (!checked.ok) {
      setError(checked.error)
      return
    }
    if (name.trim().length === 0) {
      setError('请给链接起个名字')
      return
    }
    const res = personal.addLink(name, url)
    if (!res.ok) {
      setError(res.error ?? '添加失败，请稍后重试')
      return
    }
    toast({ title: `已添加到「我的常用」：${name.trim()}` })
    setName('')
    setUrl('')
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            添加自定义链接
          </DialogTitle>
          <DialogDescription>名称 + 网址，只支持 http/https。只保存在你的浏览器里，不上传。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="personal-link-name">名称</Label>
            <Input
              id="personal-link-name"
              value={name}
              maxLength={40}
              placeholder="例如：我的博客"
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="personal-link-url">网址</Label>
            <Input
              id="personal-link-url"
              value={url}
              inputMode="url"
              placeholder="https://example.com"
              onChange={(e) => {
                setUrl(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            <p className="text-xs text-muted-foreground">只支持 http/https；不填协议时默认补 https://。图标优先用本站已有的本地图标，没有时显示字母徽标。</p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="button" onClick={submit}>
              添加到「我的常用」
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
