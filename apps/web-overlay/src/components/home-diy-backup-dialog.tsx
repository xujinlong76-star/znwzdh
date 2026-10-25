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
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Cloud,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Copy,
  Download,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
  Upload,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  VAULT_REBUILD_ACTION_LABEL,
  VAULT_REBUILD_FIRST_VERSION,
  VAULT_REBUILD_VERSION_COPY,
  cloudPullFailureNotice,
  cloudVaultBadgeLabel,
  mergeCloudVaultMeta,
} from '@/lib/modular/vault-copy'
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
import type {
  CloudVaultClearResult,
  CloudVaultConflictKind,
  CloudVaultSyncResult,
  HomeDiyImportResult,
  VaultPushRefusalReason,
} from '@/lib/modular/home-diy-io'
import {
  resolveVaultPushPrecondition,
  vaultPullOutcome,
  vaultPushRefusalCode,
  vaultPushRefusalNotice,
  vaultStatusOutcome,
} from '@/lib/modular/home-diy-io'
import { trackVaultEvent, type VaultResultCode } from '@/lib/navhub-api'
import { newRequestGate, settleLatest } from '@/lib/latest-request'
import { cn } from '@/lib/utils'

export interface HomeDIYBackupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /* ---- 由 useHomeDIY 注入（组件不持有 DIY 状态） ---- */
  exportPresetToUrlHash: () => ShareLinkOutcome
  exportDIYConfig: () => string
  importDIYConfig: (json: string) => HomeDiyImportResult
  exportEncryptedDIYConfig: (passphrase: string) => Promise<string>
  importEncryptedDIYConfig: (json: string, passphrase: string) => Promise<HomeDiyImportResult>
  syncToCloudVault: (passphrase: string, expectedVersion: number) => Promise<CloudVaultSyncResult>
  syncFromCloudVault: (
    passphrase: string,
  ) => Promise<{
    success: boolean
    error?: string
    dropped: number
    notes: string[]
    summary?: string
    code?: VaultResultCode
  }>
  checkCloudVaultStatus: () => Promise<{
    hasCloudVault: boolean
    updatedAt?: number
    version?: number
    code: VaultResultCode
  }>
  /** 永久删除中枢云端金库；四种结果（真删 / 本来没有 / 无身份 / 失败）必须原样可分辨 */
  clearCloudVault: () => Promise<CloudVaultClearResult>
}

interface CloudVaultMeta {
  hasCloudVault: boolean
  updatedAt?: number
  version?: number
  code?: VaultResultCode
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
  clearCloudVault,
}: HomeDIYBackupDialogProps) {
  const { toast } = useToast()
  const [backupTab, setBackupTab] = useState<'plain' | 'e2ee'>('plain')
  const [vaultPassphrase, setVaultPassphrase] = useState('')
  const [isDecrypting, setIsDecrypting] = useState(false)
  const [isSyncingCloud, setIsSyncingCloud] = useState(false)
  const [isPullingCloud, setIsPullingCloud] = useState(false)
  const [cloudVaultMeta, setCloudVaultMeta] = useState<CloudVaultMeta | null>(null)
  /** 对表进行中的请求数：布尔会被过期请求的 finally 提前关掉 */
  const [checkingCount, setCheckingCount] = useState(0)
  /** 拉取失败的原因码；独立于徽章，因为它承载的是「这次操作没成功」 */
  const [vaultPullFailure, setVaultPullFailure] = useState<VaultResultCode | null>(null)
  const [cloudMetaGate] = useState(() => newRequestGate())
  const cloudBusy = isSyncingCloud || isPullingCloud
  const isCheckingCloud = checkingCount > 0
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDeletingCloud, setIsDeletingCloud] = useState(false)
  const [vaultConflict, setVaultConflict] = useState<{
    kind: CloudVaultConflictKind
    currentVersion: number | null
  } | null>(null)
  /**
   * 本轮推送被拒绝的原因（对表没查到 / 没身份 / 云端版本号缺失）。
   * 只在用户点了「加密同步至云端」之后出现：后台自动对表失败由徽章如实显示，
   * 不该在没有人操作时抢读屏（role="alert" 是强提醒）。
   */
  const [vaultPushRefusal, setVaultPushRefusal] = useState<VaultPushRefusalReason | null>(null)
  const [importJsonText, setImportJsonText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const passphraseInputRef = useRef<HTMLInputElement>(null)

  /**
   * 对表结果落库：一次失败不该抹掉上次已知的版本号。
   * 徽章据此说「上次对表 vN」，删除入口仍按 check_failed 隐藏（见 cloudVaultPresent）。
   */
  const rememberCloudMeta = useCallback((next: CloudVaultMeta) => {
    setCloudVaultMeta((prev) => mergeCloudVaultMeta(prev, next))
  }, [])

  /**
   * 与云端对表（进面板 / 重试 / 推送前 / 推送成功后复查都走这里）。
   *
   * settleLatest 保证先发的慢响应不会覆盖后发的结论；用计数而不是布尔，
   * 是为了让过期请求的 finally 不会提前关掉新请求的忙态。
   * countAsEntry 只在进入 E2EE 面板时传 true —— vault_status 的分母按入口计。
   */
  const refreshCloudVaultMeta = useCallback(
    async (countAsEntry = false) => {
      setCheckingCount((n) => n + 1)
      try {
        const out = await settleLatest(cloudMetaGate, () => checkCloudVaultStatus())
        if (out.status === 'stale') return undefined
        // 成功与降级都保证 code 存在：后面的 resolveVaultPushPrecondition 依赖这一点
        const meta = out.status === 'value' ? out.value : { hasCloudVault: false as const, code: 'check_failed' as const }
        rememberCloudMeta(meta)
        // 重新对表后，上一轮的冲突/拒绝引导就过期了：让用户基于最新事实再决定
        setVaultConflict(null)
        setVaultPushRefusal(null)
        if (countAsEntry) {
          trackVaultEvent('vault_status', vaultStatusOutcome(meta.code), meta.code)
        }
        return meta
      } finally {
        setCheckingCount((n) => Math.max(0, n - 1))
      }
    },
    [checkCloudVaultStatus, cloudMetaGate, rememberCloudMeta],
  )

  // 切换至 E2EE 或打开备份弹窗时自动对表一次；离开时作废在途响应
  useEffect(() => {
    if (!open || backupTab !== 'e2ee') return
    void refreshCloudVaultMeta(true)
    return () => {
      cloudMetaGate.invalidate()
    }
  }, [open, backupTab, refreshCloudVaultMeta, cloudMetaGate])

  // 重开面板或切 tab：上一次拉取的失败提示已经过期，不能挂在新上下文里
  useEffect(() => {
    setVaultPullFailure(null)
  }, [open, backupTab])

  /**
   * 推送金库。expectedOverride 只给「以 version=0（期望云端为空）重建」这条引导用：
   * 云端已被清除时，先查状态得到 hasCloudVault:false 本来就会算出 0，
   * 但显式传入可避免这里的推断再次吞掉服务端已经说清的那个动作。
   *
   * 其余情况一律先与云端对表，再由 resolveVaultPushPrecondition 判定本轮能否写入：
   * 「没查到」「没身份」「有备份但版本号缺失」三种都拒绝发起写入。
   * 前两种只是把故障伪装成冲突（用户会反复推送），第三种更糟：请求体不带 version 时
   * 中枢的契约就是无条件覆盖，别人的那一版会静默消失。
   */
  const handleCloudUpload = async (expectedOverride?: number) => {
    if (!vaultPassphrase.trim() || vaultPassphrase.length < 6) {
      toast({
        title: '请输入 6 位以上的主密码',
        description: '云端同步需要主密码以执行端侧零知识加密。',
        variant: 'destructive',
      })
      return
    }
    setIsSyncingCloud(true)
    setVaultPullFailure(null)
    try {
      // 先取云端当前版本，作为本次写入的前置条件：多端同时编辑时避免静默覆盖。
      // 走同一道对表闸门；若这次结果已被更晚的一次取代，就按「没查到」拒绝发起写入。
      const before = (await refreshCloudVaultMeta()) ?? { hasCloudVault: false, code: 'check_failed' as const }
      const precondition =
        typeof expectedOverride === 'number'
          ? ({ kind: 'ready', expectedVersion: expectedOverride } as const)
          : resolveVaultPushPrecondition(before)
      if (precondition.kind === 'refused') {
        setVaultPushRefusal(precondition.reason)
        // 用 failed + 原因码，不新开 outcome：词表两侧集合被契约用例钉成完全相等，
        // 为一个客户端分支去扩服务端枚举不值得；成因本来就由 code 承载。
        trackVaultEvent('vault_sync', 'failed', vaultPushRefusalCode(precondition.reason))
        const notice = vaultPushRefusalNotice(precondition.reason)
        toast({ title: notice.title, description: notice.description, variant: 'destructive' })
        return
      }
      setVaultPushRefusal(null)
      const res = await syncToCloudVault(vaultPassphrase.trim(), precondition.expectedVersion)
      if (res.success) {
        setVaultConflict(null)
        trackVaultEvent('vault_sync', 'success')
        toast({
          title: '☁️ 已加密同步至中枢云端',
          description: `DIY 配置已安全保存至云端金库 (版本 v${res.version})。`,
        })
        // 复查只刷新版本号，不再计入 vault_status 分母
        await refreshCloudVaultMeta()
      } else if (res.conflict) {
        const kind: CloudVaultConflictKind = res.conflictKind ?? 'version-conflict'
        setVaultConflict({ kind, currentVersion: res.currentVersion ?? null })
        trackVaultEvent('vault_sync', 'conflict', res.code ?? (kind === 'vault-cleared' ? 'vault_cleared' : 'version_conflict'))
        toast({
          // 两种成因分别措辞：合成一句会把「云端已被清除」的用户引向拉取空内容
          title: kind === 'vault-cleared' ? '云端金库已被清除' : '云端金库已被其它设备更新',
          description: res.error,
          variant: 'destructive',
        })
      } else {
        trackVaultEvent('vault_sync', 'failed', res.code ?? 'hub_error')
        toast({ title: '云端同步失败', description: res.error, variant: 'destructive' })
      }
    } finally {
      setIsSyncingCloud(false)
    }
  }

  /**
   * 「重试对表」：本轮推送被拒绝时唯一的纠正动作。
   *
   * 只重新确认云端事实并据此刷新引导，不报 vault_status —— 那个分母按「进入面板」计一次，
   * 每次点重试都上报会把同一个人重复计数（同上一条钉子）。
   */
  const handleRetryStatusCheck = async () => {
    const meta = await refreshCloudVaultMeta()
    if (!meta) return
    const precondition = resolveVaultPushPrecondition(meta)
    if (precondition.kind === 'refused') {
      setVaultPushRefusal(precondition.reason)
      const notice = vaultPushRefusalNotice(precondition.reason)
      toast({ title: notice.title, description: notice.description, variant: 'destructive' })
      return
    }
    setVaultPushRefusal(null)
    toast({
      title: precondition.expectedVersion === 0 ? '已确认云端没有备份' : `已确认云端金库 v${precondition.expectedVersion}`,
      description:
        precondition.expectedVersion === 0
          ? `现在点「加密同步至云端」会建立第一份备份（新版本从 v${VAULT_REBUILD_FIRST_VERSION} 起计）。`
          : '现在点「加密同步至云端」会以 v' + precondition.expectedVersion + ' 作为前置条件：云端若被别的设备改过，会提示冲突而不是覆盖。',
    })
  }


  /**
   * 永久删除中枢云端金库。
   *
   * 回执按四种事实分别措辞：把「云端本来没有」说成「已删除」，用户会以为自己
   * 拥有过一份其实从未存在的备份；把「请求失败」说成同一句也是撒谎（服务端删了
   * 或没删都可能）。服务端 DELETE 已返回 deleted:boolean，这里只是把事实穿上来。
   * 金库表无软删列（见 store/driver.ts 的 user_vault_sync），删除不可撤销，
   * 因此不给假 Undo —— 恢复路径是重新「加密同步至云端」。
   */
  const handleCloudDelete = async () => {
    setIsDeletingCloud(true)
    try {
      const res = await clearCloudVault()
      if (res.kind === 'deleted') {
        setCloudVaultMeta({ hasCloudVault: false, code: 'no_vault' })
        trackVaultEvent('vault_delete', 'deleted')
        toast({
          title: '🗑️ 云端金库已永久删除',
          description: '中枢上那份端侧加密的 DIY 备份已不存在。本机排版未受影响；需要重新漫游时点「加密同步至云端」即可重建。',
        })
      } else if (res.kind === 'absent') {
        setCloudVaultMeta({ hasCloudVault: false, code: 'no_vault' })
        trackVaultEvent('vault_delete', 'absent')
        toast({
          title: '云端本来就没有备份',
          description: '本次请求没有删除任何数据——你此前可能已删除过，或从未同步成功。',
        })
      } else if (res.kind === 'no-identity') {
        trackVaultEvent('vault_delete', 'no_identity', 'no_identity')
        toast({
          title: '未取到本机身份，已取消删除',
          description: '中枢按身份定位金库，取不到身份时不会发起任何请求。请检查浏览器是否允许本地存储（隐私模式会导致身份丢失）。',
          variant: 'destructive',
        })
      } else {
        trackVaultEvent('vault_delete', 'failed', 'hub_error')
        toast({
          title: `☁️ 云端删除失败${typeof res.status === 'number' ? `（HTTP ${res.status}）` : ''}`,
          description: `${res.error}。云端那份备份仍在，未做任何改动；可稍后重试。`,
          variant: 'destructive',
        })
      }
      setDeleteConfirmOpen(false)
    } finally {
      setIsDeletingCloud(false)
    }
  }

  /**
   * 从云端金库一键拉取并解密还原。
   *
   * 失败不再弹一句泛化 toast：不同 code 的下一步完全不同（重试 / 建立第一份 /
   * 换主密码 / 改用本地导出），统一文案等于把「密码错」和「中枢挂了」说成同一件事。
   * 持久错误块按 code 分流（见 cloudPullFailureNotice）。
   */
  const handleCloudDownload = async () => {
    if (!vaultPassphrase.trim()) {
      toast({
        title: '请输入解密主密码',
        description: '请输入保存该云端金库时设定的主密码以解密。',
        variant: 'destructive',
      })
      return
    }
    setIsPullingCloud(true)
    setVaultPullFailure(null)
    try {
      const res = await syncFromCloudVault(vaultPassphrase.trim())
      if (res.success) {
        trackVaultEvent('vault_pull', 'success')
        toast({
          // 清洗带白名单和上限，「全量还原」是没法保证的断言：只说实际还原了多少、丢了多少
          title: res.dropped > 0 ? '☁️ 已还原，但部分内容被丢弃' : '☁️ 成功从云端金库拉取并还原配置',
          description: res.summary ?? '排版偏好、专属私人分类与置顶站点已还原。',
          variant: res.dropped > 0 ? 'destructive' : 'default',
        })
        onOpenChange(false)
      } else {
        // 「云端没有备份」是漏斗里的空结果，不是失败：两者混在一起就分不清
        // 「没人同步过」和「同步过但拉不下来」
        const code = res.code ?? 'hub_error'
        setVaultPullFailure(code)
        trackVaultEvent('vault_pull', vaultPullOutcome(false, code), code)
      }
    } finally {
      setIsPullingCloud(false)
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
    toast({
      title: !res.ok ? '导入失败' : res.dropped > 0 ? '⚠️ 已导入，但部分内容被丢弃' : '🎉 导入成功',
      description: res.message,
      variant: !res.ok || res.dropped > 0 ? 'destructive' : 'default',
    })
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
        title: !res.ok ? '解密恢复失败' : res.dropped > 0 ? '⚠️ 已还原，但部分内容被丢弃' : '🎉 解密恢复成功',
        description: res.message,
        variant: !res.ok || res.dropped > 0 ? 'destructive' : 'default',
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

  /**
   * 云端事实 → 徽章文案（run46/run68）。
   *
   * 四类事实各自成句：对表中 / 有备份 / 确实没有 / 没查到（含上次已知版本）。
   * 文案本身抽在 vault-copy.ts 以纯函数测试；这里只负责喂当前事实。
   * check_failed 时即便上次查到过备份也隐藏删除入口：此刻的事实不足以决定删哪一份。
   */
  const cloudVaultPresent = !!cloudVaultMeta?.hasCloudVault && cloudVaultMeta.code !== 'check_failed'
  const cloudVaultKnownAbsent = !!cloudVaultMeta && !cloudVaultMeta.hasCloudVault && cloudVaultMeta.code === 'no_vault'
  const cloudBadgeLabel = cloudVaultBadgeLabel(cloudVaultMeta, isCheckingCloud)
  const cloudPullNotice = vaultPullFailure ? cloudPullFailureNotice(vaultPullFailure) : null
  const cloudActionHint = !vaultPassphrase.trim()
    ? '先在上方输入金库主密码，「加密同步至云端」与「从云端拉取解密」才会可用。'
    : isPullingCloud
      ? '正在从云端拉取并逐条还原，完成前同步与删除不可用。'
      : isSyncingCloud
        ? '正在与云端同步或对表，完成前拉取与删除不可用。'
        : '端侧加密后直传中枢存储，服务端零知识（无法获知内容）。新设备输入相同主密码即可一键拉取还原。'
  const cloudAbsentHint = cloudVaultKnownAbsent
    ? '云端暂无备份：设置主密码后点「加密同步至云端」建立第一份，之后这里会出现删除入口。'
    : cloudVaultMeta === null
      ? '还没与云端对过表：切到本页时会自动对表，确认云端确实没有备份后，这里会给出建立第一份的引导。'
      : cloudVaultMeta.code === 'no_identity'
        ? '没取到本机身份：中枢按身份定位金库，取不到身份时无法确定要删哪一份，因此删除入口暂不显示。隐私模式或禁用本地存储会导致身份丢失；云端内容（若有）未被改动。'
        : '云端状态未知：这次对表没成功，因此删除入口暂不显示。云端那份备份（如果有）未被改动；点「加密同步至云端」会先重新对表。'

  return (
    <>
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
                ref={passphraseInputRef}
                type="password"
                placeholder="输入加密主密码 (加解密需保持一致)..."
                value={vaultPassphrase}
                onChange={(e) => {
                  setVaultPassphrase(e.target.value)
                  // 改了密码，上一条「主密码不对」的结论就不再适用
                  setVaultPullFailure(null)
                }}
              />
            </div>

            {/* 中枢云端金库同步协同 */}
            <div className="p-3.5 rounded-xl bg-violet-500/5 border border-violet-500/25 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Cloud className="w-4 h-4 text-violet-500" />
                  <span>NavHub 中枢云端金库同步</span>
                </div>
                <span
                  role="status"
                  aria-live="polite"
                  aria-busy={isCheckingCloud}
                  className={cn(
                    'text-[11px]',
                    cloudVaultPresent
                      ? 'text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium'
                      : cloudVaultKnownAbsent || cloudVaultMeta === null
                        ? 'text-muted-foreground'
                        : 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {cloudBadgeLabel}
                </span>
              </div>
              <p id="cloud-action-hint" className="text-[11px] text-muted-foreground leading-relaxed">
                {cloudActionHint}
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-0.5">
                <Button
                  size="sm"
                  onClick={() => void handleCloudUpload()}
                  disabled={!vaultPassphrase.trim() || cloudBusy}
                  aria-busy={isSyncingCloud}
                  aria-describedby="cloud-action-hint"
                  className="flex-1 text-xs gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                >
                  <CloudUpload className="w-3.5 h-3.5" />
                  <span>{isSyncingCloud ? '同步中...' : '加密同步至云端'}</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCloudDownload}
                  disabled={!vaultPassphrase.trim() || cloudBusy}
                  aria-busy={isPullingCloud}
                  aria-describedby="cloud-action-hint"
                  className="flex-1 text-xs border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                >
                  <CloudDownload className="w-3.5 h-3.5" />
                  <span>{isPullingCloud ? '拉取中...' : '从云端拉取解密'}</span>
                </Button>
              </div>

              {cloudPullNotice ? (
                <div role="alert" className="rounded-lg border border-red-500/35 bg-red-500/5 p-2.5 space-y-2">
                  <div className="flex items-start gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                    <div className="text-[11px] leading-relaxed min-w-0 space-y-0.5">
                      <p className="font-semibold text-foreground">{cloudPullNotice.title}</p>
                      <p className="text-muted-foreground">{cloudPullNotice.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    {cloudPullNotice.action === 'retry' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCloudDownload()}
                        disabled={!vaultPassphrase.trim() || cloudBusy}
                        className="flex-1 text-xs gap-1.5 border-red-500/35 text-red-700 dark:text-red-400 hover:bg-red-500/10"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>{cloudPullNotice.actionLabel ?? '重试拉取'}</span>
                      </Button>
                    ) : cloudPullNotice.action === 'create-first' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCloudUpload()}
                        disabled={!vaultPassphrase.trim() || cloudBusy}
                        className="flex-1 text-xs gap-1.5 border-red-500/35 text-red-700 dark:text-red-400 hover:bg-red-500/10"
                      >
                        <CloudUpload className="w-3.5 h-3.5" />
                        <span>{cloudPullNotice.actionLabel ?? '加密同步至云端'}</span>
                      </Button>
                    ) : cloudPullNotice.action === 'fix-passphrase' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => passphraseInputRef.current?.focus()}
                        className="flex-1 text-xs gap-1.5 border-red-500/35 text-red-700 dark:text-red-400 hover:bg-red-500/10"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        <span>重新输入主密码</span>
                      </Button>
                    ) : cloudPullNotice.action === 'use-local-export' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 text-xs gap-1.5 border-red-500/35 text-red-700 dark:text-red-400 hover:bg-red-500/10"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>选择密文文件</span>
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setVaultPullFailure(null)}
                      className="flex-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      知道了
                    </Button>
                  </div>
                </div>
              ) : null}

              {vaultConflict ? (
                <div
                  role="status"
                  className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-2.5 space-y-2"
                >
                  <div className="flex items-start gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-violet-600 dark:text-violet-400" />
                    <p className="text-[11px] leading-relaxed text-foreground min-w-0">
                      {vaultConflict.kind === 'vault-cleared'
                        ? `云端那份备份已不存在，「从云端拉取」不会拿到任何内容。要恢复漫游，以本机当前排版重建即可，${VAULT_REBUILD_VERSION_COPY}。`
                        : typeof vaultConflict.currentVersion === 'number'
                          ? `云端已是第 v${vaultConflict.currentVersion} 版，由其它设备写入。直接覆盖会丢掉那一版的内容。`
                          : '云端内容比本机所依据的版本更新（中枢未回传版本号）。直接覆盖会丢掉别人那一版的内容。'}
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    {vaultConflict.kind === 'vault-cleared' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCloudUpload(0)}
                        disabled={!vaultPassphrase.trim() || cloudBusy}
                        className="flex-1 text-xs gap-1.5 border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                      >
                        <CloudUpload className="w-3.5 h-3.5" />
                        <span>{isSyncingCloud ? '重建中...' : VAULT_REBUILD_ACTION_LABEL}</span>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCloudDownload()}
                        disabled={!vaultPassphrase.trim() || cloudBusy}
                        className="flex-1 text-xs gap-1.5 border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                      >
                        <CloudDownload className="w-3.5 h-3.5" />
                        <span>先拉取云端最新一版</span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setVaultConflict(null)}
                      className="flex-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      稍后处理
                    </Button>
                  </div>
                  {!vaultPassphrase.trim() && (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      先在上方输入加密主密码，该操作才可用。
                    </p>
                  )}
                </div>
              ) : null}

              {vaultPushRefusal ? (
                <div role="alert" className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-2.5 space-y-2">
                  <div className="flex items-start gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <p className="text-[11px] leading-relaxed text-foreground min-w-0">
                      {vaultPushRefusalNotice(vaultPushRefusal).description}
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRetryStatusCheck()}
                      disabled={cloudBusy}
                      className="flex-1 text-xs gap-1.5 border-amber-500/35 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>重试对表</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setVaultPushRefusal(null)}
                      className="flex-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      稍后处理
                    </Button>
                  </div>
                </div>
              ) : null}

              {cloudVaultPresent ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={isDeletingCloud || cloudBusy}
                  aria-busy={isDeletingCloud}
                  className="w-full text-xs gap-1.5 border-red-500/35 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                >
                  <CloudOff className="w-3.5 h-3.5" />
                  <span>{isDeletingCloud ? '删除中...' : '永久删除云端备份'}</span>
                </Button>
              ) : (
                <p className="text-[11px] leading-relaxed text-muted-foreground pt-0.5">
                  {cloudAbsentHint}
                </p>
              )}
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
      {/*
        删除确认做成根级兄弟而不是嵌在 Dialog 内：Radix 两层模态叠加时，
        Esc 只关最顶层、关闭后焦点回到触发按钮，都靠层级栈管理；DOM 上平级最稳。
        Cancel 排在 Action 前，初始焦点因此落在「取消」而不是破坏性按钮上。
      */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={(next) => { if (!isDeletingCloud) setDeleteConfirmOpen(next) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除云端金库备份？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除中枢上这份端侧加密的 DIY 备份
              {typeof cloudVaultMeta?.version === 'number' ? `（版本 v${cloudVaultMeta.version}` : '（版本未知'}
              {cloudVaultMeta?.updatedAt
                ? `，更新于 ${new Date(cloudVaultMeta.updatedAt).toLocaleString()}）`
                : '）'}
              。本机排版与已导出的文件不受影响。此操作不可撤销——金库表没有软删列，
              想重新漫游需要再次点「加密同步至云端」建立新备份。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingCloud}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // 阻止默认关闭：删除是异步的，结果没回来就让对话框消失会看不出发生了什么
                e.preventDefault()
                void handleCloudDelete()
              }}
              disabled={isDeletingCloud}
              aria-busy={isDeletingCloud}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeletingCloud ? '删除中...' : '永久删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
