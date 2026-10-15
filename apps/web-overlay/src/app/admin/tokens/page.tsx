'use client'

/**
 * 管理端：API Token 管理页面。
 * 提供 API 鉴权 Token 的签发、权限范围（read/write/admin）配置、明文一次性复制与吊销功能。
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { useToast } from '@/components/ui/use-toast'
import { KeyRound, Plus, Trash2, Copy, Check, AlertTriangle, ShieldCheck, Clock, Calendar } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface ApiToken {
  id: string
  name: string
  scopes: string[]
  expiresAt: number | null
  lastUsedAt: number | null
  createdAt: number
}

interface CreateTokenResponse extends ApiToken {
  token: string
  note: string
}

export default function AdminTokensPage() {
  const { toast } = useToast()
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [loading, setLoading] = useState(true)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read', 'write'])
  const [expiresDays, setExpiresDays] = useState<string>('30')
  const [createdResult, setCreatedResult] = useState<CreateTokenResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadTokens = useCallback(async () => {
    setLoading(true)
    try {
      const data = await hubGet<ApiToken[]>('/api/tokens')
      setTokens(Array.isArray(data) ? data : [])
    } catch {
      toast({
        title: '获取 Token 列表失败',
        description: '请确认 Fastify 中枢已启动且已配置管理权限。',
        variant: 'destructive',
      })
      setTokens([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadTokens()
  }, [loadTokens])

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTokenName.trim()) {
      toast({ title: '请输入 Token 名称', variant: 'destructive' })
      return
    }
    if (selectedScopes.length === 0) {
      toast({ title: '请至少勾选一个权限 Scope', variant: 'destructive' })
      return
    }

    try {
      const days = Number(expiresDays)
      const expiresAt = days > 0 ? Date.now() + days * 86_400_000 : null
      const res = await hubSend<CreateTokenResponse>('/api/tokens', 'POST', {
        name: newTokenName.trim(),
        scopes: selectedScopes.join(','),
        expiresAt,
      })

      setCreatedResult(res)
      setIsCreateOpen(false)
      setNewTokenName('')
      setSelectedScopes(['read', 'write'])
      setExpiresDays('30')
      void loadTokens()
    } catch (err) {
      toast({
        title: '创建 Token 失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  const handleDeleteToken = async (id: string, name: string) => {
    if (!window.confirm(`确定要吊销 Token「${name}」吗？吊销后依赖该 Token 的 MCP 客户端或外部服务将立即无法访问。`)) {
      return
    }
    setDeletingId(id)
    try {
      await hubSend(`/api/tokens/${encodeURIComponent(id)}`, 'DELETE')
      toast({ title: '已成功吊销 Token', description: `Token「${name}」已失效。` })
      setTokens((prev) => prev.filter((t) => t.id !== id))
    } catch {
      toast({ title: '吊销失败', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  const handleCopyNewToken = () => {
    if (!createdResult?.token) return
    navigator.clipboard.writeText(createdResult.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/60">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <span>API Token 访问凭据管理</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            用于 MCP Agent（Claude Desktop / Cursor）、浏览器扩展及外部程序调用 NavHub API 的安全密钥。
          </p>
        </div>
        <Button size="sm" onClick={() => setIsCreateOpen(true)} className="gap-1.5 shadow-xs font-semibold">
          <Plus className="w-4 h-4" />
          <span>创建新 Token</span>
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">正在加载 Token 列表…</div>
      ) : tokens.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center space-y-3 bg-card/30">
          <KeyRound className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
          <p className="text-sm font-semibold text-foreground">暂未签发任何 API Token</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            当开启 NAVHUB_AUTH_REQUIRED 时，管理面所有操作均需持有有效 Token。点击右上角即可生成。
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/70 overflow-hidden shadow-xs bg-card/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs font-medium text-muted-foreground">
                <th className="text-left px-4 py-3">标识名称</th>
                <th className="text-left px-4 py-3">权限范围 (Scopes)</th>
                <th className="text-left px-4 py-3">最近调用</th>
                <th className="text-left px-4 py-3">有效期限</th>
                <th className="text-right px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {tokens.map((t) => {
                const isExpired = t.expiresAt !== null && t.expiresAt < Date.now()
                return (
                  <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground flex items-center gap-1.5">
                        <span>{t.name}</span>
                        {isExpired && <Badge variant="destructive" className="text-[10px] h-4">已过期</Badge>}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground/80 mt-0.5">
                        创建于 {new Date(t.createdAt).toLocaleDateString('zh-CN')}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {t.scopes.map((s) => (
                          <span
                            key={s}
                            className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                              s === 'admin'
                                ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 font-bold'
                                : s === 'write'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                : 'bg-primary/10 text-primary border-primary/20'
                            }`}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString('zh-CN') : '从未调用'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {t.expiresAt ? (
                        <span className={isExpired ? 'text-red-500 font-bold' : ''}>
                          {new Date(t.expiresAt).toLocaleDateString('zh-CN')}
                        </span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400">长期有效</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-lg gap-1"
                        disabled={deletingId === t.id}
                        onClick={() => handleDeleteToken(t.id, t.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>吊销</span>
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 创建 Token 弹窗 */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md p-6 rounded-2xl glass-surface depth-modal">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              <span>生成新的 API 访问凭据</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              为外部 Agent、脚本或扩展创建专属 Token。生成后请立即复制妥善保存。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateToken} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Token 标识名称</label>
              <Input
                placeholder="例如: claude-desktop-agent / chrome-ext"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                className="h-8.5 text-xs"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">权限范围 (Scopes)</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'read', label: '只读 (read)' },
                  { id: 'write', label: '读写 (write)' },
                  { id: 'admin', label: '全权 (admin)' },
                ].map((scope) => {
                  const checked = selectedScopes.includes(scope.id)
                  return (
                    <label
                      key={scope.id}
                      className={`flex items-center gap-2 p-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                        checked ? 'bg-primary/10 border-primary/40 text-primary font-medium' : 'border-border/60 hover:bg-muted/40'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedScopes([...selectedScopes, scope.id])
                          else setSelectedScopes(selectedScopes.filter((s) => s !== scope.id))
                        }}
                        className="rounded text-primary h-3.5 w-3.5"
                      />
                      <span>{scope.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">有效期</label>
              <select
                value={expiresDays}
                onChange={(e) => setExpiresDays(e.target.value)}
                className="w-full h-8.5 rounded-xl border border-border bg-background px-3 text-xs"
              >
                <option value="7">7 天后过期</option>
                <option value="30">30 天后过期 (推荐)</option>
                <option value="90">90 天后过期</option>
                <option value="365">1 年后过期</option>
                <option value="0">长期有效 (永不过期)</option>
              </select>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsCreateOpen(false)} className="text-xs">
                取消
              </Button>
              <Button type="submit" size="sm" className="text-xs font-semibold">
                确认创建并签发
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 签发成功展示弹窗 */}
      <Dialog open={createdResult !== null} onOpenChange={(open) => { if (!open) setCreatedResult(null) }}>
        <DialogContent className="max-w-md p-6 rounded-2xl glass-surface depth-modal space-y-4">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
              <span>Token 签发成功</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              请立即复制保存此 Token 明文。出于安全考虑，系统仅存储加密哈希，关闭此弹窗后将无法再次查看！
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 rounded-xl bg-muted/60 border border-border/80 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
              <span>{createdResult?.name}</span>
              <span>{createdResult?.scopes.join(', ')}</span>
            </div>
            <div className="font-mono text-xs bg-background p-2.5 rounded-lg border border-border/60 break-all select-all font-semibold text-primary">
              {createdResult?.token}
            </div>
            <Button
              size="sm"
              className="w-full h-8 text-xs gap-1.5 font-semibold"
              onClick={handleCopyNewToken}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '已复制到剪贴板！' : '复制 Token 明文'}</span>
            </Button>
          </div>

          <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>可在 HTTP 请求头中添加 <code>Authorization: Bearer &lt;Token&gt;</code> 使用。</span>
          </div>

          <DialogFooter>
            <Button size="sm" onClick={() => setCreatedResult(null)} className="w-full text-xs">
              我已安全保存，关闭弹窗
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
