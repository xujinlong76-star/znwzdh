'use client'

/**
 * 算法 5：零知识 E2EE 加密金库。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/registry/new-york/ui/input'
import { Badge } from '@/components/ui/badge'
import { ShieldAlert, Check, CheckCircle2, Lock, Unlock } from 'lucide-react'
import { encryptVault, decryptVault, type EncryptedVaultPayload, type VaultItem } from '@/lib/vault'
import { type JsonRpcResponse } from '@/lib/webmcp-bridge'
import { type CandidateItem } from '@/lib/federated-recommendation'
import { type SpeculationCandidate } from '@/lib/speculative-prerender'
import { type VectorClock } from '@/lib/crdt-sync'


export function VaultPanel() {
  /* --- 模块 5：零知识 E2EE 金库状态 --- */
  const [vaultPassword, setVaultPassword] = useState('SecretDev123!')
  const [vaultItems] = useState<VaultItem[]>([
    { id: '1', title: '内部 GitLab 敏捷看板', url: 'https://gitlab.corp.internal/board', isInternal: true },
    { id: '2', title: '生产数据库只读审计', url: 'https://10.0.8.50:9000/db', isInternal: true },
  ])
  const [encryptedPayload, setEncryptedPayload] = useState<EncryptedVaultPayload | null>(null)
  const [decryptInputPassword, setDecryptInputPassword] = useState('SecretDev123!')
  const [decryptedItems, setDecryptedItems] = useState<VaultItem[] | null>(null)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [isEncrypting, setIsEncrypting] = useState(false)

  const handleEncryptVault = async () => {
    setIsEncrypting(true)
    setVaultError(null)
    try {
      const payload = await encryptVault(vaultItems, vaultPassword)
      setEncryptedPayload(payload)
      setDecryptedItems(null)
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsEncrypting(false)
    }
  }

  const handleDecryptVault = async () => {
    if (!encryptedPayload) return
    setVaultError(null)
    try {
      const items = await decryptVault(encryptedPayload, decryptInputPassword)
      setDecryptedItems(items)
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : String(err))
      setDecryptedItems(null)
    }
  }

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-500">
                      <Lock className="w-4 h-4" />
                    </div>
                    <span>本地优先零知识 E2EE 端到端加密金库</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    彻底解决企业内网开发资产与个人隐私书签上云的泄露隐患。采用 PBKDF2 派生密钥与 AES-256-GCM 认证加密，云端仅触碰不可逆密文。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-cyan-500 border-cyan-500/30 bg-cyan-500/5 text-xs">
                  Web Cryptography API
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 左栏：加密封存 */}
                <div className="p-4 sm:p-5 rounded-xl border border-border/60 bg-card space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-cyan-500" />
                      <span>第一步：明文书签与主密码封存</span>
                    </span>
                    <Badge variant="outline" className="text-xs text-cyan-500 border-cyan-500/30 bg-cyan-500/5 px-2 py-0.5">
                      客户端加密
                    </Badge>
                  </div>

                  <div className="space-y-2 text-xs">
                    <label className="text-muted-foreground font-semibold">待加密的内部私密书签：</label>
                    <div className="p-2.5 rounded-lg border border-border/50 bg-muted/30 space-y-1.5 font-mono text-xs">
                      {vaultItems.map((item) => (
                        <div key={item.id} className="flex justify-between items-center text-muted-foreground">
                          <span className="text-foreground font-semibold">{item.title}</span>
                          <span className="truncate max-w-[180px]">{item.url}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="vault-encrypt-passphrase" className="text-xs font-semibold text-muted-foreground">设置主加密密码 (Passphrase)：</label>
                    <Input id="vault-encrypt-passphrase"
                      type="password"
                      value={vaultPassword}
                      onChange={(e) => setVaultPassword(e.target.value)}
                      placeholder="设置用于派生 AES 密钥的强密码..."
                      className="font-mono text-xs h-9 border-border/70"
                    />
                  </div>

                  <Button
                    onClick={handleEncryptVault}
                    disabled={isEncrypting}
                    className="w-full text-xs h-9 bg-cyan-600 hover:bg-cyan-700 text-white shadow-xs"
                  >
                    {isEncrypting ? '派生密钥加密中...' : '执行 AES-256-GCM 零知识加密'}
                  </Button>

                  {encryptedPayload && (
                    <div className="p-3.5 rounded-lg border border-border/50 bg-muted/40 space-y-1.5 text-xs font-mono">
                      <div className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> 密文封包已生成 (AES-GCM):
                      </div>
                      <div className="truncate text-muted-foreground">Salt: {encryptedPayload.saltHex}</div>
                      <div className="truncate text-muted-foreground">IV: {encryptedPayload.ivHex}</div>
                      <div className="truncate text-primary font-bold">Ciphertext: {encryptedPayload.cipherTextBase64.slice(0, 36)}...</div>
                    </div>
                  )}
                </div>

                {/* 右栏：解密验证与防篡改测试 */}
                <div className="p-4 sm:p-5 rounded-xl border border-border/60 bg-card space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold flex items-center gap-1.5">
                      <Unlock className="w-4 h-4 text-emerald-500" />
                      <span>第二步：输入密码解密还原</span>
                    </span>
                    <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5">
                      认证标签校验
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    模拟跨端设备拉取密文后，输入主密码在本地内存还原。可故意输入错误密码测试 AES-GCM 认证标签防篡改防护。
                  </p>

                  <div className="space-y-1.5">
                    <label htmlFor="vault-decrypt-passphrase" className="text-xs font-semibold text-muted-foreground">输入解密密码：</label>
                    <Input id="vault-decrypt-passphrase"
                      type="text"
                      value={decryptInputPassword}
                      onChange={(e) => setDecryptInputPassword(e.target.value)}
                      placeholder="输入正确或错误密码进行测试..."
                      className="font-mono text-xs h-9 border-border/70"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleDecryptVault}
                      disabled={!encryptedPayload}
                      variant="secondary"
                      className="flex-1 text-xs h-9 border border-border/50"
                    >
                      验证并解密金库
                    </Button>
                    <Button
                      onClick={() => setDecryptInputPassword('WrongPass!456')}
                      variant="outline"
                      className="text-xs h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
                    >
                      填入错误密码测试
                    </Button>
                  </div>

                  {vaultError && (
                    <div className="p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-xs text-destructive flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>{vaultError}</span>
                    </div>
                  )}

                  {decryptedItems && (
                    <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 space-y-2 text-xs">
                      <div className="text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" /> 解密成功！还原 {decryptedItems.length} 条私密书签：
                      </div>
                      <div className="space-y-1 font-mono text-xs">
                        {decryptedItems.map((item) => (
                          <div key={item.id} className="p-2 rounded bg-background border border-border/40 flex justify-between items-center">
                            <span className="font-semibold text-foreground">{item.title}</span>
                            <span className="text-muted-foreground truncate max-w-[160px]">{item.url}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
