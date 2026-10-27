'use client'

import React, { useState, useMemo } from 'react'
import {
  evaluateBadges,
  issueVerifiableCertificate,
  renderCertificateSvg,
  type AchievementBadge,
} from '@/lib/video-credential-issuer'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Award, Download, Check, ShieldCheck, Sparkles } from 'lucide-react'

interface VideoCertificateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  videoTitle: string
  notesCount: number
  quizScorePercent?: number
}

export function VideoCertificateDialog({
  open,
  onOpenChange,
  videoTitle,
  notesCount,
  quizScorePercent = 100,
}: VideoCertificateDialogProps) {
  const [studentName, setStudentName] = useState('云原生开发者')

  const badges = useMemo(() => {
    return evaluateBadges({
      watchProgressPercent: 100,
      quizScorePercent,
      notesCount,
      sandboxesRunCount: 1,
    })
  }, [quizScorePercent, notesCount])

  const cert = useMemo(() => {
    return issueVerifiableCertificate({
      recipientName: studentName || '云原生开发者',
      courseTitle: videoTitle,
      scorePercent: quizScorePercent,
      badges,
    })
  }, [studentName, videoTitle, quizScorePercent, badges])

  const svgMarkup = useMemo(() => {
    return renderCertificateSvg(cert)
  }, [cert])

  const handleDownload = () => {
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${studentName}_${videoTitle}_结业认证.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Award className="w-5 h-5 text-amber-400" />
            <span>专业技能结业凭证与徽章认证</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          {/* Recipient name input */}
          <div className="flex items-center gap-2">
            <label htmlFor="certificate-student-name" className="text-[11px] font-medium text-foreground shrink-0">学员姓名 / 称呼：</label>
            <input id="certificate-student-name"
              type="text"
              value={studentName}
              onChange={e => setStudentName(e.target.value)}
              placeholder="输入您的姓名或开源 ID"
              className="px-2.5 py-1 text-xs rounded-md bg-muted border border-border/50 focus:outline-none flex-1"
            />
          </div>

          {/* Certificate SVG preview */}
          <div
            className="w-full aspect-[1000/700] rounded-xl overflow-hidden border border-border shadow-2xl bg-zinc-950 flex items-center justify-center p-1"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />

          {/* Unlocked Badges list */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-muted-foreground">已解锁核心成就徽章：</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {badges.map(b => (
                <div
                  key={b.id}
                  className={`p-2 rounded-lg border text-center space-y-1 ${
                    b.unlocked
                      ? 'bg-amber-500/10 border-amber-500/30 text-foreground'
                      : 'bg-muted/40 border-border/40 opacity-40'
                  }`}
                >
                  <span className="text-xl">{b.icon}</span>
                  <div className="font-bold text-[11px]">{b.name}</div>
                  <div className="text-[9px] text-muted-foreground leading-tight">{b.description}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t text-muted-foreground text-[11px]">
            <span className="flex items-center gap-1 font-mono text-[10px]">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              防伪标识: {cert.credentialId}
            </span>

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button size="sm" className="gap-1.5" onClick={handleDownload}>
                <Download className="w-3.5 h-3.5" />
                导出高清证书 (SVG)
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
