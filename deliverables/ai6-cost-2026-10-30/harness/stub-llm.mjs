/**
 * AI-6 隔离实测用假大模型（只服务 /v1/chat/completions 的非流式调用）。
 *
 * 目的：让「成本快照」与「画布首过率」两处新读数在浏览器里可重复触发。
 *   - 普通对话（含「测试连接」）→ 回 pong + 固定 token 用量，model 回显请求体里的 model，
 *     这样把管理端表单里的模型名改成 stub-model-2 就能造出「无单价 → 未采集成本」的一行。
 *   - 画布规划（提示词含「请为我规划专属工作台：」）：
 *       含「保底」→ 只给本部署不存在的类型 ⇒ 校验丢弃 + 保底布局（首过失败）
 *       否则      → 一张合法的 markdown-notes 卡 ⇒ issues=0、fallback=false（首过成功）
 */
import { createServer } from "node:http";

const CLEAN = {
  title: "实测工作台",
  description: "一张合法卡",
  rationale: "用于首过率成功样本",
  widgets: [
    { id: "w1", type: "markdown-notes", customTitle: "备忘", colSpan: 4, rowSpan: 2, config: {} },
  ],
};

const FALLBACK = {
  title: "全是幻觉",
  description: "一个合法模块都没给",
  rationale: "只有本部署没有的类型",
  widgets: [
    { id: "a", type: "weather-widget", colSpan: 4, rowSpan: 1, config: {} },
    { id: "b", type: "not-a-real-widget", colSpan: 4, rowSpan: 1, config: {} },
  ],
};

function reply(res, content, model, usage) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      model,
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
      usage,
    }),
  );
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "stub: unsupported " + req.url }));
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      // ignore
    }
    const msgs = body.messages ?? [];
    const last = String(msgs[msgs.length - 1]?.content ?? "");
    const model = String(body.model || "stub-model-1");
    if (last.includes("请为我规划专属工作台")) {
      const layout = last.includes("保底") ? FALLBACK : CLEAN;
      reply(res, JSON.stringify(layout), model, {
        prompt_tokens: 120,
        completion_tokens: 260,
        total_tokens: 380,
      });
      return;
    }
    reply(res, "pong（stub 连通正常）", model, {
      prompt_tokens: 40,
      completion_tokens: 80,
      total_tokens: 120,
    });
  });
});

const port = Number(process.env.STUB_PORT ?? 8929);
server.listen(port, "127.0.0.1", () => {
  console.log("[stub-llm] listening on 127.0.0.1:" + port);
});
