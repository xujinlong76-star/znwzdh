/**
 * 本地假大模型：只服务 /v1/chat/completions，返回预先写好的画布规划 JSON。
 *
 * 为什么需要它：[AI-4a] 的两条前端断言（保底布局横幅、校验台账）取决于模型返回什么，
 * 而真实模型不可控也没密钥。这里把「脏数据」与「全非法」两种输出做成可重复触发，
 * 浏览器才能每次都看到同一件事。
 *
 * 触发词在用户消息里（中枢的提示词是「请为我规划专属工作台：<prompt>」）：
 *   含「保底」→ 只给本部署不存在的类型 ⇒ 后端回保底布局
 *   其它      → 越界跨度 + 非法类型 + javascript: 取数地址 ⇒ 校验台账
 */
import { createServer } from "node:http";

const DIRTY = {
  title: "脏数据工作台",
  description: "用来触发逐类型校验的规划结果",
  rationale: "顶部搜索，下挂雷达图与订阅",
  widgets: [
    { id: "w1", type: "hyperbolic-radar", customTitle: "站点雷达", colSpan: 2, rowSpan: 1, config: {} },
    { id: "w2", type: "not-a-real-widget", customTitle: "幻觉卡片", colSpan: 4, rowSpan: 2, config: {} },
    { id: "w3", type: "rss-feed", customTitle: "订阅", colSpan: 4, rowSpan: 2, config: { feedUrl: "javascript:alert(1)", title: "订阅", limit: "很多" } },
  ],
};

const FALLBACK = {
  title: "全是幻觉",
  description: "一个合法模块都没给",
  rationale: "只有本部署没有的类型",
  widgets: [
    { id: "a", type: "weather-widget", colSpan: 4, rowSpan: 1, config: {} },
    { id: "b", type: "", colSpan: 4, rowSpan: 1, config: {} },
  ],
};

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "stub: unsupported " + req.url }));
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let wantFallback = false;
    try {
      const body = JSON.parse(raw);
      const msgs = body.messages ?? [];
      const last = String(msgs[msgs.length - 1]?.content ?? "");
      wantFallback = last.includes("保底");
    } catch {
      // 解析不了就按脏数据回，不要让浏览器等到超时
    }
    const layout = wantFallback ? FALLBACK : DIRTY;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        model: "stub-canvas-1",
        choices: [{ message: { role: "assistant", content: JSON.stringify(layout) } }],
        usage: { prompt_tokens: 40, completion_tokens: 80, total_tokens: 120 },
      }),
    );
  });
});

server.listen(Number(process.env.STUB_PORT ?? 8919), "127.0.0.1", () => {
  console.log("[stub-llm] listening on 127.0.0.1:" + (process.env.STUB_PORT ?? 8919));
});
