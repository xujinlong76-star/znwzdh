# ADR-0002 · 生产以 Node 24 strip-types 直跑源码（不切编译产物）

- **状态**：accepted（2026-11-06；本会话落地了根因护栏，此处定案运行形态）
- **背景**：package.json:16 的 dev 为 node apps/api/src/main.ts，docker/entrypoint.sh:52 为 exec node apps/api/src/main.ts。仓库未产出后端 dist 运行产物（apps/api 的 build 是 tsc -p（noEmit），bundle 才产 dist/main.mjs 但 compose 不用）。Node 24 起原生支持 TS 类型剥离，无需 --experimental-strip-types（README 与 UPGRADE-PROPOSAL-V3 已记录，但 package.json 仍残留 5 处该标志）。
- **事故**：apps/api/src/vision.ts:23 的 constructor(message: string, readonly reason: string)（TypeScript 参数属性）在 Node v24.22.2 实测抛「TypeScript parameter property is not supported in strip-only mode」；而 tsconfig.base.json 当时没有 erasableSyntaxOnly，tsc 全绿、CI 全绿、生产进程启动即崩。仓库另两处注释已写「不能用参数属性」，说明是已知约束的漏网。
- **本会话落地**：① vision.ts 改显式 readonly reason: string 字段 + 构造函数赋值；② tsconfig.base.json 加 erasableSyntaxOnly: true，让 tsc 在类型检查期直接拒绝 enum / namespace / 参数属性 / 装饰器；③ node -e import('./apps/api/src/vision.ts') 实证通过。
- **决策**：保留 strip-types 直跑，**不切** tsc/tsgo 编译产物 dist。理由：当前只有 1 处不兼容语法且已由 erasableSyntaxOnly 在编译期根除；切 dist 会引入构建产物、source map、容器 COPY 路径与 dev/prod 行为分叉，成本远大于收益。
- **必须配套的守卫**（P2，未全部落地）：① CI 加零依赖启动烟测（PORT=0 + 超时包裹 import('./apps/api/src/main.ts')）；② scripts/check-strip-syntax.mjs 扫 392 个 TS 的不可擦除语法并登记 gates.json；③ 删除 package.json 残留的 5 处 --experimental-strip-types；④ Node 小版本升级先在 nightly 跑 48h 再上生产。
- **验收**：392 个 TS 源文件中 strip 不兼容语法 = 0；CI 有启动烟测一步；Node 升级 0 次生产事故。
- **后果**：接受「运行时依赖 Node ≥24 的 strip-types 行为」这一耦合，换取零构建产物的简洁部署；erasableSyntaxOnly 是这条耦合的安全带，不可移除。
