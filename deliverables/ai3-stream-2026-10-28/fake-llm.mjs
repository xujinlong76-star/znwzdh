/**
 * 假模型上游（仅供本机流式实测）：OpenAI 兼容 /v1/chat/completions。
 *
 * 为什么要假的：真实网关的首 token 时延与内容都不可控，逐段输出、停止、
 * 引用降级这三件事必须能反复重现，否则「实测过」只是一句口号。
 *
 * 输出里刻意放两条链接：
 *   - 一条来自中枢提示词里的真实候选（服务端应保留为引用）；
 *   - 一条模型自己编造的域名（服务端 groundCopilotReply 应降级成纯文本）。
 */
import { createServer } from "node:http";

const PORT = 8899;
const CHUNK_MS = 220;

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * 从中枢提示词的候选块里取第一条真实候选。
 * 中枢的候选行格式是 `1. 标题（分类：X；标签：Y）— 简介 — URL`
 * （见 apps/api/src/routes/copilot.ts 的 candidateBlock），
 * 早期版本按 markdown 链接找，永远找不到 ⇒ 正例引用这条路根本没被测到。
 */
function firstCandidate(messages) {
  const text = (messages ?? []).map((m) => String(m?.content ?? "")).join("\n");
  const line = text.split("\n").find((l) => /^\s*1\.\s/.test(l));
  if (!line) return null;
  const url = /(https?:\/\/\S+)\s*$/.exec(line.trim())?.[1];
  const title = /^\s*1\.\s*([^（(]+)/.exec(line)?.[1]?.trim();
  return url && title ? { title, url } : null;
}

function replyParts(messages) {
  const c = firstCandidate(messages);
  const verified = c
    ? `站内最匹配的是 [${c.title}](${c.url})，它就在本次检索候选里。`
    : "站内最匹配的是 [示例候选](https://example.com/a)，它就在本次检索候选里。";
  return [
    { reasoning: "先核对检索候选，" },
    { reasoning: "只引用真实存在的站点。" },
    { content: "我按你的问题查了站内收录。" },
    { content: verified },
    { content: "另外推荐 [编造站点](https://fabricated.example/not-in-catalog)，" },
    { content: "这条其实不在候选里，用来验证服务端会不会把它降级。" },
  ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 归属标记：巡检脚本把 `#巡检X` 写进问题里，日志用它把「一条浏览器判据」
 * 对上「一次真实的上游调用」。`untagged` 就是别的客户端——本机端口被共用时，
 * 这类调用会把「中枢降级」误读成「前端没做逐段输出」（2026-10-28 真踩过）。
 */
function attribution(messages) {
  const text = (messages ?? []).map((m) => String(m?.content ?? "")).join("\n");
  return /#巡检[A-Z0-9]+/.exec(text)?.[0] ?? "untagged";
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "";
  if (req.method !== "POST" || !url.includes("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }
  const body = await readBody(req);
  const parts = replyParts(body.messages);
  const tag = attribution(body.messages);
  const at = new Date().toISOString();
  console.log(`[${at}] call tag=${tag} stream=${body.stream ? 1 : 0}`);

  if (!body.stream) {
    const content = parts
      .filter((p) => p.content)
      .map((p) => p.content)
      .join("");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        model: "fake-stream-model",
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
      }),
    );
    console.log(`[${at}] done tag=${tag} mode=json`);
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  const send = (payload) => res.write("data: " + JSON.stringify(payload) + "\n\n");
  send({ model: "fake-stream-model", choices: [{ delta: { role: "assistant" } }] });
  let aborted = false;
  // 判据用 res.writableEnded，和中枢 bindReplyAbort 同一口径：
  // Node 的 req 'close' 在请求体已读完之后不会因客户端断连再触发一次，
  // 只看 req.close 会把「上游真被掐断」测成「上游跑完了」——今天的假绿灯就是这么来的。
  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });
  req.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });
  for (const part of parts) {
    // 拆成两半发：真实网关按 token 切片，整段发会掩盖「半帧缓冲」这类问题
    const text = (part.content ?? part.reasoning) ?? "";
    const half = Math.ceil(text.length / 2);
    const first = text.slice(0, half);
    const second = text.slice(half);
    const key = part.content ? "content" : "reasoning_content";
    for (const piece of [first, second]) {
      if (!piece || aborted) continue;
      await sleep(CHUNK_MS);
      if (aborted) break;
      send({ choices: [{ delta: { [key]: piece } }] });
    }
  }
  if (!aborted) {
    send({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 } });
    res.write("data: [DONE]\n\n");
  }
  res.end();
  console.log(`[${at}] done tag=${tag} mode=stream aborted=${aborted ? 1 : 0}`);
});

server.listen(PORT, "127.0.0.1", () => console.log("fake llm on http://127.0.0.1:" + PORT));
