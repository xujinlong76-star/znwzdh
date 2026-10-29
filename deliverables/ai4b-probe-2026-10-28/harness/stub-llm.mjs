/**
 * 本地假大模型：只服务 /v1/chat/completions，返回写好的三条平替候选。
 *
 * 为什么需要它：[AI-4b] 要证明的是「模型说了不算，实测才算」。真实模型每次给的 URL 都不同，
 * 而候选档位又依赖那次真实网络请求 —— 浏览器里看到的红绿徽章无法复现，也就无法判责。
 * 这里把模型输出钉死成三条「各自对应一种实测档位」的 URL，档位由预置的探活缓存给出
 * （见 seed.ts），于是同一次巡检在任意机器上都会渲染出同一组结论。
 *
 * 三条 URL 都指向 ai4b-demo.example —— 这个域名的请求永远不会真的发出：
 * 缓存里已有未过期结论，`probeCandidateUrl` 命中即返回。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT || 8921);

const CANDIDATES = [
  { title: "AI4B 稳替（模型自述可用）", url: "https://ai4b-demo.example/ai-verified", reason: "同生态、知名度高，模型判断可直接替换" },
  { title: "AI4B 慢站（模型自述可用）", url: "https://ai4b-demo.example/ai-slow", reason: "功能最接近，但模型也无法确认其响应速度" },
  { title: "AI4B 已下线官网", url: "https://ai4b-demo.example/ai-gone", reason: "模型称这是官方继任站点" },
];

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "stub: unsupported " + req.url }));
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    console.log(`[stub-llm] chat/completions @${new Date().toISOString()} bytes=${raw.length}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        model: "stub-probe-1",
        choices: [{ message: { role: "assistant", content: JSON.stringify(CANDIDATES) } }],
        usage: { prompt_tokens: 60, completion_tokens: 120, total_tokens: 180 },
      }),
    );
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[stub-llm] listening on 127.0.0.1:${PORT}`));
