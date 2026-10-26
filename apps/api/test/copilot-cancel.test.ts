/**
 * copilot 取消链路（候选 2 + 候选 3）：用户按「停止」之后
 *   ① 中枢不许再打备用模型池，也不许把这次记成模型失败（污染大盘失败率）；
 *   ② 路由不许把取消当一次正常回答产出并记账，要落 499 + 一行 copilot_cancel；
 *   ③ 「正常写完」与「半路挂断」必须分得开——node http 的 'close' 两种情况都会触发。
 *
 * 三条语义各自锁一处代码：bindReplyAbort 用假 raw（不依赖真 socket），
 * callLlm 的 abort 即停用真 sqlite 数 llm_usage 行数，路由级用 app.inject +
 * onRequest 钩子里手动 emit('close')（确定时序，不靠真断连的竞速）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import type { FastifyReply } from "fastify";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { callLlm } from "../src/llm-usage.ts";
import { resetSystemLlmConfig, saveSystemLlmConfig, type ResolvedLlm } from "../src/llm-config.ts";
import { bindReplyAbort } from "../src/routes/copilot.ts";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-copilot-cancel-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      corsOrigins: ["*"],
    }),
  );
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 假 reply.raw：只需要 EventEmitter + writableEnded 两个成员，与 node http 的契约一致 */
function fakeReply() {
  const raw = Object.assign(new EventEmitter(), { writableEnded: false });
  const reply = { raw } as unknown as FastifyReply;
  return { raw, reply, close: (ended: boolean) => { raw.writableEnded = ended; raw.emit("close"); } };
}

describe("bindReplyAbort：把「半路挂断」翻译成 AbortSignal", () => {
  it("writableEnded=false 的 close 中止信号（客户端走了）", () => {
    const { reply, close } = fakeReply();
    const { signal } = bindReplyAbort(reply);
    expect(signal.aborted).toBe(false);
    close(false);
    expect(signal.aborted).toBe(true);
  });

  it("writableEnded=true 的 close 不中止——否则每次正常回答都被记成取消", () => {
    const { reply, close } = fakeReply();
    const { signal } = bindReplyAbort(reply);
    close(true);
    expect(signal.aborted).toBe(false);
  });

  it("finish 之后摘掉监听器（keep-alive 连接上不累积）", () => {
    const { raw, reply } = fakeReply();
    bindReplyAbort(reply);
    expect(raw.listenerCount("close")).toBe(1);
    raw.emit("finish");
    expect(raw.listenerCount("close")).toBe(0);
    expect(raw.listenerCount("finish")).toBe(0);
  });
});

/**
 * 备用池的 provider 用 127.0.0.1 + allowPrivateNetwork（与 llm-usage.test 同一口径），
 * 这样 assertLlmEndpoint 不会因外网域名解析失败而先把调用拦掉。
 */
function pool(tag: string, fallbackCount = 1): ResolvedLlm {
  const mk = (n: number) => ({
    name: "fake-" + tag + "-" + n,
    baseUrl: "http://127.0.0.1:1143" + n + "/v1",
    model: "fake-" + tag + "-" + n,
    apiKey: "sk-fake",
    allowPrivateNetwork: true,
  });
  return { provider: mk(0), fallbacks: Array.from({ length: fallbackCount }, (_, i) => mk(i + 1)), source: "system" } as unknown as ResolvedLlm;
}

async function usageRows(scenario: string) {
  return ctx.repo.raw("SELECT ok, error_code FROM llm_usage WHERE scenario = ?", [scenario]) as Promise<
    Array<{ ok: number; error_code: string | null }>
  >;
}

describe("callLlm：取消即停，不打备用池、不记失败用量", () => {
  it("信号在飞行中中止 ⇒ 只尝试 1 个 provider、llm_usage 零行、抛「模型调用被取消」", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const fakeFetch = (async (_url: string, init?: { signal?: AbortSignal | null }) => {
      attempts += 1;
      const signal = init?.signal;
      if (!signal) throw new Error("测试要求：外部 signal 必须已经并进真正下发的 fetch signal");
      return await new Promise<Response>((_resolve, reject) => {
        const onAbort = () => reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }) as unknown as typeof fetch;

    const pending = callLlm(ctx, pool("abort"), {
      scenario: "copilot",
      messages: [{ role: "user", content: "推荐一个 Markdown 编辑器" }],
      signal: controller.signal,
      fetchImpl: fakeFetch,
    });
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();

    await expect(pending).rejects.toThrow(/取消/);
    expect(attempts).toBe(1);
    expect(await usageRows("copilot")).toHaveLength(0);
  });

  it("对照：没有取消时备用池照打、每跳各记一行（证明上一条的红点确实是取消）", async () => {
    let attempts = 0;
    const fakeFetch = (async () => {
      attempts += 1;
      return new Response(JSON.stringify({ model: "fake", choices: [{ message: { content: "ok" } }] }), {
        status: attempts === 1 ? 500 : 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const res = await callLlm(ctx, pool("fallback", 2), {
      scenario: "enrich",
      messages: [{ role: "user", content: "ping" }],
      fetchImpl: fakeFetch,
    });
    expect(res.content).toBe("ok");
    expect(attempts).toBe(2);
    const rows = await usageRows("enrich");
    expect(rows).toHaveLength(2);
    expect(rows[0].ok).toBe(0);
    expect(rows[1].ok).toBe(1);
  });
});

describe("copilot 路由：取消落 499 + copilot_cancel，正常兜底落 copilot", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let captured: FastifyReply | null = null;

  beforeAll(async () => {
    app = await buildServer(ctx);
    // addHook 只能在 ready 之前注册；这里只为拿到 reply.raw 好按确定时序模拟挂断
    app.addHook("onRequest", async (req, reply) => {
      if (req.url.includes("/api/copilot/chat")) captured = reply;
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function eventRows() {
    return ctx.repo.raw(
      "SELECT kind, identity, meta FROM events WHERE kind IN ('copilot', 'copilot_cancel') ORDER BY created_at",
    ) as Promise<Array<{ kind: string; identity: string | null; meta: string | null }>>;
  }

  /** 轮询到条件成立为止；超时就把现场打进消息，失败时能一眼看出卡在第几步 */
  async function until(label: string, ms: number, cond: () => boolean | Promise<boolean>, scene: () => unknown) {
    const deadlineAt = Date.now() + ms;
    for (;;) {
      if (await cond()) return Date.now();
      if (Date.now() >= deadlineAt) throw new Error(label + " 超时 " + ms + "ms，现场：" + JSON.stringify(scene()));
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  it("真链路：模型在飞时挂断 ⇒ 立刻 499、不打备用池、llm_usage 零行、只记 copilot_cancel(stage=llm)", async () => {
    /**
     * 一台「接受连接但永不回话」的本地网关：provider 真的在飞，取消才有东西可中止。
     * thinking 显式关掉——系统级默认会把超时抬到 60s，万一信号没穿透，这条用例要
     * 等一分钟才红，红了也分不清是「没穿透」还是「单纯慢」。
     */
    const state = { hubHits: 0 };
    const hub = net.createServer((socket) => {
      state.hubHits += 1;
      socket.resume();
    });
    await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
    const baseUrl = "http://127.0.0.1:" + (hub.address() as net.AddressInfo).port + "/v1";
    let hungUpAt = 0;
    let settledAt = 0;
    try {
      await saveSystemLlmConfig(
        ctx,
        {
          enabled: true,
          baseUrl,
          model: "fake-hanging",
          apiKey: "sk-fake",
          timeoutMs: 5000,
          thinking: false,
          allowPrivateNetwork: true,
          fallbacks: [{ baseUrl, model: "fake-backup", apiKey: "sk-fake", timeoutMs: 5000, allowPrivateNetwork: true }],
        },
        "test",
      );

      const inflight = app.inject({
        method: "POST",
        url: "/api/copilot/chat",
        payload: { message: "推荐一个 Markdown 编辑器" },
      });
      // 「模型确实发出去了」才允许挂断——不用裸 sleep 赌 pre-LLM 那几段 DB 读的快慢
      await until("本地网关收到连接", 3000, () => state.hubHits > 0, () => state);

      const raw = (captured as unknown as { raw: EventEmitter & { writableEnded: boolean } }).raw;
      expect(raw.writableEnded).toBe(false);
      hungUpAt = Date.now();
      raw.emit("close");

      /**
       * 挂断之后没人再读得到响应体：light-my-request 自己也监听 'close'，会把 inject 的
       * promise 判成 ECONNRESET。真机同理——连接已经没了。所以状态码从 reply 对象上取
       * （reply.code() 写进去的），这里只把 harness 的判负咽下去，不为它写断言。
       */
      try {
        await inflight;
      } catch {
        /* 见上 */
      }
      // 取消闸门写的事件行就是中枢收尾的落点
      settledAt = await until("取消闸门写事件行", 3000, async () => (await eventRows()).length > 0, () => state);
    } finally {
      hub.close();
      await resetSystemLlmConfig(ctx, "test");
    }

    /** 挂断到收尾远小于 5s 超时：等满超时说明中止信号没穿透，只是碰巧回了个兜底答案 */
    expect(settledAt - hungUpAt).toBeLessThan(1500);
    // 备用池一跳都没打——主模型还在飞时用户挂了，不该再花钱问第二个模型
    expect(state.hubHits).toBe(1);
    expect(captured).not.toBeNull();
    expect((captured as unknown as { statusCode: number }).statusCode).toBe(499);

    // 取消不打备用池、也不记成模型失败
    expect(await usageRows("copilot")).toHaveLength(0);

    const rows = await eventRows();
    expect(rows.map((r) => r.kind)).toEqual(["copilot_cancel"]);
    const meta = JSON.parse(rows[0].meta ?? "{}") as Record<string, unknown>;
    expect(meta.stage).toBe("llm");
    expect(meta.quota_limited).toBe(false);
    expect(Number(meta.waited_ms)).toBeGreaterThanOrEqual(1);
  });

  it("未挂断时降级兜底照旧成功，并写一行 copilot（哨兵模型名 + 降级原因，不含问题原文）", async () => {
    const before = (await eventRows()).length;
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: { message: "推荐一个 Markdown 编辑器" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().model).toBe("local-heuristic-match");
    expect(res.json().degraded).toBe("unconfigured");

    const rows = await eventRows();
    expect(rows).toHaveLength(before + 1);
    const last = rows[rows.length - 1];
    expect(last.kind).toBe("copilot");
    const meta = JSON.parse(last.meta ?? "{}") as Record<string, unknown>;
    expect(meta.degraded).toBe("unconfigured");
    expect(meta.model).toBe("local-heuristic-match");
    expect(Number(meta.reply_chars)).toBeGreaterThan(0);
    // 记账只留维度：events 是可按身份导出/删除的表，把自由文本问题写进去等于新开一个原文存储
    expect(JSON.stringify(meta)).not.toMatch(/Markdown 编辑器/);
    expect(last.identity).toBeNull();
  });

  it("参数错误（400）不记 copilot 事件——没有发生过一次问答", async () => {
    const before = (await eventRows()).length;
    const res = await app.inject({ method: "POST", url: "/api/copilot/chat", payload: {} });
    expect(res.statusCode).toBe(400);
    expect((await eventRows()).length).toBe(before);
  });
});
