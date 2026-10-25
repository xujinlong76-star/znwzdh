/**
 * 金库的版本口径与云端反馈文案（单一事实源）。
 *
 * version=0 是写入前置条件「期望云端为空」，不是版本号；服务端首次 INSERT 写死
 * version=1（packages/store/src/repository/vault.ts），所以重建后的首版是 v1。
 * 这段文案曾在三处漂移（弹窗两处说 v0、io 兜底一处说 v0），统一在这里，
 * 避免同一事实再被各写一遍。
 *
 * 拉取失败与徽章文案也放这里：同一个 code 只能有一种标题和一种纠正动作，
 * 分散在 JSX 里就没法逐分支做行为测试，也必然再次漂移。
 */
import type { VaultResultCode } from '@/lib/navhub-api'

export const VAULT_REBUILD_FIRST_VERSION = 1

export const VAULT_REBUILD_VERSION_COPY = `重建后云端会重新计版，第一版是 v${VAULT_REBUILD_FIRST_VERSION}`

export const VAULT_REBUILD_ACTION_LABEL = `以本机排版重建（第一版是 v${VAULT_REBUILD_FIRST_VERSION}）`

export interface CloudVaultMetaLike {
  hasCloudVault: boolean
  updatedAt?: number
  version?: number
  code?: VaultResultCode
}

/**
 * 对表失败时保留上次已知事实（尤其是版本号）。
 *
 * 「这次没查到」不是「云端没有」：把 hasCloudVault/version 清掉会让徽章退回
 * 「云端暂无备份」，用户据此以为备份没了。只覆盖 code，其余字段沿用 last-known。
 */
export function mergeCloudVaultMeta(prev: CloudVaultMetaLike | null, next: CloudVaultMetaLike): CloudVaultMetaLike {
  if (next.code === 'check_failed' && prev) return { ...prev, code: 'check_failed' }
  return next
}

/**
 * 云端事实 → 徽章文案。
 *
 * check_failed 必须排在 hasCloudVault 之前：对表失败时 hasCloudVault 是 last-known，
 * 不能拿它断言「现在确实有」，也不能拿不到版本号就退回「暂无备份」。
 */
export function cloudVaultBadgeLabel(meta: CloudVaultMetaLike | null, isChecking = false): string {
  if (isChecking) return '正在与云端对表…'
  if (!meta) return '尚未与云端对表'
  if (meta.code === 'check_failed') {
    return typeof meta.version === 'number'
      ? `云端状态未知（上次对表 v${meta.version}）`
      : '云端状态未知：对表失败'
  }
  if (meta.hasCloudVault) {
    return typeof meta.version === 'number' ? `云端金库 v${meta.version}` : '云端有备份（版本号未知）'
  }
  if (meta.code === 'no_identity') return '未取到本机身份'
  return '云端暂无备份'
}

export type CloudPullFailureAction =
  | 'retry'
  | 'create-first'
  | 'restore-identity'
  | 'fix-passphrase'
  | 'use-local-export'

export interface CloudPullFailureNotice {
  title: string
  description: string
  action: CloudPullFailureAction
  /** 只有能由按钮直接执行的纠正动作才给标签 */
  actionLabel?: string
}

/**
 * 拉取失败 → 用户可执行的一句话（WCAG 3.3.1 / 3.3.3）。
 *
 * 旧实现所有失败共用「云端拉取或解密校验失败」，既分不清是网络、主密码还是格式，
 * 也没有下一步。这里按 code 分支，且不同分支的纠正动作不同。
 */
export function cloudPullFailureNotice(code: VaultResultCode | undefined): CloudPullFailureNotice {
  if (code === 'check_failed' || code === 'hub_error') {
    return {
      title: '这次没查到云端状态',
      description:
        '网络或中枢异常，云端是否仍有备份目前未知；云端内容没有被改动。先点「重试拉取」，仍失败可改用之前下载的 .enc.json 本机备份。',
      action: 'retry',
      actionLabel: '重试拉取',
    }
  }
  if (code === 'no_vault') {
    return {
      title: '云端确实没有备份',
      description:
        '该身份在云端还没有成功同步过的金库，或那份备份已被删除。输入主密码后点「加密同步至云端」建立第一份；这一步会先与云端对表再写入。',
      action: 'create-first',
      actionLabel: '加密同步至云端',
    }
  }
  if (code === 'no_identity') {
    return {
      title: '没取到本机身份',
      description:
        '隐私模式或禁用本地存储会导致身份丢失，中枢无法确定要读取哪一份金库。恢复本地存储后重开本面板再拉取；云端内容（若有）没有被改动。',
      action: 'restore-identity',
    }
  }
  if (code === 'decrypt_failed' || code === 'passphrase_rejected') {
    return {
      title: '主密码不对，或密文已损坏',
      description:
        '云端密文没有被改动。确认主密码后重试；如果确实忘记了主密码，请改用之前下载的 .enc.json 或本机 JSON 备份还原。',
      action: 'fix-passphrase',
    }
  }
  if (code === 'invalid_cipher_package' || code === 'invalid_json' || code === 'validation_failed') {
    return {
      title: '云端密文格式不受支持',
      description: '这份密文不是当前版本能解密的格式，云端没有被改动。请改用之前下载的 .enc.json 文件导入还原。',
      action: 'use-local-export',
    }
  }
  return {
    title: '云端拉取没有完成',
    description: '云端内容没有被改动。先重试；仍失败可改用之前下载的 .enc.json 本机备份。',
    action: 'retry',
    actionLabel: '重试拉取',
  }
}
