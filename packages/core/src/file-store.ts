/**
 * 原子文件存储的**注入缝**（dependency seam）。
 *
 * 为什么需要：`probe-cache.ts` / `audit-queue.ts` 需要落盘，但 `@navhub/core` 的定位是
 * 「纯算法与领域契约，零 IO」——core 一旦直接 `import "node:fs"`，它就再也无法在
 * 浏览器 / Edge 侧复用，任何引用 core 的产物打包都会被动带上 fs 依赖。
 *
 * 于是把「怎么读写文件」抽成接口，由调用方在启动时注入：
 *   - 生产：`apps/api/src/fs-file-store.ts`（node:fs/promises 实现，自注册）；
 *   - 测试：临时目录 / 内存实现（见 packages/core/test 的 beforeAll）。
 * core 只调用接口，不关心宿主环境。
 */
export interface AtomicFileStore {
  /** 读整文件为 utf8 文本；不存在或不可读时应抛错（调用方按「缓存可再生」降级） */
  read(path: string): Promise<string>;
  /** 原子写入：先写临时文件再改名，失败要清理临时文件；必要时自行创建父目录 */
  writeAtomic(path: string, data: string): Promise<void>;
}

let store: AtomicFileStore | null = null;

/** 注入实现（幂等，后注入覆盖先注入）。应用启动 / 测试 beforeAll 调用一次即可。 */
export function setFileStore(io: AtomicFileStore): void {
  store = io;
}

/**
 * 取当前实现；未注入时**显式抛错**。
 * 宁可失败得响亮，也不要静默回退到某个隐藏的 fs —— 那正是 core 想摆脱的耦合。
 */
export function fileStore(): AtomicFileStore {
  if (!store) {
    throw new Error(
      "@navhub/core 的 file-store 未注入：请在启动时调用 setFileStore(...)（apps/api 见 src/fs-file-store.ts）",
    );
  }
  return store;
}

/** 是否已注入（健康检查 / 诊断用） */
export function hasFileStore(): boolean {
  return store !== null;
}