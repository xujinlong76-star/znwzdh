'use client'

/**
 * 「我的数据与隐私」页（2026-11-20 20:00 战略研究 W9 落地）。
 *
 * 一屏说明 + 存储用量 + 导出/导入/清除入口。
 * 全部操作只动浏览器本地存储；导入前先把当前数据备份进内存供撤销；
 * 坏文件拒绝并提示，绝不覆盖现有数据。
 */
import { useRef, useState } from 'react'
import { CloudOff, Download, HardDrive, ShieldCheck, Trash2, Undo2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePersonalData, downloadTextFile } from '@/hooks/usePersonalData'
import { PersonalBackupReminder } from '@/components/personal-backup-reminder'
import { useToast } from '@/components/ui/use-toast'
import { PERSONAL_FORMAT_VERSION } from '@/lib/personal-data'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function PersonalDataPage() {
  const personal = usePersonalData()
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace')
  const [imported, setImported] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data } = personal

  const usage = personal.usageBytes()

  const handleExport = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    downloadTextFile(`znw-personal-data-v${PERSONAL_FORMAT_VERSION}-${stamp}.json`, personal.exportJson())
    toast({ title: '已导出备份文件', description: '文件里只有收藏、分组与偏好，不含浏览历史与搜索词' })
  }

  const handleImportFile = async (file: File) => {
    setBusy(true)
    try {
      const text = await file.text()
      const res = personal.importJson(text, importMode)
      if (!res.ok) {
        toast({ title: '导入失败，现有数据没动', description: res.error ?? '文件内容不对', variant: 'destructive' })
        return
      }
      setImported(true)
      toast({ title: '导入成功', description: importMode === 'replace' ? '已替换为备份文件里的内容' : '已按 id 合并备份文件里的内容' })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleClear = () => {
    if (!window.confirm('确定清除全部「我的常用」个人数据吗？包括置顶、自定义链接、场景分组与本地最近使用。此操作不可恢复（建议先导出备份）。')) {
      return
    }
    personal.clearAll()
    setImported(false)
    toast({ title: '已清除全部个人数据', description: '首页「我的常用」区已恢复默认折叠状态' })
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-500" />
          我的数据与隐私
        </h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          「我的常用」里的数据——置顶收藏、自定义链接、场景分组、本地最近使用——
          <strong className="text-foreground">只在你的浏览器里，本站服务器看不到，也不会上传到任何地方。</strong>
          没有账号、没有自动同步；换浏览器或清掉浏览器数据后，这些内容需要用下面的导出文件自己带走。
        </p>
      </div>

      <section className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-2" aria-label="当前数据">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          当前本地数据
        </h2>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs">置顶收藏</dt>
            <dd className="font-mono" data-testid="personal-count-pinned">{data.pinned.length} / 24</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">自定义链接</dt>
            <dd className="font-mono" data-testid="personal-count-links">{data.customLinks.length}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">场景分组</dt>
            <dd className="font-mono" data-testid="personal-count-scenes">{data.scenes.length}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">本地占用</dt>
            <dd className="font-mono" data-testid="personal-usage">{formatBytes(usage)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          最近使用记录{data.prefs.recordRecent ? '已开启' : '已关闭'}；
          本页数字只统计本机「我的常用」相关键，不含收藏夹、排版等其它本地数据。
        </p>
        {personal.corrupt ? (
          <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
            检测到本地个人数据曾损坏，已隔离保护。原数据仍在浏览器里（键名以 .corrupt. 结尾），可联系站长协助恢复。
          </p>
        ) : null}
        {personal.storageBlocked ? (
          <p role="alert" className="text-xs text-destructive">{personal.storageBlocked}</p>
        ) : null}
      </section>

      {/* 备份提醒（2026-11-27 命令面板 v2）：超过 14 天未导出时的一行轻提醒，可关闭、不弹窗 */}
      <PersonalBackupReminder onExport={handleExport} />

      <section className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3" aria-label="导出与导入">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Download className="h-4 w-4 text-muted-foreground" />
          导出 / 导入
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          导出为 JSON 文件（含版本号与校验），可存到自己的电脑或 U 盘；导入时先校验结构，
          坏文件会被拒绝、现有数据不动。导入前当前数据会自动备份进内存，可一键撤销。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" data-testid="personal-export" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1.5" />
            导出我的数据
          </Button>
          <label className="text-xs text-muted-foreground flex items-center gap-1.5">
            导入方式
            <select
              aria-label="导入方式"
              value={importMode}
              onChange={(e) => setImportMode(e.target.value as 'replace' | 'merge')}
              className="rounded-md border border-border/70 bg-background px-2 py-1 text-xs"
            >
              <option value="replace">替换现有数据</option>
              <option value="merge">与现有数据合并</option>
            </select>
          </label>
          <Button type="button" variant="outline" data-testid="personal-import" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" />
            从文件导入
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="选择备份文件"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImportFile(file)
            }}
          />
          {imported ? (
            <Button
              type="button"
              variant="ghost"
              data-testid="personal-undo-import"
              onClick={() => {
                if (personal.undoImport()) {
                  setImported(false)
                  toast({ title: '已撤销导入，恢复到导入前的数据' })
                } else {
                  toast({ title: '没有可撤销的导入', variant: 'destructive' })
                }
              }}
            >
              <Undo2 className="h-4 w-4 mr-1.5" />
              撤销导入
            </Button>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3" aria-label="清除数据">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-destructive">
          <Trash2 className="h-4 w-4" />
          清除全部个人数据
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          一键清除置顶、自定义链接、场景分组、本地最近使用与记录开关；首页「我的常用」区恢复默认折叠状态。
          清除只动浏览器本地，不影响收藏夹、自定义分类等其它本地数据。
        </p>
        <Button type="button" variant="destructive" data-testid="personal-clear-all" onClick={handleClear}>
          <Trash2 className="h-4 w-4 mr-1.5" />
          清除全部个人数据
        </Button>
      </section>

      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <CloudOff className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        本页所有操作都不联网；导出文件请自己保管，丢了本站无法帮你找回。
      </p>
    </div>
  )
}
