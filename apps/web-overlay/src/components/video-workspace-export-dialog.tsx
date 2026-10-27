'use client'

import React, { useState, useMemo } from 'react'
import {
  type BundledProjectWorkspace,
  buildWorkspaceFromCourse,
  exportToGistPayload,
} from '@/lib/video-workspace-bundler'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import {
  FolderArchive,
  FileCode,
  Download,
  Copy,
  Check,
  ExternalLink,
  Layers,
} from 'lucide-react'
import { copyText } from '@/lib/clipboard'

interface VideoWorkspaceExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  courseTitle: string
  videoId: string
  milestones?: Array<{ title: string; code: string; language?: string }>
  notes?: Array<{ userNote: string; codeSnippet?: string }>
}

export function VideoWorkspaceExportDialog({
  open,
  onOpenChange,
  courseTitle,
  videoId,
  milestones = [],
  notes = [],
}: VideoWorkspaceExportDialogProps) {
  const workspace = useMemo(() => {
    return buildWorkspaceFromCourse({
      courseTitle,
      videoId,
      milestoneCodeSnippets: milestones,
      notesList: notes,
    })
  }, [courseTitle, videoId, milestones, notes])

  const fileNames = useMemo(() => Object.keys(workspace.files), [workspace])
  const [selectedFile, setSelectedFile] = useState<string>(fileNames[0] || 'README.md')
  const [copied, setCopied] = useState<boolean>(false)

  const activeContent = workspace.files[selectedFile]?.content || ''

  const handleCopyGist = () => {
    const payload = exportToGistPayload(workspace)
    const text = JSON.stringify(payload, null, 2)
    void copyText(text).then((result) => {
      if (!result.ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleDownloadZipMock = () => {
    // Generate a downloadable text/json manifest bundle
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${workspace.name}-workspace.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderArchive className="w-5 h-5 text-primary" />
            <span>独立 Git 工程套件与云端 Gist 导出</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            将当前技术课程中的所有代码演进、避坑笔记、Dockerfile 与自动化配置文件一键打包为标准的工程脚手架。
          </p>

          {/* Workspace Explorer Container */}
          <div className="grid grid-cols-3 border rounded-lg overflow-hidden bg-card h-72">
            {/* Left file tree */}
            <div className="border-r bg-muted/30 p-2 space-y-1 overflow-y-auto">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1">
                工程文件清单 ({fileNames.length})
              </div>
              {fileNames.map((name) => (
                <button
                  key={name}
                  onClick={() => setSelectedFile(name)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-1.5 transition-colors ${
                    selectedFile === name
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'hover:bg-accent/40 text-muted-foreground'
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{name}</span>
                </button>
              ))}
            </div>

            {/* Right file content preview */}
            <div className="col-span-2 flex flex-col bg-zinc-950 font-mono text-[11px] text-zinc-200">
              <div className="px-3 py-1.5 border-b border-zinc-800 text-[10px] text-zinc-400 flex items-center justify-between">
                <span>{selectedFile}</span>
                <span>{workspace.files[selectedFile]?.language || 'text'}</span>
              </div>
              <pre className="p-3 flex-1 overflow-auto whitespace-pre-wrap leading-relaxed text-zinc-300">
                {activeContent}
              </pre>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-1">
            <div className="text-[11px] text-muted-foreground">
              工程总大小: {(workspace.totalBytes / 1024).toFixed(1)} KB · 包含 Docker 与自动化脚本
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleCopyGist}>
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? '已复制 Gist JSON' : '复制 GitHub Gist'}
              </Button>
              <Button size="sm" className="gap-1.5 text-xs" onClick={handleDownloadZipMock}>
                <Download className="w-3.5 h-3.5" />
                导出工程包
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
