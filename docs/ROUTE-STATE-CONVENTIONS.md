# 路由状态规范（loading / error）

> 状态：**现行**。对应门禁 `apps/web-overlay/test/route-state-coverage.test.ts`
> （执行面 `apps/web/test/route-state-coverage.test.ts`）。
> 目的：每条可导航路由在**慢网下不白屏**、**崩溃时不被踢出站内外壳**。

## 1. 何时要 loading.tsx

**凡是有服务端取数（`hubGet` / `loadXxx` / `force-dynamic` / ISR 冷缓存首访）的
路由段，都要有 `loading.tsx`。** 它把服务端渲染等待期变成骨架占位，而不是整页空白。

形态三选一，直接引 `components/route-skeleton.tsx`，**禁止在路由里手写骨架**：

| 形态 | 页面形状 | 例 |
|---|---|---|
| `grid` | 卡片墙 | /category、/sites、/search、/marketplace、/tags |
| `detail` | 左文右卡双栏 | /algorithms、/graph |
| `list` | 单列行条 | /import、/submit、/custom、/offline |

> **已知约束（软 404 回归锁）**：`/site/[id]` 与 `/collections` 系（含
> `/collections/[slug]`）**不接 loading**——骨架屏边界会先流式刷 200，
> `notFound()` 就改不了状态码，软 404 会退化成 200 + not-found 内容。
> 锁见 `collection-detail.test.ts`、`site-detail-404.test.ts`、
> `site-detail-performance.test.ts`（裁决 2026-11-01：尊重已提交锁）。
> 二者的 error.tsx 不受影响（错误边界不改 404 状态码语义），照常保留。

```tsx
import { RouteSkeleton } from "@/components/route-skeleton";

export default function Loading() {
  return <RouteSkeleton variant="grid" count={8} />;
}
```

`count`/`variant` 微调到贴近真实布局即可（分类页格子、详情页双栏、列表页行条）；
不追求像素级复刻——但**形状错位的骨架比没有更糟**（N11 教训：切换瞬间会「跳一下」）。

存量例外（冻结，不许再增）：`favorites/`、`me/`、`me/data/`、`me/history/`、
`admin/` 五个手写形状骨架，逐文件理由见门禁 `HANDCRAFTED_SKELETONS`。

**豁免**（在门禁 `STATE_EXEMPT` 逐目录写理由，禁止通配）：

- 静态客户端表单（`'use client'`、无服务端取数）——SSR 首字节即出内容，
  不存在白屏窗口（如 `auth/*`）；
- 复合布局页，grid/detail/list 三形态都贴不上，且缓存命中后首字节即到
  （如首页 `""`）；
- **软 404 回归锁**（如 `site/[id]`、`collections`、`collections/[slug]`）——
  接 loading 会让 `notFound()` 沦为流式 200，见上方「已知约束」。

## 2. 何时要 error.tsx

**凡是有服务端取数、渲染分支可能抛错的路由段，都要有局部 `error.tsx`。**
没有局部边界时，抛错冒泡到全局 `app/error.tsx`——用户被踢出整个站内外壳
（导航消失），只能回首页重来；局部边界只把出错的内容区换成「发生了什么 +
重试 + 返回」，外壳保留。

统一引 `components/route-error.tsx`（文案走 `describeCrash`，与全局 error.tsx
同一套判定），**禁止自创错误文案体系**：

```tsx
"use client";

import { RouteError } from "@/components/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} scope="站点目录" />;
}
```

`scope` 用路由语义中文名：单页用页名（「分类总览」「标签总览」），一族子段
共用父级边界时用族名（「插件市场」「站点目录」），详情页优先自带边界
（「站点详情」「分类详情」）。

## 3. 豁免规则

1. **逐目录、逐缺口写理由**，写进门禁 `STATE_EXEMPT`（loading / error 分开声明）；
2. **禁止通配/前缀放行**——`auth/*`、`admin/` 这种写法一律红灯，新增路由默认
   必须显式接线或显式豁免；
3. **残留豁免红灯**——接上边界后要同步删清单，清单与现状永远一致；
4. 现行豁免的四大类（理由全文见门禁）：
   - `auth/*`：静态客户端表单，无白屏窗口；失败态在表单内展示；
   - `""`（首页）：复合布局贴不上三形态，ISR 60s 缓存命中首字节即到；
   - `site/[id]`、`collections`、`collections/[slug]`：**软 404 回归锁**，
     不接 loading（根因「骨架屏边界会先流式刷 200，notFound 就改不了
     状态码」；锁文件 `collection-detail.test.ts`、`site-detail-404.test.ts`、
     `site-detail-performance.test.ts`）；
   - `admin/*`、`me/*`、实验性工具页：错误暂落全局兜底，列入后续收口
     （加载面各自已有骨架覆盖）。

## 4. 新增路由 checklist

- [ ] `loading.tsx`：引 `RouteSkeleton` 选形态（或写进 `STATE_EXEMPT` 并注明理由）
- [ ] `error.tsx`：引 `RouteError` 传 `scope`（或写进 `STATE_EXEMPT` 并注明理由）
- [ ] 门禁绿：`node node_modules/vitest/vitest.mjs run apps/web/test/route-state-coverage.test.ts`
- [ ] overlay 测试改动要 `node scripts/generate-web-mirror.mjs` 镜像到 `apps/web/test/`
- [ ] 手写骨架**不许**新增（`HANDCRAFTED_SKELETONS` 冻结）

## 5. 覆盖模型（与 Next.js App Router 运行时语义一致）

- **loading**：目录自身或**任一祖先段**有 `loading.tsx` 即覆盖——父级
  loading.tsx 把子段包进同一 Suspense 边界，子段导航照样出骨架；
- **error**：目录自身或任一祖先段有局部 `error.tsx` 即覆盖；根级
  `app/error.tsx` 是**全局网**——对非根路由意味着「踢出外壳」，不算局部覆盖。
