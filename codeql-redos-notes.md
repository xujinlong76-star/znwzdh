# CodeQL ReDoS 修复笔记 — packages/ai/src/llm.ts（#143/#144/#145）

基底：main ff07f3e8；分支 evo/codeql-redos-1121；文件 packages/ai/src/llm.ts（1291 行）。
CodeQL 规则：`js/polynomial-redos`（多项式正则回溯）。

## 1. 三处被告正则（原文 + 攻击原理）

三处是**同一正则字面量** `/\/+$/`，作用在用户配置的 `baseUrl` 上（`opts.baseUrl` / `provider.baseUrl` 均来自用户填写的接口地址，属于远程可控输入）：

### #143 — llm.ts:975（generateImageSingle）
```ts
const baseUrl = opts.baseUrl.replace(/\/+$/, "");
```
攻击原理：`/\+$/` 的量词 `+` 与行尾锚点 `$` 组合后，对「N 个 `/` 后接一个非 `/` 字符」的输入，正则引擎要在每个起始位置回溯量词长度，总步数 O(N²)；单次恶意 baseUrl 即可拖垮事件循环。

### #144 — llm.ts:1092（createVideoTaskSingle）
```ts
const baseUrl = opts.baseUrl.replace(/\/+$/, "");
```
攻击原理：同上（同一正则、同一输入来源）。`createVideoTask` 的 baseUrl 同样由用户配置传入。

### #145 — llm.ts:1258（pollVideoTask）
```ts
const url = `${opts.baseUrl.replace(/\/+$/, "")}?video_id=${encodeURIComponent(opts.taskId)}&model_name=${encodeURIComponent(model)}`;
```
攻击原理：同上；且此处正则在每次轮询请求的 URL 拼接时执行，攻击者用一个恶意轮询端点即可反复触发。

## 2. 实测证据（本机 Node，旧正则）

输入：`'https://api.example.com/' + '/'.repeat(N) + 'a'`（末尾非 `/`，正则最终不匹配，但引擎仍要穷举）：

| N | 耗时 |
|---|---|
| 5,000 | 65 ms |
| 10,000 | 222 ms（≈4×） |
| 20,000 | 891 ms（≈4×） |
| 40,000 | 1,815 ms（≈4×） |

输入翻倍、耗时翻 4 倍——**二次方增长实锤**。按此趋势 N=200,000 约 45 秒，N=1,000,000 约 11 分钟，单请求即可让 Node 事件循环长时间卡死（拒绝服务）。

线性替代（倒序 `charCodeAt` 扫描 + `slice`）同等输入：N=1,000,000 仍为 0 ms。

## 3. 同文件排查：另两处相同正则（顺手同修）

- **llm.ts:265 `chatCompletionsUrl`**：`(baseUrl ?? "").trim().replace(/\/+$/, "")`——聊天流入口归一化，同一正则、同一输入来源（`provider.baseUrl`，callOnce/chatStream 两路调用）。
- **llm.ts:322 `capabilityKey`**：`provider.baseUrl.replace(/\/+$/, "")`——能力记忆缓存键，同一正则。

两处与三被告字面量、输入来源、风险等级完全相同，故同一提交内一并替换（根因相同，不另立任务）。

## 4. 其他正则评估（未动）

- `L230 /[。.!！?？\s]+$/g`（`isUpstreamCancelNotice`）：**同一二次方形态**（字符集量词 + `$` 锚点），输入为模型输出文本。CodeQL 未报（输入非直接用户配置），本次不动，列为后续候选：建议同样改为倒序扫描，或在 replace 前先按长度截断。
- `L594/L597 /<think>[\s\S]*?<\/think>/i`：惰性量词后接固定字面量，每位置只试一次，线性，无灾难回溯。
- `L403/L431 /^\d+(?:\.\d+)?$/`：双端锚定，`\d+` 与可选小数部分无重叠歧义，回溯总量 O(n)。
- `L360/L376/L378/L815` 常量提示正则：单字符可选分隔符 + 互斥分支，无嵌套量词。
- `L276 split(/[,\n]/)`、`L923 split(/\r?\n/)`：单字符类 / 可选单字符，线性。

## 5. 修复设计

新增（llm.ts，`chatCompletionsUrl` 附近，`LlmError` 定义之后）：

```ts
/** baseUrl 长度上限（字符）：合法端点地址远短于此值；超长输入直接拒掉（ReDoS 纵深防御）。 */
export const MAX_BASE_URL_LENGTH = 2048;

/** 剥离字符串末尾的 `/`（线性时间，无回溯）。倒序单遍扫描，行为与原 `/\/+$/` 逐字符等价。 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return value.slice(0, end);
}

/** baseUrl 归一化：trim + 长度上限 + 去尾斜杠；超长抛 config 错（与各调用点「未配置」校验同口径）。 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > MAX_BASE_URL_LENGTH) {
    throw new LlmError("config", `接口地址过长（超过 ${MAX_BASE_URL_LENGTH} 字符）`);
  }
  return stripTrailingSlashes(trimmed);
}
```

五处替换：

| 位置 | 原代码 | 新代码 |
|---|---|---|
| 265 `chatCompletionsUrl` | `(baseUrl ?? "").trim().replace(/\/+$/, "")` | `normalizeBaseUrl(baseUrl)` |
| 322 `capabilityKey` | `provider.baseUrl.replace(/\/+$/, "")` | `stripTrailingSlashes(provider.baseUrl)`（缓存键构造不抛错） |
| 975 `generateImageSingle` | `opts.baseUrl.replace(/\/+$/, "")` | `normalizeBaseUrl(opts.baseUrl)` |
| 1092 `createVideoTaskSingle` | `opts.baseUrl.replace(/\/+$/, "")` | `normalizeBaseUrl(opts.baseUrl)` |
| 1258 `pollVideoTask` | 内联 `${opts.baseUrl.replace(/\/+$/, "")}?...` | 先 `const baseUrl = normalizeBaseUrl(opts.baseUrl);` 再拼接 |

等价性验证（10 个边界用例：无斜杠 / 单斜杠 / 多斜杠 / 全斜杠 / 空串 / 斜杠在中间）：`stripTrailingSlashes` 与原正则输出逐字符一致（见本机实测）。

## 6. 测试计划

新增 `packages/ai/test/llm-redos.test.ts`：

- `stripTrailingSlashes` 等价性：覆盖上述边界用例，与原正则输出逐一比对。
- ReDoS 对抗：`"/".repeat(30000)` 后接非 `/` 的恶意串，`stripTrailingSlashes` 瞬时完成（旧正则在 N=20000 时已 891ms，vitest 默认 5s 超时会直接超时失败——完成本身即证明）。
- 长度上限：`normalizeBaseUrl("https://x/" + "/".repeat(3000))` 抛 `LlmError` code `config`；2048 字符内正常通过。
- 行为不变：`chatCompletionsUrl` 三组既有断言（无斜杠 / 尾斜杠 / 完整终点）继续通过；`generateImage` / `createVideoTask` / `pollVideoTask` 用 mock fetch 断言拼接出的 endpoint 与旧行为一致（含尾斜杠输入）。
