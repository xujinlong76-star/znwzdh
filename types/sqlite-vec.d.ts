/**
 * sqlite-vec 没有自带类型声明，这里只声明我们实际用到的部分。
 *
 * 用法：sqliteVec.load(db)，db 需为 better-sqlite3 实例。
 */
declare module "sqlite-vec" {
  /** 把 vec0 扩展加载进给定的 better-sqlite3 连接 */
  export function load(db: unknown): void;
  /** 返回可加载扩展文件的路径 */
  export function getLoadablePath(): string;
  const _default: { load: typeof load; getLoadablePath: typeof getLoadablePath };
  export default _default;
}
