/**
 * AI-3 流式对话的前端接线守卫。
 *
 * 这一条链路上最容易出的事故不是「编译不过」，而是四种静默失效：
 *   1. 传输层把 SSE 缓冲成整段（逐段输出在客户端消失，用户看到的还是转圈两分钟）；
 *   2. 草稿当答案：模型编造的链接没经过服务端引用校验就被渲染成可点的 `<a>`；
 *   3. 断流没有终稿却把半截内容留下：用户分不清「答完了」和「掉线了」；
 *   4. 停止按钮只藏转圈、不真 abort（这一条由 copilot-cancel-guard.test.ts 锁）。
 *
 * 所以这里主要**真跑代码**：拿假 fetch 喂真帧，验解析、验分流、验报错；
 * 只有「抽屉怎么消费」这层落在源码接线（组件需要 DOM，不值得为此拉 jsdom）。
 * 断言不过就改实现，不许放宽断言。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamCopilotChat } from "@/lib/copilot-stream";
import { describeDegrade } from "@/lib/degrade";

const HERE = dirname(fileURLToPath(import.meta.url));

/** overlay 是事实源；apps/web/test 只是被 vitest 收集到的镜像，读文件要读 overlay */
function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();
const drawer = readFileSync(join(ROOT, "src/components/ai/ai-copilot-drawer.tsx"), "utf8");

/** 帧契约在 apps/api 那边，要从仓库根找（overlay 根往上没有 apps/api） */
function repoRoot(): string {
  const candidates = [resolve(HERE, "..", "..", ".."), resolve(HERE, "..", "..")];
  const hit = candidates.find((p) => existsSync(join(p, "apps", "api", "src", "routes", "copilot.ts")));
  if (!hit) throw new Error("无法定位仓库根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const route = readFileSync(join(repoRoot(), "apps", "api", "src", "routes", "copilot.ts"), "utf8");

const enc = new TextEncoder();

/** 造一个 SSE 响应：chunks 可以按任意粒度切（故意把多字节字符与帧切在中间） */
function sseResponse(chunks: (string | Uint8Array)[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/**
 * 取拒绝值。写成 `await p.catch(e => e)` 时类型是「成功值 | 错误」的联合，
 * tsc 只会报 TS2339；更要紧的是实现若退化成静默 resolve，报错长成
 * 「undefined 不等于 503」，看不出真正的问题（本该抛错却没抛）。
 */
async function rejection(p: Promise<unknown>): Promise<Error & { status: number }> {
  try {
    await p;
  } catch (e) {
    return e as Error & { status: number };
  }
  throw new Error("预期这次调用会抛错，但它成功 resolve 了");
}

const frame = (obj: Record<string, unknown>) => `data: ${JSON.stringify(obj)}\n\n`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("请求形态：声明可流式、把停止信号接进 fetch", () => {
  it("POST 站内 hub 路径，body 带 stream:true，Accept 同时声明两种格式", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      void _url;
      void init;
      return sseResponse([frame({ type: "done", ok: true, reply: "好" })]);
    });
    vi.stubGlobal("fetch", fetchMock);
    await streamCopilotChat("推荐一个 JSON 工具");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/hub/copilot/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)).stream).toBe(true);
    const accept = String((init.headers as Record<string, string>).Accept);
    expect(accept).toContain("text/event-stream");
    expect(accept).toContain("application/json");
  });

  it("thinking 只有显式传了才进请求体（关深度思考不能靠省略字段）", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init!.body)) as Record<string, unknown>);
        return sseResponse([frame({ type: "done", ok: true, reply: "好" })]);
      }),
    );
    await streamCopilotChat("a", undefined, { thinking: false });
    await streamCopilotChat("a", undefined, {});
    expect(bodies[0].thinking).toBe(false);
    expect("thinking" in bodies[1]).toBe(false);
  });

  it("调用方的 AbortSignal 原样交给 fetch：不接上就是「停止只藏转圈」", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        seen = init!.signal ?? undefined;
        return sseResponse([frame({ type: "done", ok: true, reply: "好" })]);
      }),
    );
    const controller = new AbortController();
    await streamCopilotChat("a", undefined, { signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });

  it("signal 不许塞进 JSON body（那是字段，不会中断连接）", async () => {
    let raw = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        raw = String(init!.body);
        return sseResponse([frame({ type: "done", ok: true, reply: "好" })]);
      }),
    );
    await streamCopilotChat("a", undefined, { signal: new AbortController().signal });
    expect(raw).not.toMatch(/signal/);
  });

  it("没配 Token 就不发 Authorization（避免带出 'Bearer null'）", async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        headers = init!.headers as Record<string, string>;
        return sseResponse([frame({ type: "done", ok: true, reply: "好" })]);
      }),
    );
    await streamCopilotChat("a");
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("event-stream 分支：逐段回调、done 为权威终稿", () => {
  it("delta 与 reasoning 分别回调，终稿取 done 的字段", async () => {
    const deltas: string[] = [];
    const reasons: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ": connected\n\n",
          frame({ type: "reasoning", text: "先查站内" }),
          frame({ type: "delta", text: "给" }),
          frame({ type: "delta", text: "你" }),
          frame({ type: "done", ok: true, reply: "给你三个站", citations: [{ siteId: "s1", title: "A", url: "https://a.com" }] }),
        ]),
      ),
    );
    const out = await streamCopilotChat("推荐站点", undefined, {
      onDelta: (t) => deltas.push(t),
      onReasoning: (t) => reasons.push(t),
    });
    expect(deltas).toEqual(["给", "你"]);
    expect(reasons).toEqual(["先查站内"]);
    expect(out.mode).toBe("stream");
    expect(out.final.reply).toBe("给你三个站");
    expect(out.final.citations?.[0].siteId).toBe("s1");
  });

  it("注释帧与 CRLF 分隔都不算数据（中间层改写行尾不能把草稿变成乱码）", async () => {
    const deltas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([": ping\r\n\r\n", 'data: {"type":"delta","text":"稳"}\r\n\r\n', 'data: {"type":"done","ok":true,"reply":"稳"}\r\n\r\n']),
      ),
    );
    const out = await streamCopilotChat("a", undefined, { onDelta: (t) => deltas.push(t) });
    expect(deltas).toEqual(["稳"]);
    expect(out.final.reply).toBe("稳");
  });

  it("跨块拆开的多字节字符不产生替代符（逐段输出最常见的是半个汉字）", async () => {
    const parts: Uint8Array[] = [];
    const bytes = enc.encode(frame({ type: "delta", text: "山羊胡" }) + frame({ type: "done", ok: true, reply: "山羊胡" }));
    for (let i = 0; i < bytes.length; i += 2) parts.push(bytes.slice(i, i + 2));
    let text = "";
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(parts)));
    const out = await streamCopilotChat("a", undefined, { onDelta: (t) => (text += t) });
    expect(text).toBe("山羊胡");
    expect(text).not.toContain("\uFFFD");
    expect(out.final.reply).toBe("山羊胡");
  });

  it("done 之后立刻收流，不等服务端关连接（否则逐段输出白跑一半）", async () => {
    // 故意不 close：真实模型网关常在终稿后挂着连接复用
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(enc.encode(frame({ type: "delta", text: "快" })));
              c.enqueue(enc.encode(frame({ type: "done", ok: true, reply: "快了" })));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    await expect(
      Promise.race([streamCopilotChat("a"), new Promise((r) => setTimeout(() => r("timeout"), 3000))]),
    ).resolves.toMatchObject({ final: { reply: "快了" } });
  });

  it("连接在无 done 的情况下结束：报错并说明「本次内容不作为结果」", async () => {
    let text = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([frame({ type: "delta", text: "半" }), frame({ type: "delta", text: "截" })])),
    );
    await expect(streamCopilotChat("a", undefined, { onDelta: (t) => (text += t) })).rejects.toThrow(/终稿/);
    // 半截草稿确实推给了调用方（进度要可见），但不会变成「答案」
    expect(text).toBe("半截");
  });

  it("解析不了的帧只丢进度，不炸整条流（真正的答案仍由 done 决定）", async () => {
    const deltas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(["data: {broken\n\n", frame({ type: "delta", text: "好" }), frame({ type: "done", ok: true, reply: "好" })])),
    );
    const out = await streamCopilotChat("a", undefined, { onDelta: (t) => deltas.push(t) });
    expect(deltas).toEqual(["好"]);
    expect(out.final.reply).toBe("好");
  });

  it("未知帧类型既不追草稿也不当终稿（协议演进必须显式加白名单）", async () => {
    const deltas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          frame({ type: "status", text: "内部状态" }),
          frame({ type: "done", ok: true, reply: "终稿" }),
        ]),
      ),
    );
    const out = await streamCopilotChat("a", undefined, { onDelta: (t) => deltas.push(t) });
    expect(deltas).toEqual([]);
    expect(out.final.reply).toBe("终稿");
  });

  it("done 形状非法（reply 非字符串）不算终稿：宁可报失败也不把坏形状交给抽屉", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([frame({ type: "done", ok: true, reply: 123 })])));
    await expect(streamCopilotChat("a")).rejects.toThrow(/终稿/);
  });

  it("done 之后同块里的 delta 与第二个 done 都被丢弃：终稿以第一个 done 为准", async () => {
    const deltas: string[] = [];
    // 四帧拼成一个 TCP 块：客户端必须在解析到第一个 done 时就停手
    const chunk = [
      frame({ type: "delta", text: "草稿" }),
      frame({ type: "done", ok: true, reply: "终稿一" }),
      frame({ type: "delta", text: "尾巴" }),
      frame({ type: "done", ok: true, reply: "终稿二" }),
    ].join("");
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([chunk])));
    const out = await streamCopilotChat("a", undefined, { onDelta: (t) => deltas.push(t) });
    expect(deltas).toEqual(["草稿"]);
    expect(out.final.reply).toBe("终稿一");
  });

  it("读取被 abort 时把原始错误抛出去（抽屉靠它区分「用户停止」与「故障」）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const err = new DOMException("The user aborted a request.", "AbortError");
      return Promise.reject(err);
    }));
    await expect(streamCopilotChat("a")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("响应声明了 event-stream 但拿不到可读流：明确报错，不退化成静默等整段", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { headers: { "content-type": "text/event-stream" } })));
    await expect(streamCopilotChat("a")).rejects.toThrow(/不支持流式读取/);
  });
});

describe("降级不开流：按 content-type 分流回一次性 JSON", () => {
  it("额度用尽返回 JSON 时走 json 模式，quota 字段原样交给抽屉", async () => {
    const payload = {
      ok: true,
      reply: "今天的额度用完了",
      degraded: "quota",
      model: "local-heuristic-match",
      quota: { metric: "calls", used: 50, limit: 50, retryAfterSeconds: 21600 },
      citations: [],
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(payload)));
    const out = await streamCopilotChat("a");
    expect(out.mode).toBe("json");
    expect(out.final.degraded).toBe("quota");
    expect(out.final.quota?.retryAfterSeconds).toBe(21600);
  });

  it("空 body 不炸（代理回了个 200 空壳时，交给抽屉的「没拿到答复」分支）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { headers: { "content-type": "application/json" } })));
    const out = await streamCopilotChat("a");
    expect(out.mode).toBe("json");
    expect(out.final).toEqual({});
  });

  it("非 2xx 带上状态码，且状态码能驱动重试出口", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "中枢正在重启" }, 503)));
    const err = await rejection(streamCopilotChat("a"));
    expect(err.status).toBe(503);
    expect(err.message).toBe("中枢正在重启");
    expect(describeDegrade(err).retryable).toBe(true);
  });

  it("非 2xx 且 body 不是 JSON（反代 HTML 错误页）时报错说人话", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } })),
    );
    const err = await rejection(streamCopilotChat("a"));
    expect(err.name).not.toBe("SyntaxError");
    expect(err.message).toBe("山羊胡中枢返回 HTTP 502");
    expect(err.status).toBe(502);
  });
});

describe("与中枢的帧契约逐字对齐", () => {
  it("帧类型以 core 单一事实源为准，服务端写入与客户端解析共用同一份", () => {
    const coreFrame = readFileSync(join(repoRoot(), "packages", "core", "src", "copilot-frame.ts"), "utf8");
    // 白名单只有三种；新增第四种必须先改这里，客户端解析才会认
    expect(coreFrame).toMatch(/export const COPILOT_FRAME_TYPES = \["delta", "reasoning", "done"\] as const/);

    // 服务端：写入函数受共享类型约束，不接受 payload: unknown 式的自由形状
    expect(route).toMatch(/import type \{ CopilotFrame,/);
    expect(route).toMatch(/const write = \(payload: CopilotFrame\)/);

    // 客户端：解析必须经过共享 schema，不许自己 JSON.parse + 字面量类型判断
    const client = readFileSync(join(ROOT, "src/lib/copilot-stream.ts"), "utf8");
    expect(client).toMatch(/import \{ parseCopilotFrame, type CopilotFrame \} from '\.\/copilot-frame'/);
    expect(client).toMatch(/return parseCopilotFrame\(dataLines\.join\('\\n'\)\)/);
  });

  it("流式只在模型真能跑时开启：额度/未配置仍回一次性 JSON（可用性看整个候选池）", () => {
    expect(route).toMatch(
      /if \(stream && prep\.quotaInfo === null && llmProviderReadyAny\(prep\.llm\)\) \{\s*\n\s*return streamCopilotReply\(/,
    );
    // 非流式路径同样按候选池判定，否则主模型缺密钥时备用池永远走不到
    expect(route).toMatch(
      /if \(prep\.quotaInfo === null && llmProviderReadyAny\(prep\.llm\)\) \{\s*\n\s*const \{ candidates \}/,
    );
  });

  it("SSE 出口声明了 event-stream 并关掉缓冲（否则逐段输出被中间层攒成整段）", () => {
    expect(route).toMatch(/setupSseStream\(reply\)/);
    const shared = readFileSync(join(repoRoot(), "apps", "api", "src", "routes", "shared.ts"), "utf8");
    expect(shared).toMatch(/"Content-Type", "text\/event-stream; charset=utf-8"/);
    expect(shared).toMatch(/"X-Accel-Buffering", "no"/);
  });
});

describe("抽屉接线：草稿只作进度，终稿覆盖，链接在定稿前不可点", () => {
  /** 取 `{draft && (` 到配平 `)` 的那段 JSX */
  function draftBlock(src: string): string {
    const open = src.indexOf("{draft && (");
    expect(open, "抽屉里没有草稿气泡分支").toBeGreaterThan(-1);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) return src.slice(open, i + 1);
      }
    }
    return src.slice(open);
  }

  it("用流式客户端，不再自己调 sendCopilotChat（两份出口会分叉）", () => {
    expect(drawer).toMatch(/from '@\/lib\/copilot-stream'/);
    expect(drawer).toMatch(/streamCopilotChat\(/);
    expect(drawer).not.toMatch(/sendCopilotChat\(/);
  });

  it("终稿来自 done 的 reply，不是本地拼出来的草稿", () => {
    expect(drawer).toMatch(/const \{ final: res \} = await streamCopilotChat\(/);
    expect(drawer).toMatch(/content: res\.reply,/);
    expect(drawer).not.toMatch(/content: draftRef\.current/);
  });

  it("入列与销毁草稿同批：不留「草稿 + 终稿」同屏的那一帧", () => {
    const commit = /const commit = \(msg: ChatMessage\) => \{([\s\S]*?)\}/.exec(drawer);
    expect(commit, "抽屉里没有 commit()").toBeTruthy();
    const bodyText = commit![1];
    expect(bodyText.indexOf("draftRef.current = null")).toBeLessThan(bodyText.indexOf("setMessages("));
    expect(bodyText.indexOf("setDraft(null)")).toBeLessThan(bodyText.indexOf("setMessages("));
  });

  it("草稿气泡是纯文本：链接没经过引用校验，提前可点就是替模型编造背书", () => {
    const block = draftBlock(drawer);
    expect(block).toMatch(/whitespace-pre-wrap/);
    expect(block).not.toMatch(/href=/);
    expect(block).not.toMatch(/renderMessageContent\(/);
    expect(block).not.toMatch(/citations/);
  });

  it("草稿气泡里有停止键，并如实标注「尚未定稿」", () => {
    const block = draftBlock(drawer);
    expect(block).toMatch(/renderStopButton\(\)/);
    expect(block).toMatch(/尚未定稿/);
  });

  it("第一个 token 播报一次，之后不再刷读屏队列", () => {
    expect(drawer).toMatch(/let announcedStream = false/);
    expect(drawer).toMatch(/if \(!announcedStream\) \{/);
    expect(drawer).toMatch(/回答开始逐段输出，可随时停止/);
    expect(drawer.match(/回答开始逐段输出/g)).toHaveLength(1);
  });

  it("失败与停止都会清掉草稿（半截内容不能留在会话里）", () => {
    const catchAt = drawer.indexOf("} catch (err)");
    expect(catchAt).toBeGreaterThan(0);
    expect(drawer.slice(catchAt, catchAt + 700)).toMatch(/draftRef\.current = null/);
  });
});
