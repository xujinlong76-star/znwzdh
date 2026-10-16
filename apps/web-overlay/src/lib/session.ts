/**
 * 上游遗留文件，覆盖为空模块。
 *
 * 原因：上游 `src/lib/session.ts` 依赖 iron-session，而 iron-session 在本仓
 * 从未真正使用（全仓无 import，已作为死依赖从 package.json 移除）。上游文件还在，
 * vendor 之后 tsc 会以 "Cannot find module 'iron-session'" 失败——
 * 覆盖层是唯一能在 vendor 后依旧生效的地方，因此这里把它置为空模块。
 *
 * 若将来真的要接 iron-session：先把它加回 apps/web 的依赖，再恢复实现。
 */
export {};
