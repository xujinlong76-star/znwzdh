'use client'

/**
 * DIY 配置漫游与备份弹窗（P1-2 组件拆分，从 home-diy-toolbar.tsx 抽出）。
 *
 * 原实现把 230 行 JSX + 12 个 state + 8 个 handler 塞在 1307 行的工具栏里。
 * 这个弹窗只依赖 useHomeDIY 暴露的一组函数（通过 props 注入，不自己持有
 * DIY 状态），因此可以独立演进，也让工具栏回到「一个浮动按钮 + 几个菜单」。
 *
 * 三种能力一应俱全：
 *   1. 明文 JSON：复制 / 下载 / 选文件导入 / 粘贴导入，外加免登 URL-Hash 分享链接；
 *   2. 零知识 E2EE：PBKDF2(100k) 派生密钥的 AES-256-GSM 密文复制 / 下载 / 解密还原；
 *   3. 中枢云端金库：端侧加密后直传，新设备同主密码一键拉取。
 */
import { useEffect, useRef, useState } from 'react'
import {
  Cloud,
  CloudDownload,
  CloudUpload,
  Copy,
  Download,
  Lock,
  ShieldCheck,
  Sparkles,
  Unlock,
  Upload,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import { Input } from '@/registry/new-york/ui/input'
import { Textarea } from '@/registry/new-york/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { copyFailureToast, copyText } from '@/lib/clipboard'
import type { ShareLinkOutcome } from '@/lib/diy-share-link'
import { cn } from '@/lib/utils'

export interface HomeDIYBackupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /* ---- 由 useHomeDIY 注入（组件不持有 DIY 状态） ---- */
  exportPresetToUrlHash: () => ShareLinkOutcome
  exportDIYConfig: () => string
  importDIYConfig: (json: string) => { ok: boolean; message: string }
  exportEncryptedDIYConfig: (passphrase: string) => Promise<string>
  importEncryptedDIYConfig: (json: string, passphrase: string) => Promise<{ ok: boolean; message: string }>
  syncToCloudVault: (passphrase: string) => Promise<{ success: boolean; version?: number; error?: string }>
  syncFromCloudVault: (passphrase: string) => Promise<{ success: boolean; error?: string }>
  checkCloudVaultStatus: () => Promise<{ hasCloudVault: boolean; updatedAt?: number; version?: number }>
}

interface CloudVaultMeta {
  hasCloudVault: boolean
  updatedAt?: number
  version?: number
}

export function HomeDIYBackupDialog({
  open,
  onOpenChange,
  exportPresetToUrlHash,
  exportDIYConfig,
  importDIYConfig,
  exportEncryptedDIYConfig,
  importEncryptedDIYConfig,
  syncToCloudVault,
  syncFromCloudVault,
  checkCloudVaultStatus,
}: HomeDIYBackupDialogProps) {
  const { toast } = useToast()
  const [backupTab, setBackupTab] = useState<'plain' | 'e2ee'>('plain')
  const [vaultPassphrase, setVaultPassphrase] = useState('')
  const [isDecrypting, setIsDecrypting] = useState(false)
  const [isSyncingCloud, setIsSyncingCloud] = useState(false)
  const [cloudVaultMeta, setCloudVaultMeta] = useState<CloudVaultMeta | null>(null)
  const [importJsonText, setImportJsonText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 切换至 E2EE 或打开备份弹窗时自动拉取云端金库元信息
  useEffect(() => {
    if (open && backupTab === 'e2ee') {
      void checkCloudVaultStatus().then(setCloudVaultMeta)
    }
  }, [open, backupTab, checkCloudVaultStatus])

  // 云端金库一键加密同步推送
  const handleCloudUpload = async () => {
    if (!vaultPassphrase.trim() || vaultPassphrase.length < 6) {
      toast({
        title: '请输入 6 位以上的主密码',
        description: '云端同步需要主密码以执行端侧零知识加密。',
        variant: 'destructive',
      })
      return
    }
    setIsSyncingCloud(true)
    try {
      const res = await syncToCloudVault(vaultPassphrase.trim())
      if (res.success) {
        toast({
          title: '☁️ 已加密同步至中枢云端',
          description: `DIY 配置已安全保存至云端金库 (版本 v${res.version})。`,
        })
        const status = await checkCloudVaultStatus()
        setCloudVaultMeta(status)
      } else {
        toast({ title: '云端同步失败', description: res.error, variant: 'destructive' })
      }
    } finally {
      setIsSyncingCloud(false)
    }
  }

  // 从云端金库一键拉取并解密还原
  const handleCloudDownload = async () => {
    if (!vaultPassphrase.trim()) {
      toast({
        title: '请输入解密主密码',
        description: '请输入保存该云端金库时设定的主密码以解密。',
        variant: 'destructive',
      })
      return
    }
    setIsSyncingCloud(true)
    try {
      const res = await syncFromCloudVault(vaultPassphrase.trim())
      if (res.success) {
        toast({
          title: '🎉 成功从云端金库拉取并还原配置',
          description: '排版偏好、专属私人分类与置顶站点已全量还原！',
        })
        onOpenChange(false)
      } else {
        toast({ title: '云端拉取或解密校验失败', description: res.error, variant: 'destructive' })
      }
    } finally {
      setIsSyncingCloud(false)
    }
  }

  const handleShareUrlHash = async () => {
    const out = exportPresetToUrlHash()
    // 生成失败以前是 `if (!url) return`：点了分享按钮毫无反应，
    // 用户只会以为按钮坏了。现在把原因说出来（编码见 lib/diy-share-link.ts）。
    if (!out.ok) {
      toast({ title: '❌ 分享链接生成失败', description: out.reason, variant: 'destructive' })
      return
    }
    // 分享链接全靠剪贴板；写不进去就必须说，不能宣告「已复制」
    const result = await copyText(out.url)
    if (!result.ok) {
      toast({ ...copyFailureToast(result), variant: 'destructive' })
      return
    }
    toast({
      title: '🔗 已复制免登专属分享链接！',
      description: '好友直接在浏览器打开该链接，即可一键预览并应用您的专属排版与壁纸。',
    })
  }

  const handleCopyConfig = async () => {
    const json = exportDIYConfig()
    const result = await copyText(json)
    if (!result.ok) {
      toast({ ...copyFailureToast(result), variant: 'destructive' })
      return
    }
    toast({
      title: '📋 配置已复制到剪贴板',
      description: '您可以将配置妥善保管或分享给其他设备。',
    })
  }

  // 下载配置为 .json 文件
  const handleDownloadConfig = () => {
    const json = exportDIYConfig()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `navhub-diy-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: '💾 配置文件已下载', description: '已成功导出为本地 JSON 备份文件。' })
  }

  // 复制加密密文到剪贴板
  const handleCopyEncryptedConfig = async () => {
    if (!vaultPassphrase.trim()) {
      toast({ title: '请输入主密码', description: '需要输入主密码用于派生 AES-256 密钥。', variant: 'destructive' })
      return
    }
    try {
      const encryptedJson = await exportEncryptedDIYConfig(vaultPassphrase.trim())
      const result = await copyText(encryptedJson)
      if (!result.ok) {
        toast({ ...copyFailureToast(result), variant: 'destructive' })
        return
      }
      toast({
        title: '🔐 已复制零知识加密密文',
        description: '配置数据已通过 AES-256-GCM 高度认证加密。',
      })
    } catch (e: unknown) {
      toast({ title: '加密失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  // 下载加密备份文件 (.enc.json)
  const handleDownloadEncryptedConfig = async () => {
    if (!vaultPassphrase.trim()) {
      toast({ title: '请输入主密码', description: '需要输入主密码用于派生 AES-256 密钥。', variant: 'destructive' })
      return
    }
    try {
      const encryptedJson = await exportEncryptedDIYConfig(vaultPassphrase.trim())
      const blob = new Blob([encryptedJson], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `navhub-diy-vault-${new Date().toISOString().slice(0, 10)}.enc.json`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: '💾 加密金库备份已下载', description: '已成功导出 AES-256-GCM 零知识安全密文文件。' })
    } catch (e: unknown) {
      toast({ title: '加密失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  // 导入明文配置
  const handleImportSubmit = () => {
    if (!importJsonText.trim()) return
    const res = importDIYConfig(importJsonText.trim())
    toast({ title: res.ok ? '🎉 导入成功' : '导入失败', description: res.message })
    if (res.ok) {
      onOpenChange(false)
      setImportJsonText('')
    }
  }

  // 解密并还原加密配置
  const handleDecryptImportSubmit = async () => {
    if (!importJsonText.trim()) {
      toast({ title: '请输入密文内容', description: '请粘贴或上传加密密文文件。', variant: 'destructive' })
      return
    }
    if (!vaultPassphrase.trim()) {
      toast({ title: '请输入主密码', description: '需要输入加密时设置的主密码以解密。', variant: 'destructive' })
      return
    }

    setIsDecrypting(true)
    try {
      const res = await importEncryptedDIYConfig(importJsonText.trim(), vaultPassphrase.trim())
      toast({
        title: res.ok ? '🎉 解密恢复成功' : '解密恢复失败',
        description: res.message,
        variant: res.ok ? 'default' : 'destructive',
      })
      if (res.ok) {
        onOpenChange(false)
        setImportJsonText('')
        setVaultPassphrase('')
      }
    } finally {
      setIsDecrypting(false)
    }
  }

  // 读取上传的 JSON 文件
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      if (content) {
        setImportJsonText(content)
      }
    }
    reader.readAsText(file)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-xl max-h-[85dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pb-3 border-b border-border/50 pr-8 sm:pr-6">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Download className="w-5 h-5 text-primary" />
            <span>DIY 配置漫游与备份分享</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            支持导出您的排版偏好、专属分类与置顶站点，或通过零知识端到端加密安全漫游。
          </DialogDescription>
        </DialogHeader>

        {/* 模式切换胶囊 */}
        <div className="flex p-1 rounded-xl bg-muted/60 border border-border/50 text-xs font-medium">
          <button
            type="button"
            onClick={() => setBackupTab('plain')}
            className={cn(
              "flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5",
              backupTab === 'plain'
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Copy className="w-3.5 h-3.5" />
            <span>明文 JSON 备份与迁移</span>
          </button>
          <button
            type="button"
            onClick={() => setBackupTab('e2ee')}
            className={cn(
              "flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5",
              backupTab === 'e2ee'
                ? "bg-violet-600 text-white shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>零知识 E2EE 金库加密</span>
          </button>
        </div>

        {backupTab === 'plain' ? (
          /* 明文 JSON 模式 */
          <div className="py-2 space-y-3.5">
            <div className="space-y-2">
              <Button size="sm" onClick={handleShareUrlHash} className="w-full text-xs gap-1.5 bg-violet-600 hover:bg-violet-700 text-white shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>复制免登专属分享链接 (URL-Hash)</span>
              </Button>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Button size="sm" variant="outline" onClick={handleCopyConfig} className="text-xs gap-1.5">
                  <Copy className="w-3.5 h-3.5" />
                  <span>复制配置 JSON</span>
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownloadConfig} className="text-xs gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  <span>下载备份文件</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>选择文件导入</span>
                </Button>
                <input
                  aria-label="导入自定义配置 JSON 文件"
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            </div>

            <div>
              <label htmlFor="diy-import-plain" className="text-xs font-medium text-foreground block mb-1">
                导入明文 JSON 配置文本：
              </label>
              <Textarea id="diy-import-plain"
                placeholder="粘贴已备份的 NavHub DIY JSON 配置代码..."
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                className="font-mono text-xs h-32 resize-none"
              />
            </div>
          </div>
        ) : (
          /* 零知识 E2EE 加密模式 */
          <div className="py-2 space-y-3.5">
            <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-foreground">
                <Lock className="w-3.5 h-3.5 text-violet-500" />
                <span>端侧 AES-256-GCM 零知识安全加解密</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                通过 PBKDF2 (100,000 次哈希迭代) 派生主密钥，密文包含认证防篡改标签（Auth Tag）。即使通过未加密渠道分享密文文件，无主密码任何人均无法还原。
              </p>
            </div>

            <div>
              <label htmlFor="diy-vault-passphrase" className="text-xs font-medium text-foreground block mb-1">
                金库主密码 (Passphrase) *
              </label>
              <Input id="diy-vault-passphrase"
                type="password"
                placeholder="输入加密主密码 (加解密需保持一致)..."
                value={vaultPassphrase}
                onChange={(e) => setVaultPassphrase(e.target.value)}
              />
            </div>

            {/* 中枢云端金库同步协同 */}
            <div className="p-3.5 rounded-xl bg-violet-500/5 border border-violet-500/25 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Cloud className="w-4 h-4 text-violet-500" />
                  <span>NavHub 中枢云端金库同步</span>
                </div>
                {cloudVaultMeta?.hasCloudVault ? (
                  <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
                    云端金库 v{cloudVaultMeta.version}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    云端暂无备份
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                端侧加密后直传中枢存储，服务端零知识（无法获知内容）。新设备输入相同主密码即可一键拉取还原。
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-0.5">
                <Button
                  size="sm"
                  onClick={handleCloudUpload}
                  disabled={!vaultPassphrase.trim() || isSyncingCloud}
                  className="flex-1 text-xs gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                >
                  <CloudUpload className="w-3.5 h-3.5" />
                  <span>{isSyncingCloud ? '同步中...' : '加密同步至云端'}</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCloudDownload}
                  disabled={!vaultPassphrase.trim() || isSyncingCloud}
                  className="flex-1 text-xs border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                >
                  <CloudDownload className="w-3.5 h-3.5" />
                  <span>从云端拉取解密</span>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyEncryptedConfig}
                disabled={!vaultPassphrase.trim()}
                className="text-xs gap-1.5 flex-1 min-w-[calc(50%-0.25rem)] sm:min-w-0 border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
              >
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">复制加密密文</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadEncryptedConfig}
                disabled={!vaultPassphrase.trim()}
                className="text-xs gap-1.5 flex-1 min-w-[calc(50%-0.25rem)] sm:min-w-0 border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">下载 .enc.json</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs gap-1.5 flex-1 min-w-[calc(50%-0.25rem)] sm:min-w-0"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">选择密文文件</span>
              </Button>
            </div>

            <div>
              <label htmlFor="diy-import-encrypted" className="text-xs font-medium text-foreground block mb-1">
                密文数据载荷 (Payload)：
              </label>
              <Textarea id="diy-import-encrypted"
                placeholder="粘贴或上传导出的 .enc.json 密文数据..."
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                className="font-mono text-xs h-28 resize-none"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          {backupTab === 'plain' ? (
            <Button size="sm" onClick={handleImportSubmit} disabled={!importJsonText.trim()}>
              确认导入并应用
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleDecryptImportSubmit}
              disabled={!importJsonText.trim() || !vaultPassphrase.trim() || isDecrypting}
              className="bg-violet-600 hover:bg-violet-700 text-white font-medium gap-1.5"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>{isDecrypting ? '解密校验中...' : '解密并还原首页配置'}</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
