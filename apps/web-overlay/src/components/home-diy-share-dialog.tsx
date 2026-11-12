'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/registry/new-york/ui/alert-dialog'
import type { PendingHomeDiyShare } from '@/lib/modular/home-diy-storage'

export interface HomeDIYShareDialogProps {
  pendingShare: PendingHomeDiyShare | null
  onConfirm: () => void
  onDismiss: () => void
}

export function HomeDIYShareDialog({ pendingShare, onConfirm, onDismiss }: HomeDIYShareDialogProps) {
  const diff = pendingShare === null ? [] : pendingShare.diff
  const warning = pendingShare === null ? null : pendingShare.warning
  return (
    <AlertDialog open={Boolean(pendingShare)} onOpenChange={(open) => { if (open === false) onDismiss() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>应用这份分享排版？</AlertDialogTitle>
          <AlertDialogDescription>
            确认后，你的当前排版会先自动备份，再应用这份分享；应用后按 Ctrl+Z 可以撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {diff.length > 0 ? (
          <ul className='list-disc space-y-1 pl-5 text-sm'>
            {diff.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className='text-sm'>这份分享与你的当前排版完全一致，无需改动。</p>
        )}
        {warning === null ? null : <p className='text-sm text-amber-600'>{warning}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDismiss}>保留我的排版</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>应用分享排版</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
