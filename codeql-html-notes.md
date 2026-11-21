# CodeQL 高危 HTML 过滤 / 多字符清洗 / 转义漏洞 — 原代码与攻击原理（第 2 类，4 处）

基底：main ff07f3e8；分支 evo/codeql-html-escape-1121。

## 1. apps/api/src/routes/submissions.ts:95-102（#146 错误的 HTML 过滤正则）

原代码（抓取正文后用正则链剥标签取文本，供 LLM 分类）：

```ts
scrapedText = (fetched.body || "")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-z#0-9]+;/gi, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 600);
```

攻击原理：正则无法理解 HTML 结构，`<a href="x>y">真实文本</a>` 会在属性内的 `>` 处提前截断（真实文本被吞、残留 `y">` 碎片），`<script>var s="</script>"</script>` 会提前闭合导致脚本残留进 LLM 语料；未闭合标签会吞掉后续全部正文。

修复：改用状态机 HTML 文本提取器（逐字符扫描，识别标签/引号属性/注释/`<!-- -->`/`<script>`/`<style>` 原文区、解码常见实体），零正则剥标签，线性时间。

## 2. apps/web-overlay/src/lib/video-transcript-sync.ts:159（#139 不完整的多字符清理）

原代码：

```ts
function stripCueTags(line: string): string {
  return line.replace(/<[^>]+>/g, '').trim()
}
```

同文件 :52（parseVTT）与 :106（parseSRT）是同一写法的内联版，一并改走修复后的辅助函数。

攻击原理：单次 replace 会把嵌套标签拼接复活——输入 `<scr<script>ipt>alert(1)</scr</script>ipt>` 时，正则先删掉内层的 `<script>` 与 `</script>`，外层残片拼成一个完整的 `<script>alert(1)</script>`，字幕文本里重新出现活标签。

修复：改用单遍状态机剥标签（逐字符扫描，`>` 在引号内不闭合标签，未闭合标签丢弃剩余部分），一次扫描即干净，不存在“删完再拼活”的中间态。

## 3. apps/web-overlay/src/lib/social-saves-import.ts:318（#138 不完整的多字符清理）

原代码（parseHnHtml，从 HN 导出 HTML 的 `<a>` 内文取标题）：

```ts
const title = (m[2] ?? '').replace(/<[^>]+>/g, '').trim()
```

攻击原理：与 #139 同一机制。HN 导出文件是外部输入，标题内文 `<scr<b>ipt>alert(1)</scr</b>ipt>收藏标题` 经单次 replace 后残片拼成活标签，随后以标题入库/渲染。

修复：同款单遍状态机剥标签辅助函数（本模块内自带，与 video-transcript-sync.ts 的同逻辑函数各自独立，避免跨模块的奇怪耦合），替换该处单次 replace。

## 4. apps/web-overlay/src/lib/save-annotations.ts:359-361（#136、#137 字符串转义不完整）

原代码（Markdown 导出时转义划线/批注文本）：

```ts
function escapeMarkdownText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}
```

攻击原理：转义 `[`/`]` 时漏掉了反斜杠 `\` 本身。输入 `a\]b` 时，`]` 被转义成 `\]`，前面已有的 `\` 与新加的 `\` 组成 `\\`（Markdown 里等于一个字面反斜杠），后面的 `]` 重新变回“活”字符——在 `## [标题](url)` 里可提前终结链接文本、实施链接文本注入。

修复：改为单遍映射表 `text.replace(/[\\<>\[\]]/g, ch => MAP[ch])`，其中 `\` → `\\`，`<` → `&lt;`，`>` → `&gt;`，`[` → `\[`，`]` → `\]`。每个输入字符恰好映射一次，已有的反斜杠先被转义，永远吃不掉后加的转义符。
