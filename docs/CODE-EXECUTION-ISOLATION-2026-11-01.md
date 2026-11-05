# 代码执行面隔离：不透明源沙盒（现行）

> **状态：现行。** 落地 2026-11-01（商用级升级批次 2 / A2）。
> 一句话：**AI 生成的与用户粘贴进输入框的代码，只在 `<iframe sandbox="allow-scripts">` 的不透明源文档里执行；
> 环境不给跑就只显示代码，绝不退回同源执行。**
> 相关代码：[`apps/web-overlay/src/lib/video-opaque-sandbox.ts`](../apps/web-overlay/src/lib/video-opaque-sandbox.ts)、
> 守卫：[`apps/web-overlay/test/opaque-code-sandbox-guard.test.ts`](../apps/web-overlay/test/opaque-code-sandbox-guard.test.ts)。

## 一、要解决的两件事（都不是假想风险）

1. **同源权限外泄。** 视频页两个「即时运行」面板（沙盒工程 / 课后 TDD）此前用 `new Function` 在
   **页面自己的 realm** 里跑代码，而那份代码来自 AI 生成与用户粘贴。同源 realm 意味着它能读
   `localStorage` 里的会话、拿 cookie、伪造 `fetch`、改写 DOM——等于把登录态交给任意一段被贴进输入框的文字。
2. **顺带查到的事实：那套代码在真人浏览器里从来没跑通过。** 本仓 CSP 是
   `script-src 'self' 'unsafe-inline'`，**没有** `'unsafe-eval'`
   （[`apps/web-overlay/next.config.js`](../apps/web-overlay/next.config.js)）。srcdoc 帧继承父文档下发的策略，
   所以 `new Function` 在帧里也被拦，报的是 CSP 违规而不是用户代码的错误。
   ⇒ 用户看到的现象是「点运行一直红灯，错误信息看不出所以然」。
   **这不是「安全 vs 能用」的取舍，两边本来都坏。** 现在的做法两个都修：既不越隔离，也不需要放宽 CSP。

## 二、机制

### 容器

| 项 | 值 | 为什么 |
| --- | --- | --- |
| `sandbox` | `allow-scripts`（常量 `SANDBOX_FLAGS`） | **不给** `allow-same-origin` ⇒ 该文档是不透明源（origin 字面量 `"null"`）：拿不到父文档、cookie、`localStorage`，不能顶层跳转、不能开弹窗 |
| 内容来源 | `frame.srcdoc = HARNESS_HTML`，而 `HARNESS_HTML` 是**逐字常量**（数组 `join('\n')`，里面没有任何 `${}`） | 用户代码不进 HTML 字符串 ⇒ 贴一段 `</script>` 越不出壳子 |
| 其他属性 | `title` / `aria-hidden="true"` / `referrerpolicy="no-referrer"` / 1px 隐藏定位 | 不进无障碍树、不带 referer |

### 唯一「字符串 → 可执行体」的地方

harness 内部：`document.createElement('script')` + `el.textContent = code` + `document.head.appendChild(el)`。
浏览器按**普通内联脚本**编译它（`'unsafe-inline'` 已允许），**全程零 `eval` / 零 `new Function`**——
`textContent` 不进 HTML 解析器，也不经求值器。能编译这段代码的只有那个不透明源文档自己。
这条形状被守卫钉住（「沙盒把代码交给浏览器的形状……没有第二条路」），全仓求值点为 0 也被钉住。

### 父 ↔ 帧协议（`navhub-opaque-sandbox-v1`）

```
父                                    帧（不透明源）
 |---- appendChild(iframe srcdoc) ---->|
 |<--- hello --------------------------|   harness 首个脚本任务
 |---- handshake{nonce} -------------->|
 |<--- ready --------------------------|
 |---- load{id, code} ---------------->|  ……编译并执行……
 |<--- log{level, text}  ×N -----------|   与 result 交错，顺序即真实顺序
 |<--- result{id, ok, hasValue, ...} --|   每个 id 恰好一条
 |---- invoke{id, exportName, args} -->|
```

- **回信必须验源**：`event.source === frame.contentWindow` **且** `protocol` 与 `nonce` 匹配。
  只看 `data.protocol` 不够——同一页还嵌着视频站的播放器 iframe，它们同样能向 `parent` 发消息，
  伪造出「沙盒日志」。父侧共两处校验（握手 + 会话监听），守卫测试数的就是这两处。
- **父→帧用 `'*'`**：不透明源的 origin 字面量就是 `"null"`，各浏览器写法不一致；
  而且这里发出去的是本来就要交给那段代码执行的输入，没有任何机密可泄。

### 资源闸（防「沙盒反过来拖死页面」）

| 上限 | 值 | 超了会怎样 |
| --- | --- | --- |
| 单次代码体积 | 200 KB | `stopReason: 'rejected'`，一行都不执行 |
| 日志行数 | 400（父侧保留尾部） | 丢弃后续行，`while(true) console.log()` 打不满父页面内存 |
| 单行文本 | 4000 字符 | 截断并加「…（已截断）」 |
| 单次执行 | 8000 ms | `stopReason: 'timeout'`，放弃等待 |
| 握手就绪 | 4000 ms | `OpaqueSandboxUnavailableError` → `stopReason: 'unavailable'` |

`stopReason` 三分类（`unavailable` / `rejected` / `timeout`）存在的意义：界面要能区分
**「你的代码有错」** 和 **「这个环境不给跑」**。后者显示「仅阅读 + 复制」，**不做同源回退**——退回去等于白改。

## 三、契约变更（写给用户/教程口径的）

| 旧（同源 realm，`new Function` 包裹） | 新（不透明源，经典脚本） |
| --- | --- |
| 顶层 `return {...}` 就是结果 | **顶层 `return` 是语法错误**（经典脚本）。结果一律写进 `exports`，例如 `exports.result = { status: 'ready' }` |
| 返回值任意 | 返回值只能走结构化克隆。函数被替换成 `'[function 名字]'` 占位；class / DOM 节点 / 循环引用 → `valueUnavailable: true` + `valueText` 纯文本，界面照样显示 |
| 错误 = `try/catch` 捕获的异常 | 语法错由 `appendChild` 抛出（实测形如 `Unexpected token '='`）；运行期未捕获错误经 `window.onerror` 归到**本次**请求（`loadTask` 闩锁保证只回一次话）；`unhandledrejection` 单独作为错误日志 |
| 「函数不存在」与「函数自己抛错」混在一起 | `noExport: true`（靠 `navhubNoExport` 标记）单独区分——否则 `toThrow` 类课后用例会把「没这个导出」判成通过 |

错误消息**只回传 `message` 不回传 `stack`**：调用方原来打的就是 `err.message`，塞一整段带行号的栈会把面板撑到没法读。

## 四、消费方接线

| 文件 | 接法 |
| --- | --- |
| [`src/lib/video-code-sandbox-runtime.ts`](../apps/web-overlay/src/lib/video-code-sandbox-runtime.ts) | VFS 打包依赖后交给 `session.load`；默认 `openSession: openOpaqueSession`，测试注入 stub 会话。无沙盒 → `success:false` + `stopReason:'unavailable'` |
| [`src/lib/video-live-test-runner.ts`](../apps/web-overlay/src/lib/video-live-test-runner.ts) | 课后 TDD 每条用例经 `session.load` + `session.invoke`。开不了会话 ⇒ 整套用例判 `blocked`，**不执行任何代码** |
| [`src/components/video-sandbox-runner-pane.tsx`](../apps/web-overlay/src/components/video-sandbox-runner-pane.tsx) | 「&lt; 返回值」改为「&lt; 导出结果」；空控制台提示改成 `exports.result = ...` 口径；原来那块**假的**「沙盒环境已隔离」面板换成用同一个 `SANDBOX_FLAGS` 的真隔离 iframe |
| [`src/components/video-code-sandbox.tsx`](../apps/web-overlay/src/components/video-code-sandbox.tsx) | 该页 srcdoc 预览（功能本体，不重写）补上 `e.source !== iframeRef.current?.contentWindow` 过滤，假日志进不了控制台 |

## 五、门禁：谁盯着它不退化

- **守卫测试** `apps/web-overlay/test/opaque-code-sandbox-guard.test.ts`，A–F 六组共 29 条。
  **实际跑的是镜像副本** `apps/web/test/opaque-code-sandbox-guard.test.ts`——根 `vitest.config.ts` 的
  include 里没有 `apps/web-overlay/test`，直接跑 overlay 路径会得到「No test files found」。
  - **A 全仓零求值**：`src` 树里 `new Function` / `eval` 代码点为 0（**harness 也不例外**）；
    交给浏览器的形状唯一（恰一处 `createElement('script')`、必须 `el.textContent = code;`、壳子内不许有 `${`）；
    **CSP 不含 `unsafe-eval`**（前提哨兵——有人往 CSP 加回 `unsafe-eval`，说明这条链的前提被动了，必须连带重新审视）；
    契约写在默认示例里（有 `exports.result =`、没有顶层 `return {`）。
  - **B 容器隔离**：凡自造内容（`srcdoc` / `createObjectURL`）的 iframe，其 `sandbox` 都不许带
    `allow-same-origin`；解析不出字面量时如实报 `<无法解析>` 而不是放行。
  - **C 回信验源**：父侧两处 `event.source` 校验（握手 + 会话）。
  - **D 不降级**：没有隔离环境就一行代码都不许跑（行为断言，非扫描）。
  - **E 行为**：stub 会话驱动——依赖确实内联进交给沙盒的代码、日志与结果交错、`noExport` 与自抛错误分得开。
  - **F 判据本身有效**：合成正/负样本（注释里提 `new Function` 不算命中、`retrieval(` 不算 `eval(`、
    CSV 下载的 `createObjectURL` 不算自造文档）。这一组是防「扫描机瞎了」——判据太烦人就会被删，所以宁可多写。
- **`node scripts/typecheck-video-scope.mjs`** 按 `src/lib/video-*.ts` 自动发现文件；这个文件正该被那道闸按住。
- **镜像同步**：本次 9 个文件逐份 `overlay → apps/web` 拷贝并 md5 核对，**不用**整树生成脚本
  （`generate-web-mirror.mjs`），避免把并行会话的在飞漂移一起写进镜像。

## 六、明确不做的，以及为什么

- **不换成专用 Worker。** 沙盒 iframe 与页面**共用主线程** ⇒ 同步死循环仍会卡住标签页
  （与改造前相同，没有更差）。要做到「卡住也不影响页面」得换 Worker，而 Worker 需要把 CSP 的
  `worker-src` 放开到 `blob:`。**为省一次卡顿去放宽安全策略，方向不对。** 真要做，应连同「代码放进
  `Blob` + `Worker`」的 CSP 变更一起评审，而不是顺手加。
- **不引入独立沙盒域**（把 harness 部署到另一域名下）。那要动部署与 CSP `frame-src`，而
  `sandbox="allow-scripts"` 已经拿到绝大部分收益（同源权限、DOM、存储都拿不到）。
- **不重写 `video-code-sandbox.tsx` 的 srcdoc 预览本体**——那是产品功能；本次只修它的真缺陷（缺来源校验）。

## 七、首轮验证记录（2026-11-01，历史快照）

### 真人浏览器实测

独立探针（`Temp/navhub-sandbox-probe`，端口 39435，构建标记 `probe-r2-inline-script`）：页面**按本仓 CSP 逐字下发**，
harness **取源码里的原文**（脚本自己断言 harness 里没有求值 API），跑 4 组步骤。关键读数原文：

```
FRAME_ORIGIN: null
BLOCKED_LOCALSTORAGE: SecurityError
BLOCKED_PARENT_DOM: SecurityError
BLOCKED_PARENT_ACCESS: SecurityError
BLOCKED_EVAL_IN_FRAME: EvalError            ×2（沙盒内 eval / new Function 都被 CSP 拦）
[isolation] load ok=true value={"probe":"[function anonymous]","result":{"status":"ran-in-opaque-frame"}}
[isolation] invoke ok=true value={"isolated":true,"four":4}
[syntax]    load ok=false err=Failed to execute 'appendChild' on 'Node': Unexpected token '='
[thrower]   load ok=false err=顶层就炸
[thrower]   invoke ok=false err=自己抛的
[escape]    LOG </script><script> 里没越界
DONE                                        （全程 0 条 LEAK）
```

> 一个取证坑：CDP/`evaluate_script` 注入的执行**不受页面 CSP 约束**，所以用那条通道做的顶层探针
> 不能当作「页面自己的脚本也跑不通」的证据；上面全部读数都来自页面内的真实脚本。

### 测试与闸门（同日复跑）

| 项 | 结果 |
| --- | --- |
| `opaque-code-sandbox-guard.test.ts` + `video-evolution-v10.test.ts` | 46/46 绿（29 + 17） |
| 全量 web 套件（含本次改造的既有视频用例） | 3063/3063 绿 |
| `node scripts/typecheck-video-scope.mjs` | 82 个模块 0 类型错误 |
| `node scripts/check-web-overlay.mjs` | 1017 个覆盖层文件与 `apps/web` 一致 |

### 消融自证：拆掉防护必被抓住

每条 = 故意拆掉一处防护 → 跑镜像守卫 → 记下抓住它的判据 → 按字节还原（md5 全对）。**9/9 变红。**

| # | 拆除 | 抓到它的判据 |
| --- | --- | --- |
| 1 | 把 `allow-same-origin` 加回执行容器 | B：凡是自造内容的 iframe，其 sandbox 都不许带 allow-same-origin（+ F：sandbox 解析能认出被加回去的 `allow-same-origin`） |
| 2 | runtime 里重新引回同源 `new Function` | A：src 树里 new Function / eval 的代码点为 0（+ A：两个消费者都改走沙盒，且不再有各自的求值） |
| 3 | 会话回信不再验 `event.source` | C：沙盒客户端两处校验 event.source（hello 握手 + 会话回信） |
| 4 | CSP 放进 `unsafe-eval` | A：本仓 CSP 不含 unsafe-eval（+ F：CSP 指令读取得到真值，取不到时如实为空而不是蒙混） |
| 5 | harness 里多出第二个造脚本元素的地方 | A：沙盒把代码交给浏览器的形状：脚本元素 + textContent，没有第二条路 |
| 6 | harness 里开始往壳子插值（`${}`） | A：同上一条（壳子必须是逐字常量） |
| 7 | 默认示例退回顶层 `return` | A：沙盒的契约写在示例代码里：结果走 exports，不走顶层 return |
| 8 | 跑不成却不再如实申报「未执行」 | D：`runLiveCodeTest` 在无 DOM 环境里判 blocked，且不执行任何代码 |
| 9 | 沙盒不可用时偷偷改用页面内执行 | D：同上一条 |

> 消融坑（本次踩到，记下来）：行为类用例 `import '@/lib/...'` 解析到的是**镜像**实现，
> 所以 D 组消融一开始改 `apps/web-overlay/src/lib/video-live-test-runner.ts` 是**假红**（绿了），
> 必须改 `apps/web/src/lib/...` 才测得到。
