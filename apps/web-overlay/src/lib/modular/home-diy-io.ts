'use client'

/**
 * 首页 DIY 的导入/导出与云端金库逻辑（从 use-home-diy.ts 拆出，2026-10-19 P1-1）。
 *
 * 这里只放不依赖 React 的纯逻辑：解析、校验、加密、云端请求。
 * 落盘/共享状态由调用方注入 persist，避免这个文件反过来依赖存储单例。
 */
import { getIdentity } from '@/lib/identity'
import { deleteCloudVault, fetchCloudVault, saveCloudVault } from '@/lib/navhub-api'
import { validateAndCleanDIYConfig } from '@/lib/modular/diy-presets'
import { decryptGenericPayload, encryptGenericPayload } from '@/lib/vault'
import type { HomeDIYConfig } from './home-diy-storage'

export type HomeDiyPersist = (updater: (prev: HomeDIYConfig) => HomeDIYConfig) => void

export function exportDIYConfig(config: HomeDIYConfig): string {
  return JSON.stringify(config, null, 2)
}

export function importDIYConfig(
  jsonString: string,
  persist: HomeDiyPersist,
): { ok: boolean; message: string } {
  try {
    const parsed = JSON.parse(jsonString)
    const res = validateAndCleanDIYConfig(parsed)
    if (!res.valid || !res.config) {
      return { ok: false, message: res.error || '无效的配置格式' }
    }
    persist(() => ({ ...(res.config as HomeDIYConfig), updatedAt: Date.now() }))
    return { ok: true, message: '配置已成功导入并生效！' }
  } catch (e: any) {
    return { ok: false, message: `JSON 解析失败: ${e.message || '格式错误'}` }
  }
}

export async function exportEncryptedDIYConfig(
  config: HomeDIYConfig,
  passphrase: string,
): Promise<string> {
  const payload = await encryptGenericPayload(config, passphrase, 'navhub_home_diy_config_v3')
  return JSON.stringify(payload, null, 2)
}

export async function importEncryptedDIYConfig(
  encryptedJsonStr: string,
  passphrase: string,
  persist: HomeDiyPersist,
): Promise<{ ok: boolean; message: string }> {
  try {
    const parsed = JSON.parse(encryptedJsonStr)
    if (!parsed.cipherTextBase64 || !parsed.ivHex || !parsed.saltHex) {
      return { ok: false, message: '无效的零知识金库密文包格式' }
    }
    const decrypted = await decryptGenericPayload<HomeDIYConfig>(parsed, passphrase)
    const res = validateAndCleanDIYConfig(decrypted)
    if (!res.valid || !res.config) {
      return { ok: false, message: res.error || '解密数据校验失败' }
    }
    persist(() => ({ ...(res.config as HomeDIYConfig), updatedAt: Date.now() }))
    return { ok: true, message: '🎉 零知识金库验证成功，排版与专属配置已全量还原！' }
  } catch (e: any) {
    return { ok: false, message: e.message || '解密失败：主密码不匹配或密文已被篡改' }
  }
}

export async function syncToCloudVault(
  config: HomeDIYConfig,
  passphrase: string,
): Promise<{ success: boolean; version?: number; error?: string }> {
  if (!passphrase || passphrase.length < 6) {
    return { success: false, error: '主密码长度至少需 6 位' }
  }
  const encrypted = await exportEncryptedDIYConfig(config, passphrase)
  if (!encrypted) {
    return { success: false, error: '本地配置加密失败' }
  }
  const identity = getIdentity()
  if (!identity) {
    return { success: false, error: '无法获取用户身份标识' }
  }
  const res = await saveCloudVault(identity, encrypted)
  if (!res.ok) {
    return { success: false, error: '中枢云端金库同步失败，请检查网络或后端服务' }
  }
  return { success: true, version: res.version }
}

export async function syncFromCloudVault(
  passphrase: string,
  persist: HomeDiyPersist,
): Promise<{ success: boolean; error?: string; updatedAt?: number }> {
  if (!passphrase) {
    return { success: false, error: '请输入解密主密码' }
  }
  const identity = getIdentity()
  if (!identity) {
    return { success: false, error: '无法获取用户身份标识' }
  }
  const cloudRecord = await fetchCloudVault(identity)
  if (!cloudRecord || !cloudRecord.payload) {
    return { success: false, error: '云端暂未查询到该身份的备份金库' }
  }
  const res = await importEncryptedDIYConfig(cloudRecord.payload, passphrase, persist)
  if (!res.ok) {
    return { success: false, error: res.message || '云端金库解密校验失败' }
  }
  return { success: true, updatedAt: cloudRecord.updatedAt }
}

export async function checkCloudVaultStatus(): Promise<{
  hasCloudVault: boolean
  updatedAt?: number
  version?: number
}> {
  const identity = getIdentity()
  if (!identity) return { hasCloudVault: false }
  const cloudRecord = await fetchCloudVault(identity)
  if (!cloudRecord || !cloudRecord.payload) {
    return { hasCloudVault: false }
  }
  return { hasCloudVault: true, updatedAt: cloudRecord.updatedAt, version: cloudRecord.version }
}

export async function clearCloudVault(): Promise<boolean> {
  const identity = getIdentity()
  if (!identity) return false
  return await deleteCloudVault(identity)
}
