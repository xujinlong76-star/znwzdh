/**
 * 视频采集与自动轮换异步任务队列与分布式租约锁管理器
 * 
 * 核心设计：
 * 1. 租约锁（Lease Lock）：防止多管理员同时触发或 Cron 与手动任务并发踩踏导致数据覆盖与 API 限流；
 * 2. 状态机跟踪：实时汇报各分类的处理阶段、采集数、淘汰替换数与完成百分比；
 * 3. 结果缓存与日志追溯：保留最近任务执行记录供管理后台仪表盘实时拉取展示。
 */

import { randomUUID } from 'node:crypto'
import { runVideoHarvestAndRotation, type VideoHarvestReport } from './video-harvester'
import { commitFile, readStorageFresh } from '@/lib/github'
import type { VideoPlatformType } from '@/types/navigation'

/** 采集任务入参（worker 与排队等待者都要用到， hydrate 恢复时从任务字段重建） */
export interface HarvestTaskInput {
  dryRun: boolean
  categoryId?: string
  forceKeywords?: string[]
  platforms?: VideoPlatformType[]
  trigger: 'manual' | 'cron' | 'admin'
  accessToken?: string
}

/**
 * 「锁被占 / 队列已满」的类型化错误。
 *
 * 此前 scheduleAndRunVideoHarvest 把包括程序崩溃在内的一切异常都抛成普通 Error，
 * 路由层只能一刀切回 409 —— 监控无法区分「真的有任务在跑」和「队列坏了」。
 * 路由按 `error.code` 区分：lock_busy / queue_full → 409（可重试），其余 → 500。
 */
export class HarvestBusyError extends Error {
  readonly code: 'lock_busy' | 'queue_full'
  constructor(code: 'lock_busy' | 'queue_full', message: string) {
    super(message)
    this.name = 'HarvestBusyError'
    this.code = code
  }
}

/** 同一实例内最多排队等待的任务数（超出直接 409，避免内存与快照无限堆积） */
const MAX_WAITING_TASKS = 3

export interface VideoHarvestProgress {
  percent: number
  stage: string
  totalCategories: number
  currentCategoryIndex: number
  currentCategoryTitle: string
  harvestedCount: number
  replacedCount: number
}

export interface VideoHarvestTask {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  dryRun: boolean
  categoryId?: string
  forceKeywords?: string[]
  platforms?: VideoPlatformType[]
  trigger: 'manual' | 'cron' | 'admin'
  progress: VideoHarvestProgress
  report?: VideoHarvestReport
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface VideoHarvestLock {
  owner: string
  acquiredAt: number
  expiresAt: number
}

// 内存态全局单例任务与锁存储
/** 任务快照的存储路径（中枢 KV 文档） */
const TASKS_SNAPSHOT_PATH = 'data/video-harvest-tasks.json'

interface TasksSnapshot {
  version: 1
  tasks: VideoHarvestTask[]
  /** 持久化时仍在生效的锁；过期后 hydrate 会丢弃 */
  lock: VideoHarvestLock | null
  savedAt: number
}

class VideoTaskQueueStore {
  private static instance: VideoTaskQueueStore
  private tasks = new Map<string, VideoHarvestTask>()
  private taskOrder: string[] = []
  private currentLock: VideoHarvestLock | null = null
  private readonly DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000 // 5 分钟租约

  /**
   * 持久化相关状态。
   *
   * 为什么需要：任务与锁全在内存，进程重启（含 Serverless 冷启动）后管理端
   * `/api/videos/harvest/task` 直接返回空 —— 运维看不到「上次采集是成功还是失败」。
   * 这里把任务快照写成一个 KV 文档，并在读取前懒加载回来。
   *
   * 边界（不要误解为分布式队列）：
   *   - 写是**防抖 + fire-and-forget**，丢一次不影响正确性（只是历史少一条）；
   *   - 多副本同时写会互相覆盖，快照只用于「看历史」，不用于互斥；
   *   - 真正的跨实例互斥仍依赖中枢的 `ifVersion`（采集写盘那条链路）。
   */
  private hydrated = false
  private persisting = false
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  /** 排队等待前置任务完成的工作项（先进先出） */
  private waiters: Array<{ task: VideoHarvestTask; input: HarvestTaskInput; lockOwner: string }> = []

  private constructor() {}

  public static getInstance(): VideoTaskQueueStore {
    if (!VideoTaskQueueStore.instance) {
      VideoTaskQueueStore.instance = new VideoTaskQueueStore()
    }
    return VideoTaskQueueStore.instance
  }

  /**
   * 尝试获取分布式租约互斥锁
   */
  public acquireLock(owner: string, ttlMs: number = this.DEFAULT_LOCK_TTL_MS): { success: boolean; error?: string } {
    const now = Date.now()
    if (this.currentLock && this.currentLock.expiresAt > now) {
      if (this.currentLock.owner !== owner) {
        return {
          success: false,
          error: `已有任务正在执行中（持有者: ${this.currentLock.owner}，租约将在 ${Math.ceil((this.currentLock.expiresAt - now) / 1000)} 秒后过期）`
        }
      }
    }
    this.currentLock = {
      owner,
      acquiredAt: now,
      expiresAt: now + ttlMs
    }
    return { success: true }
  }

  /**
   * 释放租约互斥锁
   */
  public releaseLock(owner: string): boolean {
    if (this.currentLock && this.currentLock.owner === owner) {
      this.currentLock = null
      return true
    }
    return false
  }

  /**
   * 续租。
   *
   * 为什么需要：TTL 是固定值（默认 5 分钟），而一次全量采集在分类多/网络慢时
   * 可能超过它。锁一过期，第二个任务就能拿到锁并开始整包覆盖写 —— 互斥失效。
   * 采集过程中每次更新进度都续一次，锁的语义才与「任务还在跑」一致。
   */
  public renewLock(owner: string, ttlMs: number = this.DEFAULT_LOCK_TTL_MS): boolean {
    if (this.currentLock && this.currentLock.owner === owner) {
      this.currentLock.expiresAt = Date.now() + ttlMs
      return true
    }
    return false
  }

  /**
   * 查看锁状态
   */
  public getLockStatus(): { locked: boolean; owner?: string; remainingSec?: number } {
    const now = Date.now()
    if (this.currentLock && this.currentLock.expiresAt > now) {
      return {
        locked: true,
        owner: this.currentLock.owner,
        remainingSec: Math.ceil((this.currentLock.expiresAt - now) / 1000)
      }
    }
    return { locked: false }
  }

  /**
   * 创建新任务
   */
  public createTask(input: {
    dryRun: boolean
    categoryId?: string
    forceKeywords?: string[]
    trigger: 'manual' | 'cron' | 'admin'
  }): VideoHarvestTask {
    const id = `task_vharvest_${randomUUID()}`
    const task: VideoHarvestTask = {
      id,
      status: 'pending',
      dryRun: input.dryRun,
      categoryId: input.categoryId,
      forceKeywords: input.forceKeywords,
      trigger: input.trigger,
      progress: {
        percent: 0,
        stage: '等待调度...',
        totalCategories: 0,
        currentCategoryIndex: 0,
        currentCategoryTitle: '',
        harvestedCount: 0,
        replacedCount: 0
      },
      createdAt: Date.now()
    }
    this.tasks.set(id, task)
    this.taskOrder.unshift(id)
    if (this.taskOrder.length > 50) {
      const removedId = this.taskOrder.pop()
      if (removedId) this.tasks.delete(removedId)
    }
    // 任务创建**立即**写一次快照（不走防抖）：fire-and-forget worker 启动后进程
    // 随时可能死掉，400ms 防抖窗口内的崩溃会让这条任务人间蒸发（管理端永远查无此任务）。
    void this.persistNow()
    return task
  }

  /** 当前排队等待前置任务的任务数（管理端可观测） */
  public getQueueDepth(): number {
    return this.waiters.length
  }

  /** 把刚创建的任务标记为「排队中」（锁被占时进入等待队列的可见状态） */
  public markQueued(id: string): void {
    const t = this.tasks.get(id)
    if (t) {
      t.status = 'pending'
      t.progress = { ...t.progress, stage: '排队中：已有采集任务在执行，本任务将在其完成后自动开始' }
      void this.persistNow()
    }
  }

  /** 登记一个等待前置任务的工作项（与 markQueued 配对使用） */
  public enqueueWaiter(task: VideoHarvestTask, input: HarvestTaskInput, lockOwner: string): void {
    this.waiters.push({ task, input, lockOwner })
  }

  /** 前置任务结束后的唤醒入口（worker finally 里调用） */
  public drainQueuedTasks(): void {
    this.drainQueue()
  }

  /**
   * 懒加载任务快照，只跑一次。路由在返回状态前 `await` 它。
   *
   * 上一次进程死掉时留下的 `running` / `pending` 任务在这里改判为 `failed`：
   * 否则管理端会永远显示「正在采集」，而实际早已没有进程在跑。
   */
  public async hydrate(): Promise<void> {
    if (this.hydrated) return
    this.hydrated = true
    try {
      const raw = (await readStorageFresh<TasksSnapshot>(TASKS_SNAPSHOT_PATH)) as TasksSnapshot | null
      if (!raw || raw.version !== 1 || !Array.isArray(raw.tasks)) return
      const now = Date.now()
      const resumeEnabled = process.env.NAVHUB_VIDEO_HARVEST_RESUME_ON_BOOT === '1'
      const resumable: VideoHarvestTask[] = []
      for (const t of raw.tasks) {
        if (!t || typeof t.id !== 'string') continue
        if (t.status === 'running' || t.status === 'pending') {
          /**
           * 重启后的处置按状态分流：
           *   - running：跑到一半，网络采集与写库进度无从对账，不能盲目重跑 → failed；
           *   - pending：从未开始。默认也判 failed（进程启动即自动爬取容易吓到运维）；
           *     显式 `NAVHUB_VIDEO_HARVEST_RESUME_ON_BOOT=1` 时重新排队，兑现「重启不丢任务」。
           *     注意 accessToken 不会持久化（凭据不落盘），恢复的任务以无 token 模式运行
           *     —— http 适配器（中枢）不需要 token，github/sqlite 模式下可能需要重新发起。
           */
          if (t.status === 'pending' && resumeEnabled) {
            t.progress = { ...t.progress, stage: '等待恢复执行（进程重启后重新排队）' }
            resumable.push(t)
          } else {
            t.status = 'failed'
            t.error = t.error || '进程重启，任务中断'
            t.completedAt = t.completedAt ?? now
            t.progress = {
              ...t.progress,
              stage: resumeEnabled
                ? '任务中断（进程重启，运行中任务不可恢复，请重新发起）'
                : '任务中断（进程重启；如需重启后自动恢复排队任务，配置 NAVHUB_VIDEO_HARVEST_RESUME_ON_BOOT=1）',
            }
          }
        }
        this.tasks.set(t.id, t)
        if (!this.taskOrder.includes(t.id)) this.taskOrder.push(t.id)
      }
      this.taskOrder.sort(
        (a, b) => (this.tasks.get(b)?.createdAt ?? 0) - (this.tasks.get(a)?.createdAt ?? 0),
      )
      if (this.taskOrder.length > 50) {
        for (const removed of this.taskOrder.splice(50)) this.tasks.delete(removed)
      }
      // 过期锁不恢复：否则一次异常退出会让采集被锁 5 分钟
      if (raw.lock && raw.lock.expiresAt > now) this.currentLock = raw.lock
      // 恢复的排队任务重新进入等待队列（不持有锁，由 drain 排到当前任务之后）
      for (const t of resumable) {
        if (this.waiters.length >= MAX_WAITING_TASKS) break
        this.waiters.push({
          task: t,
          input: {
            dryRun: t.dryRun,
            categoryId: t.categoryId,
            forceKeywords: t.forceKeywords,
            platforms: t.platforms,
            trigger: t.trigger,
          },
          lockOwner: `harvest_resume_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        })
      }
      if (resumable.length > 0) void this.persistNow()
    } catch {
      // 快照不可用（首次运行 / 中枢不可达）：静默降级为纯内存态
    }
  }

  /**
   * 前置任务结束后逐个唤起排队任务。
   *
   * 只在 worker 的 finally 里调用；拿不到锁（理论上不该发生）就把等待者原样
   * 放回队首，不丢任务。串行唤醒，不并发拉起。
   */
  private drainQueue(): void {
    while (this.waiters.length > 0) {
      const next = this.waiters.shift()
      if (!next) return
      const lockResult = this.acquireLock(next.lockOwner)
      if (!lockResult.success) {
        // 锁被占（跨实例分布式锁的等价物在服务层）：放回队首等下一次 drain
        this.waiters.unshift(next)
        return
      }
      this.startTask(next.task.id)
      void runHarvestTaskWorker(next.task, next.input, next.lockOwner)
      return
    }
  }

  /** 防抖写快照：采集过程中 progress 会高频更新，不能每次都打中枢 */
  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persistNow()
    }, 400)
  }

  private async persistNow(): Promise<void> {
    if (this.persisting) return
    this.persisting = true
    try {
      const snapshot: TasksSnapshot = {
        version: 1,
        tasks: this.taskOrder
          .slice(0, 20)
          .map(id => this.tasks.get(id))
          .filter((t): t is VideoHarvestTask => Boolean(t)),
        lock: this.currentLock,
        savedAt: Date.now(),
      }
      await commitFile(
        TASKS_SNAPSHOT_PATH,
        JSON.stringify(snapshot, null, 2),
        'chore(video): 采集任务快照',
      )
    } catch {
      // 快照写失败不影响采集本身：它只服务于「看历史」
    } finally {
      this.persisting = false
    }
  }

  public getTask(id: string): VideoHarvestTask | undefined {
    return this.tasks.get(id)
  }

  public getActiveTask(): VideoHarvestTask | undefined {
    for (const id of this.taskOrder) {
      const t = this.tasks.get(id)
      if (t && (t.status === 'pending' || t.status === 'running')) {
        return t
      }
    }
    return undefined
  }

  public listRecentTasks(limit: number = 10): VideoHarvestTask[] {
    return this.taskOrder.slice(0, limit).map(id => this.tasks.get(id)!).filter(Boolean)
  }

  public updateProgress(id: string, progress: Partial<VideoHarvestProgress>) {
    const t = this.tasks.get(id)
    if (t) {
      t.progress = { ...t.progress, ...progress }
      this.schedulePersist()
    }
  }

  public startTask(id: string) {
    const t = this.tasks.get(id)
    if (t) {
      t.status = 'running'
      t.startedAt = Date.now()
      this.schedulePersist()
    }
  }

  public completeTask(id: string, report: VideoHarvestReport) {
    const t = this.tasks.get(id)
    if (t) {
      t.status = 'completed'
      t.completedAt = Date.now()
      t.report = report
      t.progress = {
        ...t.progress,
        percent: 100,
        stage: '采集与轮换完成',
        // 字段名必须与 VideoHarvestReport 对齐：历史上这里写的是
        // report.totalHarvested / report.totalRotated（两者都不存在），
        // 于是管理端进度条永远显示 undefined。
        harvestedCount: report.totalHarvestedCount,
        replacedCount: report.totalReplacedCount
      }
      this.schedulePersist()
    }
  }

  public failTask(id: string, error: string) {
    const t = this.tasks.get(id)
    if (t) {
      t.status = 'failed'
      t.completedAt = Date.now()
      t.error = error
      t.progress = {
        ...t.progress,
        stage: `任务失败: ${error}`
      }
      this.schedulePersist()
    }
  }
}

export const videoTaskQueue = VideoTaskQueueStore.getInstance()

/**
 * 执行单个采集任务的 worker 主体（由调度器与排队唤起共用）。
 *
 * 完成后释放租约并唤起下一个排队任务。
 */
async function runHarvestTaskWorker(
  task: VideoHarvestTask,
  input: HarvestTaskInput,
  lockOwner: string,
): Promise<void> {
  try {
    videoTaskQueue.startTask(task.id)
    videoTaskQueue.renewLock(lockOwner)
    videoTaskQueue.updateProgress(task.id, {
      percent: 10,
      stage: '正在分析分类时效衰减分与热点词云...'
    })

    // 执行核心采集轮换引擎
    const report = await runVideoHarvestAndRotation({
      dryRun: input.dryRun,
      categoryId: input.categoryId,
      forceKeywords: input.forceKeywords,
      platforms: input.platforms,
      accessToken: input.accessToken
    })

    videoTaskQueue.renewLock(lockOwner)
    videoTaskQueue.updateProgress(task.id, {
      percent: 90,
      stage: '生成快照与持久化审计记录...'
    })

    videoTaskQueue.completeTask(task.id, report)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[VideoHarvestQueue] Task ${task.id} failed:`, err)
    videoTaskQueue.failTask(task.id, msg)
  } finally {
    // 释放租约（owner 与 acquire 时一致），再唤起排队中的下一个任务
    videoTaskQueue.releaseLock(lockOwner)
    videoTaskQueue.drainQueuedTasks()
  }
}

/**
 * 调度并后台执行视频采集长任务。
 *
 * 并发语义（此前是「拿不到锁直接 409」）：
 *   - 锁空闲 → 立即后台执行，返回 taskId；
 *   - 锁被占且队列未满 → 任务**排队**（status=pending，管理端可见「排队中」），
 *     前置任务结束后自动开始，返回 `queued: true`；
 *   - 队列也满 → 抛 `HarvestBusyError('queue_full')`，路由转 409。
 * 注意：排队只在**本进程内**生效；跨实例的互斥由服务层的分布式租约负责。
 */
export async function scheduleAndRunVideoHarvest(input: HarvestTaskInput): Promise<{
  taskId: string
  task: VideoHarvestTask
  queued: boolean
}> {
  /**
   * 锁的持有者必须是一个**在 acquire 与 release 之间保持不变的标识**。
   *
   * 历史 BUG：`acquireLock(\`worker_${Date.now()}\`)`，而 finally 里
   * `releaseLock(task.id)` —— owner 永不相等，`releaseLock` 恒返回 false，
   * 锁只能等 5 分钟 TTL 自然过期。表现是「采集跑完后再点采集，5 分钟内一律
   * 报『已有任务正在执行中』」，但实际没有任务在跑。
   *
   * 单测没抓到是因为它手工用同一个 owner 配对 acquire/release，
   * 覆盖的是 API 语义而不是这条真实调用路径。
   */
  const lockOwner = `harvest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // 1. 尝试加锁
  const lockResult = videoTaskQueue.acquireLock(lockOwner)
  if (!lockResult.success) {
    // 锁被占：不满 409 一刀切，先尝试排队
    if (videoTaskQueue.getQueueDepth() >= MAX_WAITING_TASKS) {
      throw new HarvestBusyError('queue_full', '采集队列已满（前置任务执行中，且已有多个任务排队），请稍后重试')
    }
    const task = videoTaskQueue.createTask(input)
    videoTaskQueue.markQueued(task.id)
    videoTaskQueue.enqueueWaiter(task, input, `harvest_wait_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    return { taskId: task.id, task, queued: true }
  }

  // 2. 创建任务入队（放在 try 内：createTask 抛错时也要释放锁）
  let task: VideoHarvestTask
  try {
    task = videoTaskQueue.createTask(input)
  } catch (err) {
    videoTaskQueue.releaseLock(lockOwner)
    throw err
  }

  // 3. 异步启动 Worker（不阻塞当前 HTTP 请求）
  void runHarvestTaskWorker(task, input, lockOwner)

  return { taskId: task.id, task, queued: false }
}
