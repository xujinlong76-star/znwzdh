'use client'

/**
 * 工作空间管理（第 5 批）。
 *
 * 侧边栏已有的 WorkspaceSwitcher 只做「切换 + 弹窗式成员管理」；这里给用户中心一个
 * 完整的管理面：空间列表、创建、当前空间成员与 RBAC 角色、邀请 / 移除成员。
 *
 * 安全与边界：
 *   - 成员增删由服务端 RBAC 裁决（permissions.canManageMembers），前端只按同一结果
 *     隐藏入口，不作为授权依据；
 *   - 最后一个 owner 不允许被移除（与主流产品一致：空间必须始终有 owner）；
 *   - 匿名身份可以查看自己的空间，但「团队邀请」需要登录账号才有意义，界面明确提示。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { SectionState } from '@/components/user-center/section-state'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import {
  addWorkspaceMember,
  createWorkspace,
  fetchWorkspaceMembers,
  fetchWorkspaces,
  removeWorkspaceMember,
  type HubWorkspace,
  type HubWorkspaceMember,
  type HubWorkspaceRole,
} from '@/lib/navhub-api'
import {
  Building2,
  Check,
  Crown,
  Eye,
  Loader2,
  Plus,
  Shield,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react'

const ROLE_META: Record<HubWorkspaceRole, { label: string; icon: typeof Crown; cls: string }> = {
  owner: { label: '所有者', icon: Crown, cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  maintainer: { label: '管理员', icon: Shield, cls: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' },
  member: { label: '成员', icon: UserCheck, cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  viewer: { label: '只读', icon: Eye, cls: 'border-border bg-muted text-muted-foreground' },
}

const ROLE_OPTIONS: HubWorkspaceRole[] = ['member', 'viewer', 'maintainer', 'owner']

function RoleBadge({ role }: { role: HubWorkspaceRole }) {
  const meta = ROLE_META[role] ?? ROLE_META.member
  const Icon = meta.icon
  return (
    <Badge variant="outline" className={`gap-1 whitespace-nowrap ${meta.cls}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </Badge>
  )
}

export default function WorkspacesPage() {
  const { toast } = useToast()
  const identityReady = useIdentityReady()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<HubWorkspace[]>([])
  const [activeId, setActiveId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newType, setNewType] = useState<'personal' | 'team'>('team')
  const [memberBusy, setMemberBusy] = useState(false)
  const [members, setMembers] = useState<HubWorkspaceMember[]>([])
  const [permissions, setPermissions] = useState<Record<string, boolean>>({})
  const [membersLoading, setMembersLoading] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<HubWorkspaceRole>('member')

  const active = useMemo(() => workspaces.find((w) => w.id === activeId) ?? null, [workspaces, activeId])
  const canManage = Boolean(permissions.canManageMembers)

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const res = await fetchWorkspaces()
      if (!res.ok) throw new Error('工作空间暂时取不到')
      setWorkspaces(res.items)
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('navhub_active_ws') : null
      const current = res.items.find((w) => w.id === saved) ?? res.items[0]
      setActiveId(current?.id ?? '')
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '工作空间暂时取不到')
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (!identityReady.ready) return
    void load()
  }, [identityReady.ready, load])

  const selectWorkspace = useCallback((ws: HubWorkspace) => {
    setActiveId(ws.id)
    try {
      window.localStorage.setItem('navhub_active_ws', ws.id)
    } catch {
      // 存储不可用时仅在当前页面生效
    }
  }, [])

  const loadMembers = useCallback(async (id: string) => {
    if (!id) return
    setMembersLoading(true)
    try {
      const res = await fetchWorkspaceMembers(id)
      if (!res.ok) throw new Error('成员列表暂时取不到')
      setMembers(res.members)
      setPermissions(res.permissions ?? {})
    } catch {
      setMembers([])
      setPermissions({})
      toast({ title: '成员列表暂时取不到', description: '稍后重试；这不代表空间没有成员。', variant: 'destructive' })
    } finally {
      setMembersLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (!active?.id) return
    void loadMembers(active.id)
  }, [active?.id, loadMembers])

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const res = await createWorkspace({
        name,
        description: newDesc.trim() || undefined,
        type: identityReady.isAnonymous ? 'personal' : newType,
      })
      if (!res.ok) throw new Error('创建失败')
      toast({ title: `已创建「${res.workspace.name}」` })
      setCreateOpen(false)
      setNewName('')
      setNewDesc('')
      await load()
      selectWorkspace(res.workspace)
    } catch (err) {
      toast({
        title: '创建工作空间失败',
        description: err instanceof Error ? err.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }, [creating, identityReady.isAnonymous, load, newDesc, newName, newType, selectWorkspace, toast])

  const handleInvite = useCallback(async () => {
    if (!active || memberBusy) return
    const username = inviteName.trim()
    if (!username) {
      toast({ title: '请填写成员用户名', variant: 'destructive' })
      return
    }
    setMemberBusy(true)
    try {
      const res = await addWorkspaceMember(active.id, {
        username,
        role: inviteRole,
        ...(inviteEmail.trim() ? { email: inviteEmail.trim() } : {}),
      })
      if (!res.ok) throw new Error('邀请失败')
      setMembers(res.members)
      setInviteName('')
      setInviteEmail('')
      toast({ title: `已把 ${username} 加入「${active.name}」`, description: `角色：${ROLE_META[inviteRole].label}` })
    } catch (err) {
      toast({
        title: '邀请成员失败',
        description: err instanceof Error ? err.message : '请确认用户名与权限后再试',
        variant: 'destructive',
      })
    } finally {
      setMemberBusy(false)
    }
  }, [active, inviteEmail, inviteName, inviteRole, memberBusy, toast])

  const handleRemove = useCallback(
    async (member: HubWorkspaceMember) => {
      if (!active || memberBusy) return
      const ownerCount = members.filter((m) => m.role === 'owner').length
      if (member.role === 'owner' && ownerCount <= 1) {
        toast({ title: '不能移除最后一个所有者', description: '请先把其他成员设为所有者。', variant: 'destructive' })
        return
      }
      setMemberBusy(true)
      try {
        const res = await removeWorkspaceMember(active.id, member.userId)
        if (!res.ok) throw new Error('移除失败')
        setMembers(res.members)
        toast({ title: `已移除 ${member.username}` })
      } catch (err) {
        toast({
          title: '移除成员失败',
          description: err instanceof Error ? err.message : '请稍后重试',
          variant: 'destructive',
        })
      } finally {
        setMemberBusy(false)
      }
    },
    [active, memberBusy, members, toast],
  )

  return (
    <Container as="main" id="main-content" className="space-y-5 pb-8 pt-3 sm:space-y-6 sm:pb-10 sm:pt-4">
      <CenterPageHeader
        title="工作空间"
        icon={Users}
        eyebrow="协作"
        back={{ href: '/me', label: '用户中心' }}
        description="个人空间与团队空间、成员角色（所有者 / 管理员 / 成员 / 只读）都在这里管理。"
        actions={
          <Button size="sm" className="w-full text-xs sm:w-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            新建空间
          </Button>
        }
      />

      {state === 'loading' && <SectionState variant="loading" rows={3} rowClassName="h-24" loadingLabel="正在加载工作空间" />}

      {state === 'error' && (
        <SectionState
          variant="error"
          title="工作空间暂时取不到"
          description={error ?? '中枢暂时不可用，这不代表空间被删除。'}
          onRetry={() => void load()}
        />
      )}

      {state === 'ready' && workspaces.length === 0 && (
        <SectionState
          variant="empty"
          icon={Building2}
          title="还没有工作空间"
          description="创建一个个人空间或团队空间后，就能在这里管理成员与角色。"
          action={
            <Button size="sm" className="text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              新建空间
            </Button>
          }
        />
      )}

      {state === 'ready' && workspaces.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-12">
          <section aria-label="工作空间列表" className="space-y-2 lg:col-span-5">
            {workspaces.map((ws) => {
              const selected = ws.id === activeId
              return (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => selectWorkspace(ws)}
                  aria-pressed={selected}
                  className={`w-full rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selected
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border/70 bg-card/60 hover:border-border hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {ws.type === 'personal' ? (
                        <UserCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      ) : (
                        <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{ws.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {ws.type === 'personal' ? '个人空间' : '团队空间'} · {ws.memberCount} 位成员
                        </span>
                      </span>
                    </span>
                    {selected ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
                  </div>
                  {ws.description ? (
                    <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{ws.description}</p>
                  ) : null}
                  <div className="mt-2">
                    <RoleBadge role={ws.role} />
                  </div>
                </button>
              )
            })}
          </section>

          <section aria-label="成员与权限" className="lg:col-span-7">
            {active ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">「{active.name}」成员</h2>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {canManage ? '你可以添加或移除成员' : '只有所有者 / 管理员可以管理成员'}
                      </p>
                    </div>
                    {identityReady.isAnonymous && (
                      <Button asChild variant="outline" size="sm" className="text-xs">
                        <Link href="/auth/signin?callbackUrl=/me/workspaces">登录后邀请协作者</Link>
                      </Button>
                    )}
                  </div>

                  {membersLoading ? (
                    <div className="mt-3 space-y-2" aria-busy="true">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-12 animate-pulse rounded-xl border border-border/60 bg-background/50" />
                      ))}
                    </div>
                  ) : (
                    <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
                      {members.map((member) => {
                        const ownerCount = members.filter((m) => m.role === 'owner').length
                        const removeDisabled = !canManage || memberBusy || (member.role === 'owner' && ownerCount <= 1)
                        return (
                          <li key={member.userId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium">{member.username}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {member.email ?? member.userId.slice(0, 12)}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <RoleBadge role={member.role} />
                              {canManage && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  disabled={removeDisabled}
                                  title={
                                    member.role === 'owner' && ownerCount <= 1
                                      ? '最后一个所有者不能移除'
                                      : `移除 ${member.username}`
                                  }
                                  aria-label={`移除成员 ${member.username}`}
                                  onClick={() => void handleRemove(member)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                {canManage && !identityReady.isAnonymous && (
                  <div className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
                    <h2 className="text-sm font-semibold">添加成员</h2>
                    <p className="mt-1 text-[11px] text-muted-foreground">按用户名添加；同一用户名再次提交会更新角色。</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Input
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        placeholder="用户名"
                        aria-label="成员用户名"
                        className="h-9 text-xs"
                      />
                      <Input
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="邮箱（可选）"
                        aria-label="成员邮箱"
                        className="h-9 text-xs"
                      />
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as HubWorkspaceRole)}
                        aria-label="成员角色"
                        className="h-9 rounded-lg border border-border bg-background px-2.5 text-xs"
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_META[role].label}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" className="h-9 text-xs" disabled={memberBusy} onClick={() => void handleInvite()}>
                        {memberBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-2 h-3.5 w-3.5" />}
                        添加成员
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
      )}

      {createOpen && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">新建工作空间</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="ws-name" className="block text-xs font-medium text-muted-foreground">
                  名称
                </label>
                <Input id="ws-name" value={newName} maxLength={64} onChange={(e) => setNewName(e.target.value)} className="h-9 text-xs" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ws-desc" className="block text-xs font-medium text-muted-foreground">
                  描述（可选）
                </label>
                <Input id="ws-desc" value={newDesc} maxLength={200} onChange={(e) => setNewDesc(e.target.value)} className="h-9 text-xs" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ws-type" className="block text-xs font-medium text-muted-foreground">
                  类型
                </label>
                <select
                  id="ws-type"
                  value={identityReady.isAnonymous ? 'personal' : newType}
                  disabled={identityReady.isAnonymous}
                  onChange={(e) => setNewType(e.target.value as 'personal' | 'team')}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                >
                  <option value="team">团队协作</option>
                  <option value="personal">个人私有</option>
                </select>
                {identityReady.isAnonymous && (
                  <p className="text-[11px] text-muted-foreground">匿名身份只能创建个人空间；登录后可创建团队空间。</p>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="text-xs" disabled={creating || !newName.trim()} onClick={() => void handleCreate()}>
                  {creating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  创建
                </Button>
                <Button size="sm" variant="outline" className="text-xs" disabled={creating} onClick={() => setCreateOpen(false)}>
                  取消
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Footer />
    </Container>
  )
}
