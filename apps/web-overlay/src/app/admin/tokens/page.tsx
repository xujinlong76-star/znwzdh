'use client'

/**
 * 管理端：API Token 访问凭据管理。
 *
 * 这一版补上的能力（后端早已有接口，但 UI 之前完全接不到）：
 *   - 轮换（rotate）：凭据泄露后的紧急处置，旧明文立即失效
 *   - 编辑（patch）：改名 / 改权限 / 改有效期，不必删了重建
 *   - 软吊销（revoke）：停用但留痕，审计日志仍能对应到这条凭据
 *   - 彻底删除（delete）：仅用于合规清除
 *
 * 两个刻意的交互约束：
 *   1. 权限是**单选的"最大权限"**而不是多选 checkbox。read/write/admin 是
 *      层级关系（admin ⊇ write ⊇ read），勾选 read+admin 没有意义，只会让人
 *      误以为能单独关掉某一级。
 *   2. 复制明文必须**确认真的成功**。明文只出现一次，`navigator.clipboard`
 *      在非 HTTPS / 无权限时会静默失败，假装成功等于让用户永久丢失凭据。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { useToast } from '@/components/ui/use-toast'
import {
  KeyRound, Plus, Trash2, Copy, Check, AlertTriangle, ShieldCheck,
  RefreshCw, Pencil, Ban, ShieldOff,
} from 'lucide-react'
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
import { copyText } from '@/lib/clipboard'

type MaxScope = 'read' | 'write' | 'admin'

interface ApiToken {
  id: string
  name: string
  scopes: string[]
  expiresAt: number | null
  lastUsedAt: number | null
  createdAt: number
  revokedAt: number | null
  rotatedAt: number | null
  tokenPrefix: string | null
}

interface TokenWithPlaintext extends ApiToken {
  token: string
  note?: string
}

/** 权限等级：管理员最高。API 侧 admin ⊇ write ⊇ read，UI 只让用户选最高那级 */
const SCOPE_RANK: Record<MaxScope, number> = { read: 1, write: 2, admin: 3 }

function maxScopeOf(scopes: string[]): MaxScope {
  let best: MaxScope = 'read'
  for (const s of scopes) {
    const k = s.toLowerCase() as MaxScope
    if (k in SCOPE_RANK && SCOPE_RANK[k] > SCOPE_RANK[best]) best = k
  }
  return best
}

/** 距过期还有几天（已过期为负）；永不过期返回 null */
function daysUntil(ts: number | null): number | null {
  if (ts === null) return null
  return Math.ceil((ts - Date.now()) / 86_400_000)
}

type TokenState = 'revoked' | 'expired' | 'expiring' | 'permanent' | 'active'

function stateOf(t: ApiToken): TokenState {
  if (t.revokedAt !== null) return 'revoked'
  if (t.expiresAt === null) return 'permanent'
  const d = daysUntil(t.expiresAt)
  if (d !== null && d <= 0) return 'expired'
  if (d !== null && d <= 30) return 'expiring'
  return 'active'
}

const STATE_META: Record<TokenState, { label: string; className: string }> = {
  revoked: { label: '已吊销', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  expired: { label: '已过期', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  expiring: { label: '即将过期', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  permanent: { label: '长期有效', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  active: { label: '正常', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
}

export default function AdminTokensPage() {
  const { toast } = useToast()
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [loading, setLoading] = useState(true)

  // 创建
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newScope, setNewScope] = useState<MaxScope>('write')
  const [expiresDays, setExpiresDays] = useState<string>('30')

  // 编辑
  const [editing, setEditing] = useState<ApiToken | null>(null)
  const [editName, setEditName] = useState('')
  const [editScope, setEditScope] = useState<MaxScope>('write')
  const [editExpiresDays, setEditExpiresDays] = useState<string>('30')

  // 明文结果（创建 / 轮换共用）
  const [plainResult, setPlainResult] = useState<TokenWithPlaintext | null>(null)
  const [copied, setCopied] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)

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

  const stats = useMemo(() => {
    let active = 0
    let revoked = 0
    let expired = 0
    for (const t of tokens) {
      const s = stateOf(t)
      if (s === 'revoked') revoked++
      else if (s === 'expired') expired++
      else active++
    }
    return { total: tokens.length, active, revoked, expired }
  }, [tokens])

  /* ------------------------------ 创建 ------------------------------ */

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault()
    // 前置校验与 API 的 zod schema（min(1).max(64)）对齐：
    // 名称问题在本地就拦掉，不必绕一趟网络才收到 400
    const name = newName.trim()
    if (!name) {
      toast({ title: '请输入 Token 名称', variant: 'destructive' })
      return
    }
    if (name.length > 64) {
      toast({ title: '名称过长', description: 'Token 名称不能超过 64 个字符。', variant: 'destructive' })
      return
    }
    const days = Number(expiresDays)
    if (!Number.isFinite(days) || days <= 0) {
      toast({ title: '有效期无效', description: '请选择有效的有效期（本实例禁止签发长期凭据）。', variant: 'destructive' })
      return
    }
    // 同名预检（服务端仍是权威）：利用已加载列表即时反馈，省一趟往返。
    // 已吊销 / 已删除的凭据不占用名称，与服务端 findActiveNameClash 语义一致。
    if (tokens.some((t) => t.revokedAt === null && t.name === name)) {
      toast({
        title: '名称已存在',
        description: `已存在未吊销的同名凭据「${name}」，请换个名称，或先吊销旧凭据。`,
        variant: 'destructive',
      })
      return
    }
    try {
      const res = await hubSend<TokenWithPlaintext>('/api/tokens', 'POST', {
        name,
        // 只发最高那级：API 侧 admin 已隐含 write/read，不需要重复列举
        scopes: newScope,
        expiresAt: Date.now() + days * 86_400_000,
      })
      setPlainResult(res)
      setCopied(false)
      setIsCreateOpen(false)
      setNewName('')
      setNewScope('write')
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

  /* ------------------------------ 编辑 ------------------------------ */

  const openEdit = (t: ApiToken) => {
    setEditing(t)
    setEditName(t.name)
    setEditScope(maxScopeOf(t.scopes))
    const d = daysUntil(t.expiresAt)
    setEditExpiresDays(t.expiresAt === null ? '0' : String(Math.max(1, d ?? 30)))
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    // 与创建表单同一套长度规则（API zod: min(1).max(64)）
    const name = editName.trim()
    if (!name) {
      toast({ title: '名称不能为空', variant: 'destructive' })
      return
    }
    if (name.length > 64) {
      toast({ title: '名称过长', description: 'Token 名称不能超过 64 个字符。', variant: 'destructive' })
      return
    }
    setBusyId(editing.id)
    try {
      const days = Number(editExpiresDays)
      await hubSend(`/api/tokens/${encodeURIComponent(editing.id)}`, 'PATCH', {
        name,
        scopes: editScope,
        expiresAt: days > 0 ? Date.now() + days * 86_400_000 : null,
      })
      toast({ title: '已更新凭据', description: `Token「${name}」的权限与有效期已保存。` })
      setEditing(null)
      void loadTokens()
    } catch (err) {
      toast({
        title: '更新失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  /* ------------------------------ 轮换 ------------------------------ */

  const handleRotate = async (t: ApiToken) => {
    if (!window.confirm(`轮换后「${t.name}」的当前明文会立即失效，依赖它的客户端需要改用新明文。确定继续吗？`)) return
    setBusyId(t.id)
    try {
      const res = await hubSend<TokenWithPlaintext>(`/api/tokens/${encodeURIComponent(t.id)}/rotate`, 'POST', {})
      setPlainResult(res)
      setCopied(false)
      toast({ title: '轮换成功', description: '旧明文已失效，请立即保存新明文。' })
      void loadTokens()
    } catch (err) {
      toast({
        title: '轮换失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  /* ---------------------------- 吊销 / 删除 ---------------------------- */

  const handleRevoke = async (t: ApiToken) => {
    if (!window.confirm(`确定要吊销「${t.name}」吗？依赖它的客户端将立即无法访问，但审计记录会保留。`)) return
    setBusyId(t.id)
    try {
      await hubSend(`/api/tokens/${encodeURIComponent(t.id)}/revoke`, 'POST', {})
      toast({ title: '已吊销', description: `Token「${t.name}」已停用，记录保留以便追溯。` })
      void loadTokens()
    } catch (err) {
      toast({
        title: '吊销失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handlePurge = async (t: ApiToken) => {
    const typed = window.prompt(`彻底删除「${t.name}」会抹掉它的全部记录（含审计可追溯性）。\n如确认，请输入名称以继续：`)
    if (typed !== t.name) {
      if (typed !== null) toast({ title: '名称不匹配，已取消', variant: 'destructive' })
      return
    }
    setBusyId(t.id)
    try {
      await hubSend(`/api/tokens/${encodeURIComponent(t.id)}`, 'DELETE')
      toast({ title: '已彻底删除', description: `Token「${t.name}」的记录已抹除。` })
      void loadTokens()
    } catch (err) {
      toast({
        title: '删除失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  /* ------------------------------ 复制 ------------------------------ */

  const handleCopy = async () => {
    if (!plainResult?.token) return
    const result = await copyText(plainResult.token)
    if (!result.ok) {
      // 绝不假装成功：明文只出现一次，复制失败必须让用户知道要手动选中
      toast({
        title: '自动复制失败',
        description: '请手动选中上方明文并复制（Ctrl/Cmd + C）。关闭后无法再次查看。',
        variant: 'destructive',
      })
      return
    }
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

      {!loading && tokens.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: '凭据总数', value: stats.total, tone: 'text-foreground' },
            { label: '生效中', value: stats.active, tone: 'text-emerald-600 dark:text-emerald-400' },
            { label: '已吊销', value: stats.revoked, tone: 'text-red-600 dark:text-red-400' },
            { label: '已过期', value: stats.expired, tone: 'text-amber-600 dark:text-amber-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border/70 bg-card/50 px-3 py-2.5">
              <div className="text-[11px] text-muted-foreground">{s.label}</div>
              <div className={`text-lg font-bold ${s.tone}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

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
        <div className="rounded-xl border border-border/70 overflow-x-auto shadow-xs bg-card/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs font-medium text-muted-foreground">
                <th className="text-left px-4 py-3">标识名称</th>
                <th className="text-left px-4 py-3">最大权限</th>
                <th className="text-left px-4 py-3">最近调用</th>
                <th className="text-left px-4 py-3">有效期限</th>
                <th className="text-right px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {tokens.map((t) => {
                const state = stateOf(t)
                const meta = STATE_META[state]
                const d = daysUntil(t.expiresAt)
                const disabled = busyId === t.id
                return (
                  <tr key={t.id} className={`hover:bg-muted/30 transition-colors ${state === 'revoked' ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                        <span>{t.name}</span>
                        <Badge variant="outline" className={`text-[10px] h-4 ${meta.className}`}>{meta.label}</Badge>
                        {t.rotatedAt !== null && (
                          <Badge variant="outline" className="text-[10px] h-4 border-border/60">已轮换</Badge>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground/80 mt-0.5 space-x-2">
                        <span>创建于 {new Date(t.createdAt).toLocaleDateString('zh-CN')}</span>
                        {t.tokenPrefix && <span>· {t.tokenPrefix}…</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                        maxScopeOf(t.scopes) === 'admin'
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 font-bold'
                          : maxScopeOf(t.scopes) === 'write'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                          : 'bg-primary/10 text-primary border-primary/20'
                      }`}>
                        {maxScopeOf(t.scopes)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString('zh-CN') : '从未调用'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {t.expiresAt === null ? (
                        <span className="text-amber-600 dark:text-amber-400">长期有效</span>
                      ) : (
                        <span className={state === 'expired' || state === 'expiring' ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}>
                          {new Date(t.expiresAt).toLocaleDateString('zh-CN')}
                          {state !== 'expired' && d !== null && <span className="ml-1 opacity-70">（{d} 天）</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm" variant="ghost" title="编辑名称 / 权限 / 有效期"
                          className="h-7 text-xs rounded-lg gap-1" disabled={disabled}
                          onClick={() => openEdit(t)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="ghost" title="轮换明文（旧明文立即失效）"
                          className="h-7 text-xs rounded-lg gap-1" disabled={disabled || state === 'revoked'}
                          onClick={() => handleRotate(t)}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="ghost" title="吊销（停用但保留记录）"
                          className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 rounded-lg gap-1"
                          disabled={disabled || state === 'revoked'}
                          onClick={() => handleRevoke(t)}
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="ghost" title="彻底删除（抹除全部记录）"
                          className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-lg gap-1"
                          disabled={disabled}
                          onClick={() => handlePurge(t)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 创建弹窗 */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md max-h-[85dvh] overflow-y-auto p-4 sm:p-6 rounded-2xl glass-surface depth-modal">
          <DialogHeader className="pr-8 sm:pr-6">
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
              <label htmlFor="token-new-name" className="text-xs font-semibold text-foreground">Token 标识名称</label>
              <Input id="token-new-name"
                placeholder="例如: claude-desktop-agent / chrome-ext"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8.5 text-xs"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">最大权限</label>
              <p className="text-[11px] text-muted-foreground">权限是层级的：全权 ⊇ 读写 ⊇ 只读。选择需要的**最高**一级即可。</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'read', label: '只读' },
                  { id: 'write', label: '读写' },
                  { id: 'admin', label: '全权' },
                ] as Array<{ id: MaxScope; label: string }>).map((scope) => (
                  <label
                    key={scope.id}
                    className={`flex items-center justify-center gap-1.5 p-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                      newScope === scope.id
                        ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                        : 'border-border/60 hover:bg-muted/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="new-scope"
                      checked={newScope === scope.id}
                      onChange={() => setNewScope(scope.id)}
                      className="h-3 w-3 text-primary"
                    />
                    <span>{scope.label}</span>
                  </label>
                ))}
              </div>
              {newScope === 'admin' && (
                <p className="text-[11px] text-red-600 dark:text-red-400 flex items-start gap-1.5">
                  <ShieldOff className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>全权凭据可签发与管理其它 Token，请仅在必要时授予，并尽量缩短有效期。</span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="token-new-expires" className="text-xs font-semibold text-foreground">有效期</label>
              <select id="token-new-expires"
                value={expiresDays}
                onChange={(e) => setExpiresDays(e.target.value)}
                className="w-full h-8.5 rounded-xl border border-border bg-background px-3 text-xs"
              >
                <option value="7">7 天后过期</option>
                <option value="30">30 天后过期 (推荐)</option>
                <option value="90">90 天后过期</option>
                <option value="365">1 年后过期</option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                本实例禁止签发长期（永不过期）凭据——泄露的永久凭据等于永久后门，且无法通过&ldquo;等它过期&rdquo;止血。
              </p>
            </div>

            <DialogFooter className="pt-2 gap-2 sm:gap-0">
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

      {/* 编辑弹窗 */}
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md max-h-[85dvh] overflow-y-auto p-4 sm:p-6 rounded-2xl glass-surface depth-modal">
          <DialogHeader className="pr-8 sm:pr-6">
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Pencil className="w-4 h-4 text-primary" />
              <span>编辑凭据</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              可修改名称、权限与有效期。明文不受影响——需要换明文请用「轮换」。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label htmlFor="token-edit-name" className="text-xs font-semibold text-foreground">标识名称</label>
              <Input id="token-edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8.5 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">最大权限</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'read', label: '只读' },
                  { id: 'write', label: '读写' },
                  { id: 'admin', label: '全权' },
                ] as Array<{ id: MaxScope; label: string }>).map((scope) => (
                  <label
                    key={scope.id}
                    className={`flex items-center justify-center gap-1.5 p-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                      editScope === scope.id
                        ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                        : 'border-border/60 hover:bg-muted/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="edit-scope"
                      checked={editScope === scope.id}
                      onChange={() => setEditScope(scope.id)}
                      className="h-3 w-3 text-primary"
                    />
                    <span>{scope.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="token-edit-expires" className="text-xs font-semibold text-foreground">有效期（自今天起）</label>
              <select id="token-edit-expires"
                value={editExpiresDays}
                onChange={(e) => setEditExpiresDays(e.target.value)}
                className="w-full h-8.5 rounded-xl border border-border bg-background px-3 text-xs"
              >
                <option value="7">7 天</option>
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="365">365 天</option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                不支持设为长期有效；需更长有效期请联系运维调整 NAVHUB_TOKEN_MAX_LIFETIME_DAYS。
              </p>
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)} className="text-xs">
              取消
            </Button>
            <Button size="sm" className="text-xs font-semibold" disabled={busyId !== null} onClick={handleSaveEdit}>
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 明文展示弹窗（创建 / 轮换共用） */}
      <Dialog open={plainResult !== null} onOpenChange={(open) => { if (!open) setPlainResult(null) }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md max-h-[85dvh] overflow-y-auto p-4 sm:p-6 rounded-2xl glass-surface depth-modal space-y-4">
          <DialogHeader className="pr-8 sm:pr-6">
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
              <span>Token 明文（仅此一次）</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              请立即复制保存。系统仅存储哈希，关闭此弹窗后将无法再次查看。
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 rounded-xl bg-muted/60 border border-border/80 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
              <span>{plainResult?.name}</span>
              <span>{plainResult?.scopes.join(', ')}</span>
            </div>
            <div className="font-mono text-xs bg-background p-2.5 rounded-lg border border-border/60 break-all select-all font-semibold text-primary">
              {plainResult?.token}
            </div>
            <Button
              size="sm"
              className="w-full h-8 text-xs gap-1.5 font-semibold"
              onClick={handleCopy}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '已复制到剪贴板！' : '复制 Token 明文'}</span>
            </Button>
          </div>

          <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>在请求头中使用 <code>Authorization: Bearer &lt;Token&gt;</code>。</span>
          </div>

          <DialogFooter>
            <Button
              size="sm"
              onClick={() => setPlainResult(null)}
              className="w-full text-xs"
              variant={copied ? 'default' : 'outline'}
            >
              {copied ? '我已安全保存，关闭弹窗' : '未复制也关闭（明文将永久丢失）'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
