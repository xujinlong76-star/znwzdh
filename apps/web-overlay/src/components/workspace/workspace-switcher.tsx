'use client'

/**
 * 多租户团队空间与 RBAC 权限切换器 (Workspace Switcher & RBAC Management)
 *
 * 允许用户在个人私有空间与团队协同空间之间自由切换，
 * 并提供细粒度成员角色（Owner/Maintainer/Member/Viewer）分配与权限守卫。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Crown,
  Eye,
  Loader2,
  Plus,
  Shield,
  ShieldAlert,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
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

const ROLE_BADGES: Record<
  HubWorkspaceRole,
  { label: string; icon: typeof Shield; color: string }
> = {
  owner: { label: '空间所有者', icon: Crown, color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' },
  maintainer: { label: '空间管理员', icon: Shield, color: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20' },
  member: { label: '协作成员', icon: UserCheck, color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
  viewer: { label: '只读访客', icon: Eye, color: 'text-muted-foreground bg-muted border-border' },
}

export function WorkspaceSwitcher() {
  const { toast } = useToast()
  const [workspaces, setWorkspaces] = useState<HubWorkspace[]>([])
  const [activeWs, setActiveWs] = useState<HubWorkspace | null>(null)
  const [loading, setLoading] = useState(true)

  // 弹窗状态
  const [createOpen, setCreateOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  // 新建表单
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  // 成员管理状态
  const [members, setMembers] = useState<HubWorkspaceMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [inviteUsername, setInviteUsername] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<HubWorkspaceRole>('member')
  const [inviting, setInviting] = useState(false)

  const loadWorkspaces = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchWorkspaces()
      if (res.ok && res.items.length > 0) {
        setWorkspaces(res.items)
        const savedWsId = typeof window !== 'undefined' ? localStorage.getItem('navhub_active_ws') : null
        const current = res.items.find((w) => w.id === savedWsId) || res.items[0]!
        setActiveWs(current)
      }
    } catch {
      // 容错降级
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  const selectWorkspace = (ws: HubWorkspace) => {
    setActiveWs(ws)
    if (typeof window !== 'undefined') {
      localStorage.setItem('navhub_active_ws', ws.id)
    }
    toast({
      title: `已切换至「${ws.name}」`,
      description: `空间类型：${ws.type === 'personal' ? '个人私有' : '团队协作'} · 权限：${ROLE_BADGES[ws.role]?.label || ws.role}`,
    })
  }

  // 加载成员列表
  const openMemberManage = async () => {
    if (!activeWs) return
    setManageOpen(true)
    setMembersLoading(true)
    try {
      const res = await fetchWorkspaceMembers(activeWs.id)
      if (res.ok) {
        setMembers(res.members)
      }
    } catch {
      // 容错
    } finally {
      setMembersLoading(false)
    }
  }

  // 创建空间
  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await createWorkspace({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        type: 'team',
      })
      if (res.ok) {
        toast({ title: '空间创建成功', description: `已进入新团队空间「${res.workspace.name}」` })
        setNewName('')
        setNewDesc('')
        setCreateOpen(false)
        await loadWorkspaces()
        setActiveWs(res.workspace)
      }
    } catch (err) {
      toast({
        title: '创建失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }

  // 邀请/更新成员
  const handleInvite = async () => {
    if (!activeWs || !inviteUsername.trim()) return
    setInviting(true)
    try {
      const res = await addWorkspaceMember(activeWs.id, {
        username: inviteUsername.trim(),
        role: inviteRole,
        email: inviteEmail.trim() || undefined,
      })
      if (res.ok) {
        toast({ title: '成员设置已生效', description: `用户 ${inviteUsername.trim()} 已更新为 ${ROLE_BADGES[inviteRole]?.label}` })
        setMembers(res.members)
        setInviteUsername('')
        setInviteEmail('')
      }
    } catch (err) {
      toast({
        title: '操作失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setInviting(false)
    }
  }

  // 移除成员
  const handleRemoveMember = async (userId: string) => {
    if (!activeWs) return
    try {
      const res = await removeWorkspaceMember(activeWs.id, userId)
      if (res.ok) {
        toast({ title: '已移除成员' })
        setMembers(res.members)
      }
    } catch (err) {
      toast({
        title: '移除失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  if (loading || !activeWs) {
    return (
      <div className="h-8 w-28 rounded-md bg-muted/40 animate-pulse hidden sm:block" />
    )
  }

  const roleMeta = ROLE_BADGES[activeWs.role] || ROLE_BADGES.viewer
  const RoleIcon = roleMeta.icon

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="选择工作空间与团队"
            className="h-8 gap-2 px-2.5 text-xs text-foreground hover:bg-accent/60 transition-colors border border-transparent hover:border-border/60"
          >
            {activeWs.type === 'personal' ? (
              <User className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Building2 className="h-3.5 w-3.5 text-indigo-500" />
            )}
            <span className="max-w-[120px] truncate font-medium">
              {activeWs.name}
            </span>
            <Badge variant="outline" className={`px-1.5 py-0 text-[10px] hidden md:inline-flex ${roleMeta.color}`}>
              <RoleIcon className="mr-0.5 h-2.5 w-2.5" />
              {roleMeta.label}
            </Badge>
            <ChevronDown className="h-3 w-3 text-muted-foreground opacity-60" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64 text-xs">
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">
            切换工作空间 (Workspaces)
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {workspaces.map((ws) => {
            const isSelected = ws.id === activeWs.id
            const wsRole = ROLE_BADGES[ws.role] || ROLE_BADGES.viewer
            return (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => selectWorkspace(ws)}
                className="flex items-center justify-between py-2 cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {ws.type === 'personal' ? (
                    <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Building2 className="h-4 w-4 shrink-0 text-indigo-500" />
                  )}
                  <div className="truncate">
                    <div className="font-medium truncate">{ws.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {ws.type === 'personal' ? '私密空间' : `${ws.memberCount} 位成员`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <Badge variant="outline" className={`text-[10px] px-1 py-0 ${wsRole.color}`}>
                    {wsRole.label}
                  </Badge>
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                </div>
              </DropdownMenuItem>
            )
          })}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => void openMemberManage()}
            className="cursor-pointer gap-2 py-2"
          >
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span>空间成员与 RBAC 权限</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setCreateOpen(true)}
            className="cursor-pointer gap-2 py-2 text-indigo-600 dark:text-indigo-400"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建团队协同空间</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 新建空间弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4 text-indigo-500" />
              创建全新团队协同空间
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2 text-xs">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">空间名称</Label>
              <Input
                id="ws-name"
                placeholder="例如：技术研发导航、市场运营协同中心"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                aria-label="团队空间名称"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ws-desc">空间定位与说明（可选）</Label>
              <Input
                id="ws-desc"
                placeholder="简述该空间的适用团队或内容定位"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                aria-label="空间说明"
              />
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground">
              创建后您将自动成为该空间的 <span className="font-semibold text-foreground">所有者 (Owner)</span>，拥有完整的站点编辑、成员角色分配与安全审计权限。
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => void handleCreate()}
                disabled={creating || !newName.trim()}
              >
                {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                立即创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 成员与 RBAC 管理弹窗 */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-sm font-semibold">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-500" />
                「{activeWs.name}」成员与权限管理
              </span>
              <Badge variant="outline" className={`text-xs ${roleMeta.color}`}>
                您的身份：{roleMeta.label}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2 text-xs">
            {/* 权限说明 */}
            <div className="rounded-lg border bg-muted/30 p-3 text-[11px] text-muted-foreground grid grid-cols-2 gap-2">
              <div>👑 <strong className="text-foreground">Owner:</strong> 全权拥有、空间配置与销毁</div>
              <div>🛡️ <strong className="text-foreground">Maintainer:</strong> 站点发布、成员角色分配</div>
              <div>👥 <strong className="text-foreground">Member:</strong> 常用站点添加与编辑</div>
              <div>👁️ <strong className="text-foreground">Viewer:</strong> 仅只读浏览与检索</div>
            </div>

            {/* 添加/更新成员表单 */}
            <div className="rounded-lg border bg-card p-3.5 space-y-3">
              <h4 className="font-semibold text-foreground flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5 text-indigo-500" />
                添加成员或调整角色
              </h4>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  placeholder="用户名 / 工号"
                  value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                  className="text-xs"
                  aria-label="待添加成员用户名"
                />
                <select
                  aria-label="成员权限角色"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as HubWorkspaceRole)}
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="member">👥 协作成员 (Member)</option>
                  <option value="maintainer">🛡️ 管理员 (Maintainer)</option>
                  <option value="viewer">👁️ 只读访客 (Viewer)</option>
                  <option value="owner">👑 空间所有者 (Owner)</option>
                </select>
                <Button
                  size="sm"
                  onClick={() => void handleInvite()}
                  disabled={inviting || !inviteUsername.trim()}
                  className="h-8 text-xs"
                >
                  {inviting ? <Loader2 className="h-3 w-3 animate-spin" /> : '确认授权'}
                </Button>
              </div>
            </div>

            {/* 现有成员列表 */}
            <div className="space-y-2">
              <h4 className="font-semibold text-foreground">空间现有成员 ({members.length})</h4>
              <div className="max-h-52 overflow-y-auto divide-y rounded-lg border bg-card">
                {membersLoading ? (
                  <div className="p-6 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin mb-1" />
                    正在同步成员权限…
                  </div>
                ) : members.length > 0 ? (
                  members.map((m) => {
                    const mRole = ROLE_BADGES[m.role] || ROLE_BADGES.viewer
                    const MIcon = mRole.icon
                    return (
                      <div key={m.userId} className="flex items-center justify-between p-2.5 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs uppercase shrink-0">
                            {m.username.slice(0, 1)}
                          </div>
                          <div className="truncate">
                            <div className="font-medium text-foreground truncate">{m.username}</div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {m.email || '内部协同用户'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className={`text-[10px] ${mRole.color}`}>
                            <MIcon className="mr-0.5 h-2.5 w-2.5" />
                            {mRole.label}
                          </Badge>
                          {m.role !== 'owner' && (
                            <button
                              type="button"
                              aria-label={`移除成员 ${m.username}`}
                              onClick={() => void handleRemoveMember(m.userId)}
                              className="text-muted-foreground hover:text-destructive p-1 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="p-6 text-center text-muted-foreground">暂无成员</div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
