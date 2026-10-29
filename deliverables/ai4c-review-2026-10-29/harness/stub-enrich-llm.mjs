/**
 * [AI-4c] 假大模型：只服务 /v1/chat/completions，返回固定的富化结果。
 *
 * 为什么需要钉死模型输出：本轮要验证的是「审核界面展示的来源/值 × 勾选 × 落库」
 * 三者一致。真实模型每次返回的值都不同，无法做「审核看到的就是库里存的」这种断言。
 *
 * 返回按目标 URL 区分：
 *   - /rich → 标题/描述/标签/类目都给（全部标 llm）
 *   - /bare → 标签给空数组（走 missing），其余照给
 * 另开 /__stats 暴露调用次数，用来证明「建站时没有第二次模型调用」。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_LLM_PORT || 8922);
let calls = 0;
const seenUrls = [];

function payloadFor(url) {
  if (url.includes("/bare")) {
    return {
      title: "Bare Site（模型标题）",
      description: "模型补写的描述：这个页面没有自己的 description 元数据。",
      tags: [],
      keywords: ["bare"],
      category: "开发工具",
    };
  }
  return {
    title: "富化演示站（模型标题）",
    description: "模型归纳的描述：面向开发者的演示站点，用于验证字段级审核流程。",
    tags: ["开发者工具", "效率"],
    keywords: ["demo", "tools"],
    category: "开发工具",
  };
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/__stats") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ calls, seenUrls }));
    return;
  }
  if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls += 1;
      let target = "";
      try {
        const parsed = JSON.parse(raw);
        const userText = parsed.messages?.map((m) => m.content).join("\n") ?? "";
        const m = userText.match(/https?:\/\/[^\s"']+/);
        target = m ? m[0] : "";
      } catch {
        // 坏请求也计数：正好证明调用发生过
      }
      seenUrls.push(target);
      console.log(`[stub-enrich-llm] call#${calls} url=${target}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: "stub-enrich-1",
          choices: [{ message: { role: "assistant", content: JSON.stringify(payloadFor(target)) } }],
          usage: { prompt_tokens: 80, completion_tokens: 90, total_tokens: 170 },
        }),
      );
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "stub: unsupported " + req.method + " " + req.url }));
});

server.listen(PORT, "127.0.0.1", () => console.log(`[stub-enrich-llm] listening on 127.0.0.1:${PORT}`));
