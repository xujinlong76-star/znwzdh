'use client'

/**
 * 我的收藏页。
 * v1：localStorage 优先（未登录可用）；登录后自动尝试云端同步
 * （同步失败只提示，不影响本地数据）。
 */

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FavoriteButton } from '@/components/favorite-button'
import { useFavorites, syncFavoritesToCloud, type CloudSyncResult } from '@/hooks/useFavorites'
import { getIdentity } from '@/lib/identity'
import {
  filterFavorites,
  describeFavoritesFilter,
  favoriteFilterEmptyMessage,
} from '@/lib/favorites-filter'
import {
  encryptVault,
  decryptVault,
  type VaultItem,
  type EncryptedVaultPayload,
} from '@/lib/vault'
import { Shield, KeyRound, Download, Upload, CheckCircle2, AlertTriangle, Eye, EyeOff, RefreshCw, CloudOff, Search, X } from 'lucide-react'

export default function FavoritesPage() {
  const favorites = useFavorites()
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<'success' | 'error' | 'info'>('info')
  // 云端同步是一条会失败的链路，必须有独立状态：同步失败时用户最需要的
  // 是「收藏还在本机，换设备看不到」这个事实，而不是一片沉默。
  const [cloudResult, setCloudResult] = useState<CloudSyncResult | null>(null)
  const [syncingCloud, setSyncingCloud] = useState(false)
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)
  // 本页收藏的本地筛选（不联网）：收藏攒到几十个以后，「用眼睛扫网格」不是一种检索方式
  const [favoriteQuery, setFavoriteQuery] = useState('')

  /** 只过滤本页已加载的收藏；空关键词原样返回，不做无谓的重渲染 */
  const filteredFavorites = useMemo(
    () => filterFavorites(favorites.items, favoriteQuery),
    [favorites.items, favoriteQuery],
  )
  const filterSummary = describeFavoritesFilter(
    filteredFavorites.length,
    favorites.items.length,
    favoriteQuery,
  )

  // 零知识 E2EE 金库状态
  const [showVaultExport, setShowVaultExport] = useState(false)
  const [showVaultImport, setShowVaultImport] = useState(false)
  const [vaultPassword, setVaultPassword] = useState('')
  const [vaultPasswordConfirm, setVaultPasswordConfirm] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [importVaultPayload, setImportVaultPayload] = useState('')
  const [showPasswordText, setShowPasswordText] = useState(false)
  const [vaultLoading, setVaultLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 登录用户：进页面时尝试把本地收藏合并到云端
  const runCloudSync = useCallback(async () => {
    setSyncingCloud(true)
    const result = await syncFavoritesToCloud()
    setCloudResult(result)
    setSyncingCloud(false)
  }, [])

  useEffect(() => {
    const identity = getIdentity()
    if (!identity || identity.startsWith('anon-')) return
    void runCloudSync()
  }, [runCloudSync])

  const handleExportPlain = () => {
    const blob = new Blob([favorites.exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'navhub-favorites.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportPlain = () => {
    const result = favorites.importJson(importText)
    if (result.ok) {
      setSyncNote('已导入 ' + result.imported + ' 条书签')
      setSyncStatus('success')
      setImportText('')
      setShowImport(false)
    } else {
      setSyncNote('导入失败：' + (result.error ?? '未知错误'))
      setSyncStatus('error')
    }
  }

  // E2EE 零知识加密导出
  const handleExportVault = async () => {
    if (!vaultPassword || vaultPassword.length < 6) {
      setSyncNote('主密码至少需要 6 个字符')
      setSyncStatus('error')
      return
    }
    if (vaultPassword !== vaultPasswordConfirm) {
      setSyncNote('两次输入的金库密码不一致')
      setSyncStatus('error')
      return
    }

    setVaultLoading(true)
    try {
      const vaultItems: VaultItem[] = favorites.items.map((f) => ({
        id: f.siteId,
        title: f.title,
        url: f.href,
        description: f.description,
        category: f.note,
        tags: f.icon ? [f.icon] : [],
        createdAt: f.createdAt,
      }))

      const payload = await encryptVault(vaultItems, vaultPassword)
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/octet-stream',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `navhub-vault-${new Date().toISOString().slice(0, 10)}.navhub.vault`
      a.click()
      URL.revokeObjectURL(url)

      setSyncNote(`🔒 成功导出已加密金库，共 ${vaultItems.length} 条收藏（AES-256-GCM 保护）`)
      setSyncStatus('success')
      setShowVaultExport(false)
      setVaultPassword('')
      setVaultPasswordConfirm('')
    } catch (err) {
      setSyncNote('加密导出失败：' + (err instanceof Error ? err.message : '未知异常'))
      setSyncStatus('error')
    } finally {
      setVaultLoading(false)
    }
  }

  // 响应文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (text) {
        setImportVaultPayload(text)
      }
    }
    reader.readAsText(file)
  }

  // E2EE 零知识解密导入
  const handleImportVault = async () => {
    if (!importVaultPayload.trim()) {
      setSyncNote('请选择或粘贴 .navhub.vault 加密文件内容')
      setSyncStatus('error')
      return
    }
    if (!importPassphrase) {
      setSyncNote('请输入金库解密主密码')
      setSyncStatus('error')
      return
    }

    setVaultLoading(true)
    try {
      const parsedPayload = JSON.parse(importVaultPayload) as EncryptedVaultPayload
      if (!parsedPayload.cipherTextBase64 || !parsedPayload.saltHex || !parsedPayload.ivHex) {
        throw new Error('不是合法的 NavHub E2EE 加密金库文件')
      }

      const decryptedItems = await decryptVault(parsedPayload, importPassphrase)

      // 还原为 LocalFavorite 格式
      const localItems = decryptedItems.map((item) => ({
        siteId: item.id,
        title: item.title,
        href: item.url,
        description: item.description,
        note: item.category,
        icon: item.tags?.[0],
        createdAt: item.createdAt ?? Date.now(),
      }))

      const importResult = favorites.importJson(JSON.stringify({ version: 1, items: localItems }))
      if (importResult.ok) {
        setSyncNote(`🔓 零知识金库解密成功！已恢复 ${decryptedItems.length} 条私密收藏`)
        setSyncStatus('success')
        setShowVaultImport(false)
        setImportPassphrase('')
        setImportVaultPayload('')
      } else {
        throw new Error(importResult.error ?? '合并入库失败')
      }
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : '解密失败：密码错误或密文被篡改')
      setSyncStatus('error')
    } finally {
      setVaultLoading(false)
    }
  }

  return (
    <Container>
      <div className="py-6 sm:py-10 space-y-6">
        {/* 沉浸式 Hero 展板 */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface subtle-mesh p-6 sm:p-8 shadow-xs">
          <div className="absolute -right-12 -top-12 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>返回主页</span>
              </Link>
              <span className="text-border">/</span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                私密书签与 E2EE 金库
              </span>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="max-w-2xl">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-xs">
                    <Shield className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <span>我的离线收藏与零知识金库</span>
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  本地离线优先存储，支持军工级 AES-256-GCM 认证加密导出为 <code>.navhub.vault</code> 文件。密码不上云，不可逆，防篡改。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs h-8.5 rounded-xl text-xs"
                  onClick={() => {
                    setShowVaultExport(!showVaultExport)
                    setShowVaultImport(false)
                    setShowImport(false)
                  }}
                  disabled={favorites.items.length === 0}
                >
                  <Shield className="w-3.5 h-3.5" /> 导出加密金库
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-1.5 h-8.5 rounded-xl text-xs border-border/70"
                  onClick={() => {
                    setShowVaultImport(!showVaultImport)
                    setShowVaultExport(false)
                    setShowImport(false)
                  }}
                >
                  <KeyRound className="w-3.5 h-3.5" /> 解密导入金库
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExportPlain}
                  disabled={favorites.items.length === 0}
                  className="text-xs text-muted-foreground h-8.5 rounded-xl hover:bg-accent"
                >
                  明文 JSON
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowImport(!showImport)
                    setShowVaultExport(false)
                    setShowVaultImport(false)
                  }}
                  className="text-xs text-muted-foreground h-8.5 rounded-xl hover:bg-accent"
                >
                  导入 JSON
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* 云端同步状态：失败必须说出来，否则用户以为换设备也能看到 */}
        {(syncingCloud || cloudResult) && (
          <div
            className={`mb-6 p-3 rounded-lg border text-xs flex flex-wrap items-center gap-2 ${
              syncingCloud
                ? 'bg-muted border-border text-muted-foreground'
                : cloudResult?.ok
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
            }`}
          >
            {syncingCloud ? (
              <RefreshCw className="w-4 h-4 flex-shrink-0 animate-spin" />
            ) : cloudResult?.ok ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <CloudOff className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="flex-1 min-w-0">
              {syncingCloud
                ? '正在与云端同步收藏…'
                : cloudResult?.ok
                ? cloudResult.pushed > 0
                  ? `已把本机 ${cloudResult.pushed} 条收藏合并到云端` +
                    (cloudResult.cloud ? `（云端共 ${cloudResult.cloud.length} 条）` : '')
                  : `云端同步正常` + (cloudResult.cloud ? `（云端 ${cloudResult.cloud.length} 条）` : '')
                : `云端同步失败：${cloudResult?.error ?? '未知原因'}。收藏已保存在本机浏览器，换设备登录可能看不到。`}
            </span>
            {!syncingCloud && cloudResult && !cloudResult.ok && cloudResult.retryable && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs rounded-lg gap-1.5"
                onClick={() => void runCloudSync()}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重试同步
              </Button>
            )}
          </div>
        )}

        {syncNote && (
          <div
            className={`mb-6 p-3 rounded-lg border text-xs flex items-center gap-2 ${
              syncStatus === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : syncStatus === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                : 'bg-muted border-border text-muted-foreground'
            }`}
          >
            {syncStatus === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : syncStatus === 'error' ? (
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <Shield className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{syncNote}</span>
          </div>
        )}

        {/* 零知识加密导出面板 */}
        {showVaultExport && (
          <div className="mb-6 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                  <Shield className="w-4 h-4" /> 导出零知识加密金库 (.navhub.vault)
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  基于 PBKDF2 (100,000 次哈希迭代) 派生 256 位密钥 + AES-256-GCM 认证加密。密码不上云，不可逆，防篡改。
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowVaultExport(false)}>
                收起
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  设置金库主密码 (至少 6 位)
                </label>
                <div className="relative">
                  <input
                    type={showPasswordText ? 'text' : 'password'}
                    value={vaultPassword}
                    onChange={(e) => setVaultPassword(e.target.value)}
                    placeholder="输入强主密码..."
                    className="w-full px-3 py-1.5 text-xs rounded-md border bg-background pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                  >
                    {showPasswordText ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  确认金库主密码
                </label>
                <input
                  type={showPasswordText ? 'text' : 'password'}
                  value={vaultPasswordConfirm}
                  onChange={(e) => setVaultPasswordConfirm(e.target.value)}
                  placeholder="再次输入相同密码..."
                  className="w-full px-3 py-1.5 text-xs rounded-md border bg-background"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
                onClick={handleExportVault}
                disabled={vaultLoading || !vaultPassword || vaultPassword.length < 6}
              >
                <Download className="w-3.5 h-3.5" />
                {vaultLoading ? '正在派生密钥加密…' : `生成并下载 .navhub.vault (${favorites.items.length} 条)`}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowVaultExport(false)}>
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 零知识解密导入面板 */}
        {showVaultImport && (
          <div className="mb-6 p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
                  <KeyRound className="w-4 h-4" /> 导入并解密私密金库
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  输入主密码验证消息认证码 (GMAC)，如密码错误或密文遭到单字节篡改将立刻阻断并报警。
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowVaultImport(false)}>
                收起
              </Button>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    选择 .navhub.vault 文件或粘贴密文
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6.5 text-xs px-2.5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3 h-3 mr-1" /> 选择本地金库文件
                  </Button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".vault,.json"
                    className="hidden"
                  />
                </div>
                <textarea
                  value={importVaultPayload}
                  onChange={(e) => setImportVaultPayload(e.target.value)}
                  placeholder="可直接点击上方按钮选择文件，或在此粘贴密文 JSON..."
                  className="w-full h-24 rounded-md border bg-background p-2 text-xs font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  输入此金库的主密码
                </label>
                <input
                  type="password"
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  placeholder="输入解密密码..."
                  className="w-full sm:w-80 px-3 py-1.5 text-xs rounded-md border bg-background"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5"
                onClick={handleImportVault}
                disabled={vaultLoading || !importVaultPayload.trim() || !importPassphrase}
              >
                <KeyRound className="w-3.5 h-3.5" />
                {vaultLoading ? '正在解密并验证认证码…' : '验证密码并导入'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowVaultImport(false)}>
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 传统明文 JSON 导入面板 */}
        {showImport && (
          <div className="mb-6 space-y-2 p-4 rounded-lg border bg-muted/20">
            <div className="text-xs font-medium text-muted-foreground">导入传统未加密 JSON</div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='粘贴导出的 JSON，如 {"version":1,"items":[...]}'
              className="w-full h-24 rounded-md border bg-background p-2 text-xs font-mono"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleImportPlain} disabled={!importText.trim()}>
                确认导入
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowImport(false)}>
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 本地筛选条：只在确实有收藏时出现（没有收藏时不需要筛选控件） */}
        {favorites.ready && favorites.items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[13rem] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={favoriteQuery}
                onChange={(e) => setFavoriteQuery(e.target.value)}
                placeholder="在收藏里筛选：标题 / 链接 / 描述"
                aria-label="筛选收藏"
                className="pl-8 h-9 text-sm"
              />
            </div>
            {filterSummary && (
              <span className="text-xs text-muted-foreground font-mono" role="status" aria-live="polite">
                {filterSummary}
              </span>
            )}
            {favoriteQuery && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 px-2 text-xs"
                onClick={() => setFavoriteQuery('')}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                清除
              </Button>
            )}
          </div>
        )}

        {!favorites.ready ? (
          <div className="text-muted-foreground text-sm py-12 text-center">加载中…</div>
        ) : favorites.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 p-12 text-center max-w-lg mx-auto space-y-3 bg-card/40 my-8">
            <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center mx-auto text-muted-foreground border border-border/40">
              <Shield className="w-6 h-6 text-emerald-500" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">还没有收藏任何站点</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              在主页站点卡片或搜索结果里点击星标即可一键收藏（本地离线存储，无需登录，可随时导出为 E2EE 加密金库）。
            </p>
            <div className="pt-2">
              <Link href="/">
                <Button size="sm" variant="outline" className="text-xs">
                  去主页探索发现
                </Button>
              </Link>
            </div>
          </div>
        ) : filteredFavorites.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 p-10 text-center max-w-lg mx-auto space-y-3 bg-card/40 my-6">
            <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center mx-auto text-muted-foreground border border-border/40">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">{favoriteFilterEmptyMessage(favoriteQuery)}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              收藏并没有丢：共 {favorites.items.length} 个都还在本机，只是当前关键词没匹配到。
            </p>
            <div className="pt-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setFavoriteQuery('')}>
                清除筛选
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
            {filteredFavorites.map((f) => (
              <div
                key={f.siteId}
                className="group relative overflow-hidden rounded-xl border border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs nav-card-glow transition-all duration-200 transform hover:-translate-y-0.5 p-3.5 flex flex-col justify-between"
              >
                <a href={f.href} target="_blank" rel="noopener noreferrer" className="block min-w-0">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg p-1.5 bg-muted/50 dark:bg-muted/20 border border-border/50 flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shadow-xs">
                      {f.icon ? (
                        <img
                          src={f.icon}
                          alt=""
                          className="w-full h-full object-contain rounded-xs"
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className="w-full h-full rounded bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                          {f.title.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors truncate pr-8">
                        {f.title}
                      </div>
                      {f.description && (
                        <div className="text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed mt-1">
                          {f.description}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground/70 font-mono mt-2">
                        {new Date(f.createdAt).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                  </div>
                </a>
                <div className="absolute top-2 right-2">
                  <FavoriteButton site={f} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 text-xs text-muted-foreground">
          收藏数据当前保存在浏览器本地（localStorage）。
          <Link href="/tags" className="mx-1 text-primary hover:underline">去标签云看看</Link>
          或
          <Link href="/hot" className="mx-1 text-primary hover:underline">浏览热度榜</Link>
        </div>
      </div>
      <Footer />
    </Container>
  )
}
