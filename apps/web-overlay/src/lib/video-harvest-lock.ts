/**
 * 跨实例采集租约锁（中枢 KV + ifVersion CAS）。
 *
 * 为什么需要：`video-task-queue` 的租约锁是**进程内单例**——多副本 / Serverless
 * 多实例部署时互斥完全失效，两个实例可以同时跑全量采集，各自整包写库，只能靠
 * 中枢 ifVersion 冲突重放兜底（重放 = 重新发起全部网络搜索）。
 *
 * 实现：把 `{owner, expiresAt}` 写进中枢 KV 文档，写入带 `ifVersion`。
 * 两个实例同时抢锁时，读到的版本号相同，CAS 保证只有一个写成功——
 * 这就是跨实例互斥。TTL 到期后竞争者可以覆盖（持有者崩溃不再续租时）。
 *
 * 边界：
 *   - 存储适配器不支持版本号（github / sqlite 后端 `getStorageVersion` 返回 null）
 *     时**无法 CAS**，返回 `degraded: true`，调用方退回进程内锁（与历史行为一致）；
 *   - 中枢不可达时同样降级为进程内锁——锁服务坏了不该把采集整个锁死；
 *   - 锁文档是独立 KV 文件，与任务快照、视频库互不影响。
 */
import { commitFile, getStorageVersion, readStorageFresh } from '@/lib/github'
import { isVersionConflict } from '@/lib/video-write-guard'

const LOCK_PATH = 'data/video-harvest-lock.json'

export interface HarvestLeaseDoc {
  version: 1
  owner: string
  expiresAt: number
  savedAt: number
}

export interface LeaseOutcome {
  success: boolean
  /** true = CAS 能力缺失或中枢不可达，本次只受进程内锁保护 */
  degraded?: boolean
  error?: string
}

async function readLease(): Promise<HarvestLeaseDoc | null> {
  const raw = await readStorageFresh<HarvestLeaseDoc>(LOCK_PATH).catch(() => {
    // 首次运行 / 中枢抖动读不到租约文档：等价于「无锁」，交由写入侧 CAS 定胜负
    return null
  })
  if (!raw || raw.version !== 1 || typeof raw.owner !== 'string') return null
  return raw
}

async function writeLease(doc: HarvestLeaseDoc, ifVersion: number): Promise<void> {
  await commitFile(
    LOCK_PATH,
    JSON.stringify(doc, null, 2),
    'chore(video): harvest lease',
    undefined,
    1,
    ifVersion,
  )
}

/**
 * 获取跨实例租约。同一 owner 重复获取 = 续租（刷新 expiresAt）。
 */
export async function acquireHarvestLease(owner: string, ttlMs: number): Promise<LeaseOutcome> {
  try {
    const [current, version] = await Promise.all([
      readLease(),
      getStorageVersion(LOCK_PATH),
    ])
    // 适配器不支持版本号 → 无 CAS 能力，退回进程内锁
    if (version === null) return { success: true, degraded: true }

    const now = Date.now()
    if (current && current.owner && current.owner !== owner && current.expiresAt > now) {
      return {
        success: false,
        error: `另一实例持有采集租约（${current.owner}），约 ${Math.ceil((current.expiresAt - now) / 1000)} 秒后过期`,
      }
    }

    await writeLease(
      { version: 1, owner, expiresAt: now + ttlMs, savedAt: now },
      version,
    )
    return { success: true }
  } catch (err) {
    // CAS 竞争失败（他人 Concurrently 抢到）按「锁被占」处理；其余（中枢不可达）降级
    if (isVersionConflict(err)) {
      return { success: false, error: '另一实例正在抢占采集租约，请稍后重试' }
    }
    console.warn('[video-harvest-lock] 中枢不可达，采集租约降级为进程内锁:', err)
    return { success: true, degraded: true }
  }
}

/** 释放租约：只有持有者本人能清空（防止误删他人的活锁） */
export async function releaseHarvestLease(owner: string): Promise<void> {
  try {
    const [current, version] = await Promise.all([
      readLease(),
      getStorageVersion(LOCK_PATH),
    ])
    if (version === null) return
    if (!current || current.owner !== owner) return
    await writeLease(
      { version: 1, owner: '', expiresAt: 0, savedAt: Date.now() },
      version,
    )
  } catch {
    // 释放失败无碍：TTL 到期后自然失效
  }
}

/** 续租：持有者本人且未过期才允许 */
export async function renewHarvestLease(owner: string, ttlMs: number): Promise<boolean> {
  try {
    const [current, version] = await Promise.all([
      readLease(),
      getStorageVersion(LOCK_PATH),
    ])
    if (version === null) return true
    const now = Date.now()
    if (!current || current.owner !== owner || current.expiresAt <= now) return false
    await writeLease({ version: 1, owner, expiresAt: now + ttlMs, savedAt: now }, version)
    return true
  } catch {
    return false
  }
}
