# CodeQL URL 子字符串误判修复笔记（第 3 类，#128/#129/#130/#140）

工作区：`~/workspace/znwzdh-codeql-url-1121`，分支 `evo/codeql-url-1121`，基底 `ff07f3e8`。
规则：`js/incomplete-url-substring-sanitization`。根治方式：`new URL()` 解析 +
协议校验 + 严格主机名比对，禁止用注释屏蔽。

## 共享工具函数

`isAllowedHost(rawUrl: string, allowedHosts: string[]): boolean`
- `new URL(rawUrl)` 解析，非法 URL 返回 `false`；
- 协议必须为 `http:` / `https:`，其余一律 `false`；
- `hostname === host || hostname.endsWith('.' + host)`（host 与 hostname 均小写比对）。

实现位置（同一语义三份，行为一致，共用一套测试用例）：
- TS 中心：`packages/core/src/url-host.ts`（`@navhub/core` 导出；`packages/ai` 已依赖它）
- TS 前端：`apps/web-overlay/src/lib/safe-url.ts`（web-overlay 为独立 vendored 底座，
  不依赖 `@navhub/*`，加 workspace 依赖会炸 `Dockerfile.web` 的 `docker-smoke`，
  故就地同语义实现；见 U-352 A′ 的教训）
- JS 脚本：`scripts/lib/url-host.mjs`（`.mjs` 无法 import `.ts`）
- 附带同模块导出 `isAbsoluteHttpUrl(value)` 与 `parseSiteUrl(raw)`，供
  site-favicon 的 `startsWith('http')` 方案嗅探替换使用。

## 1. site-favicon.tsx:1206（#140）

### 原代码（`resolveSiteIcon`，同款另见 1108 `resolveLogoTile`、1036 `LOCAL_LOGO_MAP` 展开）

```ts
const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
```

### 攻击复现原理

`startsWith('http')` 是不完整的方案嗅探：`httpx://evil.com`、`http:evil.com`、
`httpfoo://evil.com` 都会被当成“已有绝对 URL”直接解析，解析出的 hostname
随即进入品牌图标 map / GitHub 头像分支；攻击者借种子数据或投稿写入一条
`httpx://` 前缀的 icon/URL，就能让解析走偏（错误图标、错误头像分支），
且该判断永远区分不出 `http` 与 `https`，属于典型的子串校验不完整。

### 修复

`parseSiteUrl(raw)`：先 `new URL(trimmed)`，协议为 `http:`/`https:` 才直接采用；
否则按裸主机名补 `https://` 再解析；非法则返回 `null`，调用方按原有回落
（`resolveSiteIcon` 返回 `''`、`resolveLogoTile` 返回 `null`、
`LOCAL_LOGO_MAP` 展开走裸文件名解码）。三处 `startsWith('http')` 全部替换。

## 2. packages/ai/src/enrich.ts:650-651（#128、#129）

### 原代码（`heuristicFacets`「产品形态」段；同款另见 592-593「付费模式」段）

```ts
if (
  lowerUrl.includes("github.com") ||
  lowerUrl.includes("gitee.com") ||
  lowerText.includes("npm") || ...
) {
  forms.push("library");
}
```

### 攻击复现原理

`lowerUrl.includes("github.com")` 是纯子串匹配：`https://evil.com/?github.com`
（白名单 host 只出现在查询串里）、`https://github.com.evil.com/x`
（后缀伪装成子域）、`https://evilgithub.com` 都会命中，让任意恶意站被
误判为开源库（`form = library`，进而影响定价 `open_source` 与分面展示）。

### 修复

两处（付费模式 + 产品形态）统一改为：

```ts
isAllowedHost(url, ["github.com", "gitee.com"])
```

`url` 为 `heuristicFacets` 入参的完整站点 URL（调用方传 `finalUrl`），
`isAllowedHost` 内部以 `new URL` 取 hostname 严格比对。

## 3. scripts/lib/seo-audit.mjs:207（#130）

### 原代码（`auditJsonLd`）

```js
const context = root["@context"];
if (!context || !JSON.stringify(context).includes("schema.org")) {
  add("JSON-LD 缺少 @context 或未声明 schema.org");
}
```

### 攻击复现原理

`JSON.stringify(context).includes("schema.org")` 只看序列化文本里有没有
`schema.org` 这 10 个字符：`"@context": "https://evil.com/?schema.org"`、
`"@context": "https://schema.org.evil.com/"` 都会通过检查，页面明明没有声明
合法的 schema.org 上下文，审计却放行，属于子串校验不完整。

### 修复

递归收集 `@context` 中的全部字符串值（字符串 / 数组 / 对象 `@vocab` 等），
逐个用 `isAllowedHost(s, ["schema.org"])` 校验；任一通过即视为声明了
schema.org，否则报同一条 issue。文案与 issue 去重逻辑不变。

## 单元测试用例（共享，断言行为一致）

`isAllowedHost` 绕过用例：
- `https://github.com/foo` → true；`https://sub.github.com/x` → true（合法子域）
- `https://evil.com/?github.com` → false（白名单 host 只在查询串）
- `https://github.com.evil.com/x` → false（后缀伪装）
- `https://evilgithub.com` → false（前缀拼接）
- `https://GITHUB.COM/x` → true（主机名大小写不敏感）
- `https://github.com:8443/x` → true（端口不影响主机名判定）
- `ftp://github.com/x`、`javascript:alert(1)` → false（非 http(s) 协议）
- `https://user@github.com/` → true（无 userinfo 限制时按主机名判定；注：
  渲染层另有 `safeHref` 拦 userinfo，这里只判定主机归属）
- `not a url`、`` → false（非法 URL）
- `github.com/foo`（无方案裸串）→ false（`new URL` 抛错，按规约不补方案）

`parseSiteUrl` 用例：
- `https://github.com/x` → 解析出 hostname `github.com`
- `github.com/x` → 补 `https://` 后解析出 `github.com`
- `httpx://evil.com` → null（非 http(s) 方案不直接采用；补方案后非法）
- `http:evil.com` → 解析出 protocol `http:`、hostname `evil.com`
  （WHATWG 对 http 特殊方案宽容解析，与旧 `new URL` 行为一致；
  下游 map 查不到，回落默认图标）

`heuristicFacets` 用例（`packages/ai/test/enrich-heuristics.test.ts`）：
- `https://github.com/foo/bar` → `form` 含 `library`、`pricing` 含 `open_source`
- `https://evil.com/?github.com`、`https://github.com.evil.com/x`、
  `https://evilgithub.com/x` → `form` 不含 `library`、`pricing` 不含 `open_source`

`auditJsonLd` 用例（`scripts/lib/seo-audit.test.ts`）：
- `"@context": "https://schema.org"` → 无 issue
- `"@context": "https://evil.com/?schema.org"` → 报「缺少 @context 或未声明 schema.org」
- `"@context": "https://schema.org.evil.com/"` → 报同一条 issue
- `"@context": ["https://schema.org", {"@language": "zh"}]` → 无 issue
