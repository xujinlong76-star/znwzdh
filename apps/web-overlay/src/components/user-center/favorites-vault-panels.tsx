'use client'

/**
 * 收藏页的 E2EE 金库面板（P1 从 favorites/page.tsx 抽出）。
 *
 * 为什么抽出来：这两个面板占了页面两百多行 JSX，但它们与「收藏列表 / 同步状态 /
 * 收藏夹管理」没有任何状态共享——只有一组密码表单 + 两个回调。留在页面里会让
 * 主流程（读本地 → 同步 → 渲染列表）被两段表单淹没，改动时也很难看清影响面。
 *
 * 边界约定：本组件**不持有任何状态**，全部由调用方传入。它只负责把表单渲染出来、
 * 把用户输入交还回去。这样它可以在没有 store、没有网络的环境里被单独渲染与测试。
 */
import { Button } from '@/components/ui/button'
import { Download, Eye, EyeOff, KeyRound, Shield } from 'lucide-react'
import type { EncryptedVaultPayload } from '@/lib/vault'

export interface FavoritesVaultPanelsProps {
  /** 当前展开哪个面板；null = 两个都收起 */
  mode: 'export' | 'import' | null
  onClose: () => void
  /** 本地收藏条数（导出按钮上显示"生成并下载 (N 条)"） */
  itemCount: number

  // —— 导出 ——
  password: string
  onPasswordChange: (value: string) => void
  confirmPassword: string
  onConfirmPasswordChange: (value: string) => void
  showPassword: boolean
  onToggleShowPassword: () => void
  exporting: boolean
  onExport: () => void

  // —— 导入 ——
  payload: string
  onPayloadChange: (value: string) => void
  passphrase: string
  onPassphraseChange: (value: string) => void
  onPickFile: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  importing: boolean
  onImport: () => void
}

export function FavoritesVaultPanels(props: FavoritesVaultPanelsProps) {
  const {
    mode, onClose, itemCount,
    password, onPasswordChange, confirmPassword, onConfirmPasswordChange,
    showPassword, onToggleShowPassword, exporting, onExport,
    payload, onPayloadChange, passphrase, onPassphraseChange,
    onPickFile, fileInputRef, onFileChange, importing, onImport,
  } = props

  if (mode === 'export') {
    return (
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
          <Button size="sm" variant="ghost" onClick={onClose}>
            收起
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="vault-password-main" className="text-xs font-medium text-muted-foreground mb-1 block">
              设置金库主密码 (至少 6 位)
            </label>
            <div className="relative">
              <input aria-label="输入强主密码"
                id="vault-password-main"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                placeholder="输入强主密码..."
                className="w-full px-3 py-1.5 text-base sm:text-xs rounded-md border bg-background pr-8"
              />
              <button
                type="button"
                onClick={onToggleShowPassword}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                title={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="vault-password-confirm" className="text-xs font-medium text-muted-foreground mb-1 block">
              确认金库主密码
            </label>
            <input id="vault-password-confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => onConfirmPasswordChange(e.target.value)}
              placeholder="再次输入相同密码..."
              className="w-full px-3 py-1.5 text-base sm:text-xs rounded-md border bg-background"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
            onClick={onExport}
            disabled={exporting || !password || password.length < 6}
          >
            <Download className="w-3.5 h-3.5" />
            {exporting ? '正在派生密钥加密…' : `生成并下载 .navhub.vault (${itemCount} 条)`}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    )
  }

  if (mode === 'import') {
    return (
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
          <Button size="sm" variant="ghost" onClick={onClose}>
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
                onClick={onPickFile}
              >
                选择文件
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".navhub.vault,application/json"
                aria-label="选择金库文件"
                className="hidden"
                onChange={onFileChange}
              />
            </div>
            <textarea aria-label="可直接点击上方按钮选择文件，或在此粘贴密文 JSON"
              value={payload}
              onChange={(e) => onPayloadChange(e.target.value)}
              placeholder="可直接点击上方按钮选择文件，或在此粘贴密文 JSON..."
              className="w-full h-20 rounded-md border bg-background p-2 text-base sm:text-xs font-mono"
            />
          </div>
          <div>
            <label htmlFor="vault-import-passphrase" className="text-xs font-medium text-muted-foreground mb-1 block">金库主密码</label>
            <input
              id="vault-import-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => onPassphraseChange(e.target.value)}
              placeholder="输入解密密码..."
              className="w-full px-3 py-1.5 text-base sm:text-xs rounded-md border bg-background"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5"
            onClick={onImport}
            disabled={importing || !payload.trim() || !passphrase}
          >
            <KeyRound className="w-3.5 h-3.5" />
            {importing ? '正在解密并验证认证码…' : '验证密码并导入'}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    )
  }

  return null
}

/** 供调用方复用同一套密文校验（保持与页面内联版本一致） */
export function isVaultPayloadLike(value: unknown): value is EncryptedVaultPayload {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<EncryptedVaultPayload>
  return Boolean(v.cipherTextBase64 && v.saltHex && v.ivHex)
}
