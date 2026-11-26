import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "./driver.ts";

export interface TransactionContext {
  inTx: boolean;
  active: boolean;
  pgClient?: unknown;
}

export function isActiveTransaction(context: TransactionContext | undefined): boolean {
  return context?.inTx === true && context.active === true;
}

/**
 * 数据库访问闸门（读写锁）。
 *
 * SQLite 只有一个连接，事务一旦 BEGIN，任何在 `await` 期间插进来的普通查询
 * 都会落进这个事务；事务回滚时，普通查询的写入会被一起抹掉。
 * 事务持有写锁、普通查询持有读锁，确保「事务期间没有外部 SQL」。
 *
 * 注意：`read()` 只接受**只读**语句。调用方（`raw`/`runCount`）已按 SQL
 * 类型自动路由，写语句不会再进到这里——见 `isWriteStatement`。
 */
export class DbAccessGate {
  private readonly serializeReads: boolean;
  private writing = false;
  private activeReaders = 0;
  private readonly readQueue: Array<() => void> = [];
  private readonly writeQueue: Array<() => void> = [];

  constructor(serializeReads: boolean) {
    this.serializeReads = serializeReads;
  }

  /**
   * 没有写事务时直接读；写事务期间必须排队。
   *
   * SQLite 的 WAL 只能让**其它连接**看到已提交快照。本仓库的 Repository 共用
   * 同一个 better-sqlite3 连接，事务外 read 一旦插进 BEGIN ... COMMIT 之间，
   * 就会读到未提交数据（回滚后结果更是凭空消失）。因此这里不能只靠 WAL。
   */
  async read<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.serializeReads || !this.writing) return fn();

    await new Promise<void>((resolve) => this.readQueue.push(resolve));
    this.activeReaders++;
    try {
      return await fn();
    } finally {
      this.activeReaders--;
      if (this.activeReaders === 0) this.releaseWrite();
    }
  }

  /**
   * 写操作 FIFO 串行互斥队列。
   * 确保单连接/单写模型下写事务按序执行，彻底消除 SQLITE_BUSY。
   */
  async write<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireWrite();
    try {
      return await fn();
    } finally {
      this.releaseWrite();
    }
  }

  private acquireWrite(): Promise<void> {
    if (!this.writing) {
      this.writing = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.writeQueue.push(resolve));
  }

  private releaseWrite(): void {
    if (this.activeReaders > 0) return;

    // 写者优先，避免持续到来的读请求让事务永久饥饿。没有写者时批量放行
    // 当前排队的读，保持无事务路径的并发能力；批次期间的新读进入下一批。
    const nextWrite = this.writeQueue.shift();
    if (nextWrite) {
      nextWrite();
      return;
    }
    const readers = this.readQueue.splice(0);
    if (readers.length > 0) {
      // 仅解除等待；activeReaders 必须由 read() 真正开始时递增，不能在这里
      // 预先把排队数计入，否则每个读者都会重复计数，最终永远无法释放写锁。
      for (const resolve of readers) resolve();
      return;
    }
    this.writing = false;
  }
}

interface DbAccessState {
  gate: DbAccessGate;
  txContext: AsyncLocalStorage<TransactionContext>;
}

// Repository、SearchEngine 以及少数直接读取 SQLite 的域模块必须共享同一个
// 闸门和事务上下文；以 Db 实例为键可避免多库/多测试串扰，也不会阻止 Db 回收。
const dbAccessStates = new WeakMap<object, DbAccessState>();
// Repository.db 是 PG 事务连接路由用的 Proxy。直接读取 SQLite 的域模块如果仍以
// repo.db 为键，就会给同一个物理库再建一套闸门/AsyncLocalStorage，事务隔离随之失效。
const dbAccessAliases = new WeakMap<object, DbAccessState>();

export function registerDbAccessAlias(alias: Db, source: Db): DbAccessState {
  const state = getDbAccessState(source);
  dbAccessAliases.set(alias as object, state);
  return state;
}

export function getDbAccessState(db: Db): DbAccessState {
  const key = db as object;
  const aliased = dbAccessAliases.get(key);
  if (aliased) return aliased;
  let state = dbAccessStates.get(key);
  if (!state) {
    state = {
      gate: new DbAccessGate(db.dialect !== "pg"),
      txContext: new AsyncLocalStorage<TransactionContext>(),
    };
    dbAccessStates.set(key, state);
  }
  return state;
}

/**
 * 直接 SQLite 读取的统一入口。
 *
 * 同一异步调用链内的事务读继续直连，以便看到自己的未提交写入；事务外读取则
 * 等待当前写事务结束，避免借用同一连接读到半状态。PostgreSQL 保留原并发语义。
 */
export async function readWithDbGate<T>(db: Db, fn: () => T | Promise<T>): Promise<T> {
  if (db.dialect === "pg") return fn();
  const state = getDbAccessState(db);
  if (isActiveTransaction(state.txContext.getStore())) return fn();
  return state.gate.read(async () => fn());
}

/**
 * SQLite 维护/直接写入的统一入口。
 *
 * 维护操作必须与 Repository 写事务共享独占门禁，且不能在调用方事务内运行：
 * VACUUM、wal_checkpoint 本身不能在事务中执行，FTS optimize 也必须独立提交，
 * 不能借调用方事务「成功」后又被外层回滚。PostgreSQL 保持原有池并发语义。
 */
export async function writeWithDbGate<T>(db: Db, fn: () => T | Promise<T>): Promise<T> {
  if (db.dialect === "pg") return fn();
  const state = getDbAccessState(db);
  if (isActiveTransaction(state.txContext.getStore())) {
    throw new Error("SQLite 维护写操作必须在调用方事务外运行");
  }
  return state.gate.write(async () => fn());
}
