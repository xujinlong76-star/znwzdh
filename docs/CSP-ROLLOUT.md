# CSP 上线 Runbook（report-only → enforce）

> 目标：先把 CSP 当**观察工具**跑一周，用真实违规数据决定是否收源，再切 enforce。
> 代码事实源：`apps/web-overlay/next.config.js`（`CSP_DIRECTIVES`）；契约测试：`apps/web-overlay/test/security-headers.test.ts`。

## 1. 当前档位

| 环境变量 | 产物 | 用途 |
| :--- | :--- | :--- |
| （都不设） | 不下发 CSP | 默认；避免个人部署被内联脚本问题打挂 |
| `NAVHUB_CSP_REPORT_ONLY=1` | `Content-Security-Policy-Report-Only` | 只收集，不拦截 |
| `NAVHUB_CSP=1` | `Content-Security-Policy` | 真正拦截 |
| 两者同时为 1 | 只下发 enforce | enforce 优先，避免同源策略双份报告 |
| `NAVHUB_CSP_REPORT_URI=https://…` | 两种档位都追加 `report-uri` | 指定收集端点（可选） |

> **关键：以上都是构建期变量。** Next 的 `headers()` 在 `next build` 时求值并写入 `routes-manifest.json`，`next start` 时改 env 不会生效。切换档位必须重新构建（Docker 用 `--build-arg`，见第 3 步）。

enforce 与 report-only 共用同一份 `CSP_DIRECTIVES`，测试会断言两者逐字一致，防止「观察的策略」和「拦截的策略」漂移。

## 2. 本地验证（不上生产）

```bash
# 1) 复制 overlay 到 apps/web
node scripts/vendor-web.mjs

# 2) 以 report-only **构建**（env 必须在 build 时设置）
NAVHUB_CSP_REPORT_ONLY=1 \
NAVHUB_CSP_REPORT_URI=https://csp.example.com/report \
pnpm --filter navsphere build

# 3) 启动（不需要再带 CSP env；响应头已写入构建产物）
pnpm --filter navsphere start --port 4180

# 4) 看响应头
curl -sI http://localhost:4180/ | grep -i content-security-policy
# 期望：Content-Security-Policy-Report-Only: default-src 'self'; …; report-uri https://csp.example.com/report
```

Windows PowerShell：

```powershell
$env:NAVHUB_CSP_REPORT_ONLY='1'
$env:NAVHUB_CSP_REPORT_URI='https://csp.example.com/report'
pnpm --filter navsphere build
pnpm --filter navsphere start --port 4180
```

> 2026-10-20 实测：不设 env 构建、再带 env 启动，响应头不会出现；`routes-manifest.json` 中也没有 CSP。改为构建时设置后头才出现。

## 3. 上线步骤（建议一周观察）

### 第 0 步：准备收集端点

`report-uri` 会收到浏览器上报的 `application/csp-report` JSON，包含 `document-uri`、`blocked-uri`、`violated-directive`。

- 可用外部服务（Sentry / Report URI / 自建网关）；
- 也可先指向一个只记日志的入口，**不要记录完整页面 URL 的敏感查询串**；
- 当前实现使用 `report-uri`（兼容性最好）；后续若上 `report-to`，需要同时下发 `Report-To` 头并做分组配置，属单独改动。

### 第 1 步：打开 report-only（重新构建）

```bash
NAVHUB_CSP_REPORT_ONLY=1 \
NAVHUB_CSP_REPORT_URI=https://<collector>/csp \
pnpm --filter navsphere build
# 然后发布这次构建产物并重启服务
```

Docker：

```bash
docker build -f docker/Dockerfile.web \
  --build-arg NAVHUB_CSP_REPORT_ONLY=1 \
  --build-arg NAVHUB_CSP_REPORT_URI=https://<collector>/csp \
  -t navhub-web:csp-ro .
```

确认响应头存在，且**没有** `Content-Security-Policy`（enforce）头。**只改运行时 env 并重启是无效的**——见第 1 节说明。

### 第 2 步：收集与分诊（7 天）

按 `violated-directive` 聚合，优先看：

1. `script-src`：Next 的内联 bootstrap、三方统计、插件沙箱；
2. `style-src`：组件库运行时注入、内联样式；
3. `img-src` / `connect-src`：站点图标、WebSocket、API 域名；
4. `frame-src`：视频播放器 / 嵌入内容。

每条都要回答：**是真实需要的源，还是可以去掉的内联**。不要为了清零报告直接把 `https:` 加进 `script-src`。

### 第 3 步：收敛依赖

按收益排序：

- 能改 nonce/hash 的内联脚本优先改（Next 的 CSP nonce 需要 middleware 注入，属单独改造）；
- 运行时注入样式的组件，尽量换成静态 CSS 或把 hash 加进 `style-src`；
- 明确不需要的三方域名，不加。

当前策略仍含：

- `script-src 'unsafe-inline'`（`unsafe-eval` 已随投机算术的纯解析器改造移除）
- `style-src 'unsafe-inline'`

在这两项收敛前，enforce 的收益主要是「挡住未知外链」，而不是完整的 XSS 防护。**不要因为报告清零就误以为已经安全**。

### 第 4 步：切 enforce（再次重新构建）

```bash
NAVHUB_CSP=1 \
NAVHUB_CSP_REPORT_URI=https://<collector>/csp \
pnpm --filter navsphere build
# 发布新产物并重启；不再传 NAVHUB_CSP_REPORT_ONLY
```

Docker：

```bash
docker build -f docker/Dockerfile.web \
  --build-arg NAVHUB_CSP=1 \
  --build-arg NAVHUB_CSP_REPORT_URI=https://<collector>/csp \
  -t navhub-web:csp-enforce .
```

确认：

- 响应头是 `Content-Security-Policy`（不是 Report-Only）；
- 首页、搜索、站点详情、市场、管理端、登录回跳各走一遍；
- 浏览器控制台无 `Refused to execute inline script` 类报错；
- E2E（CI 的 Playwright）保持绿。

### 第 5 步：回滚

回滚 = 重新部署**未开启 CSP 的上一版镜像**；或重新构建（不传任何 `NAVHUB_CSP*`）后发布。仅删除运行时 env 并重启不会移除已写入构建产物的响应头。

## 4. 验收清单

- [ ] report-only 头存在，enforce 头不存在
- [ ] 收集端点能收到 `application/csp-report`
- [ ] 7 天违规按 directive 聚合完成分诊
- [ ] 每条保留的源都有理由；每条去掉的内联都有替代
- [ ] enforce 后核心路径与 E2E 全绿
- [ ] 回滚步骤在预发环境演练过

## 5. 代码守卫

```bash
pnpm exec vitest run apps/web-overlay/test/security-headers.test.ts
```

覆盖：默认不下发、enforce、report-only、`report-uri` 追加、双开关 enforce 优先、两种档位指令逐字一致、HSTS 仅 https 下发。
