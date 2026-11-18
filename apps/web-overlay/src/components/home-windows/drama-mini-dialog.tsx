'use client'

/**
 * 「短剧速览」按需小窗口（A1）：
 * 首页主区不再渲染 635px 深色剧场大板块，改为 36px 单行胶囊入口；
 * 点击弹出迷你短剧剧场窗，保留海报横滑、继续追、平台热播与 /drama 入口。
 */
import Link from 'next/link'
import { Clapperboard, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import { HomeDramaCinema, type CinemaInitialData } from '@/components/home-drama-cinema'

export interface DramaMiniDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: CinemaInitialData
}

export function DramaMiniDialog({ open, onOpenChange, initial }: DramaMiniDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px] w-[calc(100vw-1.5rem)] max-h-[84vh] flex flex-col gap-2 border-zinc-800 bg-zinc-950 p-4 text-zinc-100 overflow-hidden">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-white">
              <Clapperboard className="h-4 w-4 text-amber-400" />
              <span>短剧速览剧场</span>
            </DialogTitle>
            <Link
              href="/drama"
              className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-amber-300 hover:bg-zinc-900"
            >
              <span>完整短剧专区</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <DialogDescription className="text-xs text-zinc-400">
            即点即看热播短剧海报、本机继续追进度与全站片单。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto [&>section]:mx-0 [&>section]:my-0 [&>section]:max-w-none [&>section]:px-0">
          <HomeDramaCinema initial={initial} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
