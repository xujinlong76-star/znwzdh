'use client'

/**
 * 我的场景 — 管理对话框（小屏用底部抽屉形态由 Dialog 的响应式样式承担，
 * 内容区可滚动；新建 / 重命名 / 删除 / 设默认 / 用当前状态更新）。
 *
 * 删除只删场景记录，不删布局与置顶；删除当前生效场景按回落链走：
 * 默认场景 → 切换前自动备份 → 原地不动。绝不重置为系统默认布局。
 * 布局改了场景不跟变——对话框顶部一句话写明白。
 */
import React from 'react'
import { Check, Pencil, RefreshCw, Star, Trash2 } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
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
import { Input } from '@/registry/new-york/ui/input'
import { useTheme } from 'next-themes'
import { useToast } from '@/components/ui/use-toast'
import { getActiveTheme } from '@/lib/plugins/theme-runtime'
import {
  applyScene,
  deleteActiveSceneFallback,
  getRegisteredSceneSiteIndex,
  rollbackSceneSwitch,
  sceneSwitchSuccessText,
} from '@/lib/modular/scene-apply'
import { buildLiveSceneDeps, buildLiveSceneDepsAsync } from '@/lib/modular/scene-apply-live'
import { ensureHomeCategoriesLoaded } from '@/lib/modular/home-category-loader'
import {
  MAX_USER_SCENES,
  browserUserSceneStorage,
  clearSceneSwitchFlag,
  createUserScene,
  deleteUserScene,
  markSceneSwitchStarted,
  renameUserScene,
  setDefaultUserScene,
  updateSceneFromCurrent,
  type UserScene,
  type UserSceneWorkspaceFilter,
} from '@/lib/modular/user-scenes'
import { captureCurrentSceneState, shouldClearSwitchFlag, useUserScenes } from '@/components/scene-switcher'

export function SceneManagerDialog({
  open,
  onOpenChange,
  activeWorkspace,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeWorkspace?: UserSceneWorkspaceFilter
}) {
  const { toast } = useToast()
  const { theme, setTheme } = useTheme()
  const { doc, save } = useUserScenes()
  const [newName, setNewName] = React.useState('')
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameValue, setRenameValue] = React.useState('')
  const [deleting, setDeleting] = React.useState<UserScene | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const liveDeps = React.useCallback(() => {
    const deps = buildLiveSceneDeps({
      getMode: () => theme ?? null,
      setMode: (mode) => setTheme(mode),
    })
    deps.siteIndex = getRegisteredSceneSiteIndex()
    return deps
  }, [theme, setTheme])

  /** 回落切换用的 deps：有皮肤时先拉已装列表，已装皮肤跳过安装（与下拉切换同口径） */
  const liveDepsAsync = React.useCallback(async (scene: UserScene) => {
    const base = {
      getMode: () => theme ?? null,
      setMode: (mode: string) => setTheme(mode),
    }
    const deps = scene.theme.skinSlug
      ? await buildLiveSceneDepsAsync(base)
      : buildLiveSceneDeps(base)
    // flight 分片：场景应用前先取齐全部分类（同 scene-switcher）。
    await ensureHomeCategoriesLoaded()
    deps.siteIndex = getRegisteredSceneSiteIndex()
    return deps
  }, [theme, setTheme])

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) {
      toast({ title: '请先输入场景名称', description: '名称 1–20 字。', variant: 'destructive' })
      return
    }
    const created = createUserScene(doc, {
      name,
      state: captureCurrentSceneState(activeWorkspace, theme),
    })
    if (!created.ok || !created.doc || !created.scene) {
      toast({ title: '新建场景失败', description: created.reason ?? '请稍后再试。', variant: 'destructive' })
      return
    }
    if (!save(created.doc)) {
      toast({ title: '新建场景失败', description: '本地存储写入失败，场景没有保存下来。', variant: 'destructive' })
      return
    }
    if (created.duplicateName) {
      toast({ title: `已新建场景「${created.scene.name}」`, description: '已有同名场景，请注意区分。' })
    } else {
      toast({
        title: `已新建场景「${created.scene.name}」`,
        description: `置顶 ${created.scene.pinnedSiteIds.length} 个站点 · 皮肤「${created.scene.theme.skinName ?? '系统默认'}」· 当前布局已存入场景。`,
      })
    }
    setNewName('')
  }

  const handleRename = (scene: UserScene) => {
    const renamed = renameUserScene(doc, scene.id, renameValue)
    if (!renamed.ok || !renamed.doc) {
      toast({ title: '重命名失败', description: renamed.reason ?? '请稍后再试。', variant: 'destructive' })
      return
    }
    if (!save(renamed.doc)) {
      toast({ title: '重命名失败', description: '本地存储写入失败。', variant: 'destructive' })
      return
    }
    if (renamed.duplicateName) {
      toast({ title: `已重命名为「${renameValue.trim()}」`, description: '已有同名场景，请注意区分。' })
    }
    setRenamingId(null)
  }

  const handleUpdateFromCurrent = (scene: UserScene) => {
    const updated = updateSceneFromCurrent(doc, scene.id, captureCurrentSceneState(activeWorkspace, theme))
    if (!updated.ok || !updated.doc) {
      toast({ title: '更新失败', description: updated.reason ?? '请稍后再试。', variant: 'destructive' })
      return
    }
    if (!save(updated.doc)) {
      toast({ title: '更新失败', description: '本地存储写入失败。', variant: 'destructive' })
      return
    }
    toast({ title: `已用当前状态更新「${scene.name}」`, description: '置顶、皮肤与布局已重新捕获。' })
  }

  const handleSetDefault = (scene: UserScene) => {
    const next = setDefaultUserScene(doc, scene.id)
    if (!next.ok || !next.doc) {
      toast({ title: '设默认失败', description: next.reason ?? '请稍后再试。', variant: 'destructive' })
      return
    }
    if (!save(next.doc)) {
      toast({ title: '设默认失败', description: '本地存储写入失败。', variant: 'destructive' })
      return
    }
    toast({ title: `已把「${scene.name}」设为默认场景`, description: '默认场景不在启动时自动应用；删除当前场景时会优先回落到它。' })
  }

  const handleDelete = async (scene: UserScene) => {
    setDeleting(null)
    const deleted = deleteUserScene(doc, scene.id)
    if (!deleted.ok || !deleted.doc) {
      toast({ title: '删除失败', description: deleted.reason ?? '请稍后再试。', variant: 'destructive' })
      return
    }
    if (!deleted.wasActive) {
      if (!save(deleted.doc)) {
        toast({ title: '删除失败', description: '本地存储写入失败。', variant: 'destructive' })
        return
      }
      toast({ title: `已删除场景「${scene.name}」`, description: '只删了场景记录，你的布局与置顶不受影响。' })
      return
    }
    // 删除的是当前生效场景：按回落链走，绝不重置为系统默认布局
    const fallback = deleteActiveSceneFallback(doc, scene.id)
    if (fallback.kind === 'switch-to-default') {
      setBusyId(scene.id)
      try {
        // 回落切换同样是真切换：开始前置旗标，成功或回滚后清除
        const flagStorage = browserUserSceneStorage()
        if (flagStorage) markSceneSwitchStarted(flagStorage, fallback.scene.id)
        const result = await applyScene(fallback.scene, deleted.doc, await liveDepsAsync(fallback.scene))
        if (flagStorage && shouldClearSwitchFlag(result)) {
          clearSceneSwitchFlag(flagStorage)
        }
        if (result.ok && result.doc) {
          save(result.doc)
          toast({
            title: `已删除「${scene.name}」，已回落到默认场景「${fallback.scene.name}」`,
            description: result.summary ? sceneSwitchSuccessText(fallback.scene.name, result.summary) : undefined,
          })
        } else {
          save(deleted.doc)
          toast({
            title: `已删除「${scene.name}」，回落切换失败`,
            description: '当前页面保持不变，可手动切换其他场景。',
            variant: 'destructive',
          })
        }
      } finally {
        setBusyId(null)
      }
      return
    }
    if (fallback.kind === 'restore-backup') {
      const ok = rollbackSceneSwitch(fallback.backup, liveDeps())
      save({ ...deleted.doc, lastSwitchBackup: fallback.backup })
      toast({
        title: `已删除「${scene.name}」，已恢复到切换前状态`,
        description: ok ? '布局、皮肤与明暗模式已还原。' : '备份还原未完全成功，当前页面保持不变。',
      })
      return
    }
    save(deleted.doc)
    toast({ title: `已删除场景「${scene.name}」`, description: '当前页面保持不变，只把当前场景标记清掉了。' })
  }

  const atLimit = doc.scenes.length >= MAX_USER_SCENES

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>管理我的场景</DialogTitle>
            <DialogDescription>
              场景是某一刻的置顶 + 皮肤 + 布局快照；布局改了场景不跟变，
              用「用当前状态更新」重新捕获。场景只存在本机，不跨设备；
              切换不改变沉浸工作台的看板。
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={atLimit ? `场景已满（${MAX_USER_SCENES} 个），请先删除不用的` : '新场景名称（1–20 字），保存当前状态'}
              maxLength={20}
              disabled={atLimit}
              aria-label="新场景名称"
            />
            <Button onClick={handleCreate} disabled={atLimit || !newName.trim()}>
              新建场景
            </Button>
          </div>
          {atLimit && (
            <p className="text-xs text-muted-foreground">
              场景已满（{MAX_USER_SCENES} 个），请先删除不用的场景再新建。
            </p>
          )}

          {doc.scenes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              还没有场景。先把首页调成想要的样子，再点「新建场景」把当前置顶、皮肤与布局存下来。
            </p>
          ) : (
            <ul className="space-y-2">
              {doc.scenes.map((scene) => {
                const isActive = scene.id === doc.activeSceneId
                const isDefault = scene.id === doc.defaultSceneId
                return (
                  <li key={scene.id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-base leading-none" aria-hidden>
                        {scene.icon ?? scene.name.slice(0, 1)}
                      </span>
                      {renamingId === scene.id ? (
                        <span className="flex min-w-0 flex-1 gap-2">
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            maxLength={20}
                            aria-label="场景新名称"
                            autoFocus
                          />
                          <Button size="sm" onClick={() => handleRename(scene)} disabled={!renameValue.trim()}>
                            保存
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                            取消
                          </Button>
                        </span>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {scene.name}
                              {isActive ? ' · 当前' : ''}
                              {isDefault ? ' · 默认' : ''}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              置顶 {scene.pinnedSiteIds.length} 个站点 · {scene.theme.skinName ?? '系统默认皮肤'}
                              {scene.theme.mode === 'dark' ? ' · 深色' : scene.theme.mode === 'light' ? ' · 浅色' : ''}
                            </span>
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setRenamingId(scene.id)
                              setRenameValue(scene.name)
                            }}
                            aria-label={`重命名${scene.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUpdateFromCurrent(scene)}
                        disabled={busyId !== null}
                      >
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />
                        用当前状态更新
                      </Button>
                      {!isDefault && (
                        <Button size="sm" variant="outline" onClick={() => handleSetDefault(scene)}>
                          <Star className="mr-1 h-3.5 w-3.5" />
                          设为默认
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive-text"
                        onClick={() => setDeleting(scene)}
                        disabled={busyId !== null}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        删除
                      </Button>
                      {isActive && <Check className="h-4 w-4 self-center text-primary" aria-label="当前生效场景" />}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            当前皮肤：{getActiveTheme()?.name ?? '系统默认'}。默认场景不在启动时自动应用。
          </p>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除场景「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              只删场景记录，不删你的布局与置顶。
              {deleting?.id === doc.activeSceneId
                ? '这是当前生效的场景，删除后会优先回落到默认场景，没有默认场景时恢复到切换前状态，再没有就保持当前页面不变。'
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && void handleDelete(deleting)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除场景
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
