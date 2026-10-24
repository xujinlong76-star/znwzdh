/**
 * 站点管理的五个受控弹窗（新增 / 编辑 / 批量删除 / 批量移动 / 单删确认）。
 * 从 page.tsx 拆出（第五批 A2）：弹窗内容走 Radix portal，在页面树中的位置
 * 不影响渲染；「添加站点」触发按钮因需要内联在工具栏，留在页面侧（受控 onClick）。
 * 状态与处理器仍归页面，通过 props 透传——标识符与页面同名，保证行为零漂移。
 */
'use client'

import type { Dispatch, SetStateAction } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/registry/new-york/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/registry/new-york/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/registry/new-york/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/registry/new-york/ui/select'
import { Icons } from '@/components/icons'
import type { Category, Site } from './types'

type Setter<T> = Dispatch<SetStateAction<T>>

export interface SiteDraft {
  name: string
  url: string
  description: string
  icon: string
  useDefaultIcon: boolean
  categoryId: string
  subCategoryId: string
}

export interface SitelistDialogsProps {
  sites: Site[]
  navigationData: Category[]
  selectedSites: string[]
  newSite: SiteDraft
  setNewSite: Setter<SiteDraft>
  editSite: SiteDraft
  setEditSite: Setter<SiteDraft>
  deletingSite: Site | null
  showAddDialog: boolean
  onAddDialogOpenChange: (open: boolean) => void
  setShowAddDialog: (v: boolean) => void
  showEditDialog: boolean
  setShowEditDialog: (v: boolean) => void
  showDeleteSiteDialog: boolean
  setShowDeleteSiteDialog: (v: boolean) => void
  showDeleteDialog: boolean
  setShowDeleteDialog: (v: boolean) => void
  showMoveDialog: boolean
  setShowMoveDialog: (v: boolean) => void
  moveTargetCategoryId: string
  setMoveTargetCategoryId: Setter<string>
  moveTargetSubCategoryId: string
  setMoveTargetSubCategoryId: Setter<string>
  isAddingSubmitting: boolean
  isEditingSubmitting: boolean
  isUploadingAddIcon: boolean
  isUploadingEditIcon: boolean
  isFetchingAddMetadata: boolean
  isFetchingEditMetadata: boolean
  isBatchDeleting: boolean
  isBatchMoving: boolean
  handleAddSite: () => void
  handleEditSite: () => void
  handleDeleteSite: () => void
  handleBatchDelete: () => void
  handleBatchMove: () => void
  handleIconUpload: (file: File, isEdit?: boolean) => void
  fetchWebsiteMetadata: (url: string, isEdit?: boolean, forceUpdate?: boolean) => void
  isValidUrl: (url: string) => boolean
}

export function SitelistDialogs(props: SitelistDialogsProps) {
  const {
    navigationData,
    selectedSites,
    newSite,
    setNewSite,
    editSite,
    setEditSite,
    deletingSite,
    showAddDialog,
    onAddDialogOpenChange,
    setShowAddDialog,
    showEditDialog,
    setShowEditDialog,
    showDeleteSiteDialog,
    setShowDeleteSiteDialog,
    showDeleteDialog,
    setShowDeleteDialog,
    showMoveDialog,
    setShowMoveDialog,
    moveTargetCategoryId,
    setMoveTargetCategoryId,
    moveTargetSubCategoryId,
    setMoveTargetSubCategoryId,
    isAddingSubmitting,
    isEditingSubmitting,
    isUploadingAddIcon,
    isUploadingEditIcon,
    isFetchingAddMetadata,
    isFetchingEditMetadata,
    isBatchDeleting,
    isBatchMoving,
    handleAddSite,
    handleEditSite,
    handleDeleteSite,
    handleBatchDelete,
    handleBatchMove,
    handleIconUpload,
    fetchWebsiteMetadata,
    isValidUrl,
  } = props
  return (
    <>
            <Dialog open={showAddDialog} onOpenChange={onAddDialogOpenChange}>

              <DialogContent className="w-[calc(100%-2rem)] sm:max-w-[460px] max-h-[85dvh] flex flex-col p-4 sm:p-6">
                <DialogHeader className="pr-8 sm:pr-6">
                  <DialogTitle>添加站点</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-1">
                  <div className="grid gap-2">
                    <Label htmlFor="url">站点链接 *</Label>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <div className="relative flex-1">
                        <Input
                          id="url"
                          value={newSite.url}
                          onChange={(e) => setNewSite({ ...newSite, url: e.target.value })}
                          placeholder="输入网站链接，将自动获取网站信息"
                          disabled={isAddingSubmitting}
                        />
                        {isFetchingAddMetadata && (
                          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                            <Icons.loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!newSite.url || !isValidUrl(newSite.url) || isFetchingAddMetadata || isAddingSubmitting}
                        onClick={() => fetchWebsiteMetadata(newSite.url, false, true)}
                      >
                        {isFetchingAddMetadata ? (
                          <Icons.loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Icons.refresh className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      输入完整的网站链接后，系统将自动获取网站标题、描述和图标
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="name">站点名称 *</Label>
                    <Input
                      id="name"
                      value={newSite.name}
                      onChange={(e) => setNewSite({ ...newSite, name: e.target.value })}
                      placeholder="站点名称（可自动获取）"
                      disabled={isAddingSubmitting}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="icon">站点图标</Label>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <div className="flex-1 relative">
                        <Input
                          id="icon"
                          value={newSite.icon}
                          onChange={(e) => setNewSite({ ...newSite, icon: e.target.value })}
                          placeholder="图标URL（可自动获取）"
                          disabled={isAddingSubmitting}
                        />
                        {newSite.icon && (
                          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                            <img
                              src={newSite.icon}
                              alt="图标预览"
                              className="w-4 h-4 object-contain"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement
                                target.style.display = 'none'
                              }}
                            />
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="relative"
                        disabled={isAddingSubmitting || isUploadingAddIcon}
                        onClick={() => {
                          const fileInput = document.getElementById('add-icon-upload')
                          fileInput?.click()
                        }}
                      >
                        {isUploadingAddIcon ? (
                          <>
                            <Icons.loader2 className="mr-2 h-4 w-4 animate-spin" />
                            上传中...
                          </>
                        ) : (
                          <>
                            <Icons.upload className="mr-2 h-4 w-4" />
                            上传图片
                          </>
                        )}
                        <input
                          id="add-icon-upload"
                          aria-label="上传图标文件"
                          type="file"
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0]
                            if (file) {
                              await handleIconUpload(file, false)
                              // 清空文件输入
                              const fileInput = document.getElementById('add-icon-upload') as HTMLInputElement
                              if (fileInput) {
                                fileInput.value = ''
                              }
                            }
                          }}
                          className="hidden"
                        />
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      系统会自动获取网站图标，也可手动输入URL或上传本地图片
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <Label>使用默认图标</Label>
                      <div className="text-xs text-muted-foreground">
                        忽略图标URL，使用首字母色块
                      </div>
                    </div>
                    <Switch
                      checked={newSite.useDefaultIcon}
                      onCheckedChange={(checked) => setNewSite({ ...newSite, useDefaultIcon: checked })}
                      disabled={isAddingSubmitting}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="category">分类 *</Label>
                    <Select
                      value={newSite.categoryId}
                      onValueChange={(value) => {
                        setNewSite({ ...newSite, categoryId: value, subCategoryId: '' })
                      }}
                      disabled={isAddingSubmitting}
                    >
                      <SelectTrigger aria-label="选择分类">
                        <SelectValue placeholder="选择分类" />
                      </SelectTrigger>
                      <SelectContent>
                        {navigationData.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {newSite.categoryId && navigationData.find(cat => cat.id === newSite.categoryId)?.subCategories && (
                    <div className="grid gap-2">
                      <Label htmlFor="subcategory">子分类</Label>
                      <Select
                        value={newSite.subCategoryId || "none"}
                        onValueChange={(value) => setNewSite({ ...newSite, subCategoryId: value === "none" ? "" : value })}
                        disabled={isAddingSubmitting}
                      >
                        <SelectTrigger aria-label="选择子分类（可选）">
                          <SelectValue placeholder="选择子分类（可选）" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">无子分类</SelectItem>
                          {navigationData
                            .find(cat => cat.id === newSite.categoryId)
                            ?.subCategories?.map((subCategory) => (
                              <SelectItem key={subCategory.id} value={subCategory.id}>
                                {subCategory.title}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="grid gap-2">
                    <Label htmlFor="description">描述</Label>
                    <Textarea
                      id="description"
                      value={newSite.description}
                      onChange={(e) => setNewSite({ ...newSite, description: e.target.value })}
                      placeholder="输入站点描述（可选，建议 20-160 字）"
                      className="resize-none"
                      maxLength={160}
                      disabled={isAddingSubmitting}
                    />
                    <p className="text-xs text-muted-foreground">
                      {newSite.description.trim().length === 0
                        ? '待补全：建议填写 20-160 字；过短时详情页会用站点名与分类兜底。'
                        : newSite.description.trim().length < 20
                          ? `待补全：当前 ${newSite.description.trim().length} 字，建议至少 20 字。`
                          : `${newSite.description.trim().length}/160 字`}
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddDialog(false)}
                    disabled={isAddingSubmitting}
                  >
                    取消
                  </Button>
                  <Button onClick={handleAddSite} disabled={isAddingSubmitting}>
                    {isAddingSubmitting && (
                      <Icons.loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {isAddingSubmitting ? "添加中..." : "添加站点"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* 编辑站点对话框 */}
            <Dialog open={showEditDialog} onOpenChange={(open) => {
              if (!open && !isEditingSubmitting) {
                setShowEditDialog(false)
              }
            }}>
              <DialogContent className="w-[calc(100%-2rem)] sm:max-w-[460px] max-h-[85dvh] flex flex-col p-4 sm:p-6">
                <DialogHeader className="pr-8 sm:pr-6">
                  <DialogTitle>编辑站点</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-1">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-url">站点链接 *</Label>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <div className="relative flex-1">
                        <Input
                          id="edit-url"
                          value={editSite.url}
                          onChange={(e) => setEditSite({ ...editSite, url: e.target.value })}
                          placeholder="输入网站链接，将自动获取网站信息"
                          disabled={isEditingSubmitting}
                        />
                        {isFetchingEditMetadata && (
                          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                            <Icons.loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!editSite.url || !isValidUrl(editSite.url) || isFetchingEditMetadata || isEditingSubmitting}
                        onClick={() => fetchWebsiteMetadata(editSite.url, true, true)}
                      >
                        {isFetchingEditMetadata ? (
                          <Icons.loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Icons.refresh className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      输入完整的网站链接后，系统将自动获取网站标题、描述和图标
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-name">站点名称 *</Label>
                    <Input
                      id="edit-name"
                      value={editSite.name}
                      onChange={(e) => setEditSite({ ...editSite, name: e.target.value })}
                      placeholder="站点名称（可自动获取）"
                      disabled={isEditingSubmitting}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-icon">站点图标</Label>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <div className="flex-1 relative">
                        <Input
                          id="edit-icon"
                          value={editSite.icon}
                          onChange={(e) => setEditSite({ ...editSite, icon: e.target.value })}
                          placeholder="图标URL（可自动获取）"
                          disabled={isEditingSubmitting}
                        />
                        {editSite.icon && (
                          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                            <img
                              src={editSite.icon}
                              alt="图标预览"
                              className="w-4 h-4 object-contain"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement
                                target.style.display = 'none'
                              }}
                            />
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="relative"
                        disabled={isEditingSubmitting || isUploadingEditIcon}
                        onClick={() => {
                          const fileInput = document.getElementById('edit-icon-upload')
                          fileInput?.click()
                        }}
                      >
                        {isUploadingEditIcon ? (
                          <>
                            <Icons.loader2 className="mr-2 h-4 w-4 animate-spin" />
                            上传中...
                          </>
                        ) : (
                          <>
                            <Icons.upload className="mr-2 h-4 w-4" />
                            上传图片
                          </>
                        )}
                        <input
                          id="edit-icon-upload"
                          aria-label="替换图标文件"
                          type="file"
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0]
                            if (file) {
                              await handleIconUpload(file, true)
                              // 清空文件输入
                              const fileInput = document.getElementById('edit-icon-upload') as HTMLInputElement
                              if (fileInput) {
                                fileInput.value = ''
                              }
                            }
                          }}
                          className="hidden"
                        />
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      系统会自动获取网站图标，也可手动输入URL或上传本地图片
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <Label>使用默认图标</Label>
                      <div className="text-xs text-muted-foreground">
                        忽略图标URL，使用首字母色块
                      </div>
                    </div>
                    <Switch
                      checked={editSite.useDefaultIcon}
                      onCheckedChange={(checked) => setEditSite({ ...editSite, useDefaultIcon: checked })}
                      disabled={isEditingSubmitting}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-category">分类 *</Label>
                    <Select
                      value={editSite.categoryId}
                      onValueChange={(value) => {
                        setEditSite({ ...editSite, categoryId: value, subCategoryId: '' })
                      }}
                      disabled={isEditingSubmitting}
                    >
                      <SelectTrigger aria-label="选择分类">
                        <SelectValue placeholder="选择分类" />
                      </SelectTrigger>
                      <SelectContent>
                        {navigationData.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {editSite.categoryId && navigationData.find(cat => cat.id === editSite.categoryId)?.subCategories && (
                    <div className="grid gap-2">
                      <Label htmlFor="edit-subcategory">子分类</Label>
                      <Select
                        value={editSite.subCategoryId || "none"}
                        onValueChange={(value) => setEditSite({ ...editSite, subCategoryId: value === "none" ? "" : value })}
                        disabled={isEditingSubmitting}
                      >
                        <SelectTrigger aria-label="选择子分类（可选）">
                          <SelectValue placeholder="选择子分类（可选）" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">无子分类</SelectItem>
                          {navigationData
                            .find(cat => cat.id === editSite.categoryId)
                            ?.subCategories?.map((subCategory) => (
                              <SelectItem key={subCategory.id} value={subCategory.id}>
                                {subCategory.title}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="grid gap-2">
                    <Label htmlFor="edit-description">描述</Label>
                    <Textarea
                      id="edit-description"
                      value={editSite.description}
                      onChange={(e) => setEditSite({ ...editSite, description: e.target.value })}
                      placeholder="输入站点描述（可选，建议 20-160 字）"
                      className="resize-none"
                      maxLength={160}
                      disabled={isEditingSubmitting}
                    />
                    <p className="text-xs text-muted-foreground">
                      {editSite.description.trim().length === 0
                        ? '待补全：建议填写 20-160 字；过短时详情页会用站点名与分类兜底。'
                        : editSite.description.trim().length < 20
                          ? `待补全：当前 ${editSite.description.trim().length} 字，建议至少 20 字。`
                          : `${editSite.description.trim().length}/160 字`}
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowEditDialog(false)}
                    disabled={isEditingSubmitting}
                  >
                    取消
                  </Button>
                  <Button onClick={handleEditSite} disabled={isEditingSubmitting}>
                    {isEditingSubmitting && (
                      <Icons.loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {isEditingSubmitting ? "更新中..." : "更新站点"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* 批量移动对话框 */}
            <Dialog open={showMoveDialog} onOpenChange={(open) => {
              if (!open && !isBatchMoving) {
                setShowMoveDialog(false)
              }
            }}>
              <DialogContent className="w-[calc(100%-2rem)] sm:max-w-[460px] max-h-[85dvh] overflow-y-auto p-4 sm:p-6">
                <DialogHeader className="pr-8 sm:pr-6">
                  <DialogTitle>批量移动站点</DialogTitle>
                  <DialogDescription>
                    将选中的 {selectedSites.length} 个站点移动到指定分类
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="move-category">目标分类 *</Label>
                    <Select
                      value={moveTargetCategoryId}
                      onValueChange={(value) => {
                        setMoveTargetCategoryId(value)
                        setMoveTargetSubCategoryId('')
                      }}
                      disabled={isBatchMoving}
                    >
                      <SelectTrigger aria-label="选择分类">
                        <SelectValue placeholder="选择分类" />
                      </SelectTrigger>
                      <SelectContent>
                        {navigationData.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {moveTargetCategoryId && navigationData.find(cat => cat.id === moveTargetCategoryId)?.subCategories && (
                    <div className="grid gap-2">
                      <Label htmlFor="move-subcategory">目标子分类</Label>
                      <Select
                        value={moveTargetSubCategoryId || "none"}
                        onValueChange={(value) => setMoveTargetSubCategoryId(value === "none" ? "" : value)}
                        disabled={isBatchMoving}
                      >
                        <SelectTrigger aria-label="选择子分类（可选）">
                          <SelectValue placeholder="选择子分类（可选）" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">无子分类</SelectItem>
                          {navigationData
                            .find(cat => cat.id === moveTargetCategoryId)
                            ?.subCategories?.map((subCategory) => (
                              <SelectItem key={subCategory.id} value={subCategory.id}>
                                {subCategory.title}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowMoveDialog(false)}
                    disabled={isBatchMoving}
                  >
                    取消
                  </Button>
                  <Button onClick={handleBatchMove} disabled={isBatchMoving || !moveTargetCategoryId}>
                    {isBatchMoving && (
                      <Icons.loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {isBatchMoving ? "移动中..." : "确认移动"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

<AlertDialog open={showDeleteDialog} onOpenChange={(open) => {
          if (!open && !isBatchDeleting) {
            setShowDeleteDialog(false)
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除选中的 {selectedSites.length} 个站点吗？删除会移入回收站（/admin/trash），可在那里恢复或彻底清除。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBatchDeleting}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleBatchDelete}
                disabled={isBatchDeleting}
                className="bg-red-600 hover:bg-red-700"
              >
                {isBatchDeleting ? (
                  <>
                    <Icons.loader2 className="mr-2 h-4 w-4 animate-spin" />
                    删除中...
                  </>
                ) : (
                  '删除'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 删除单个站点对话框 */}
        <AlertDialog open={showDeleteSiteDialog} onOpenChange={setShowDeleteSiteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除站点</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除站点 &ldquo;{deletingSite?.name}&rdquo; 吗？删除会移入回收站（/admin/trash），可在那里恢复或彻底清除。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteSite}
                className="bg-red-600 hover:bg-red-700"
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </>
  )
}
