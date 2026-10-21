/**
 * 响应压缩（gzip）回归。
 *
 * 背景：插件市场列表单次响应 1.16MB（每行带完整 manifest），
 * 而默认部署没有反向代理压缩。`registerCompression` 在 onSend 阶段按
 * content-type + 体积 + Accept-Encoding 决定是否 gzip。
 *
 * 这里覆盖四类边界，它们各自对应一个曾经很容易写错的点：
 *  1. 大 JSON：真的压了，且解压后与原始体完全一致（不能被二次编码搞坏）
 *  2. 小响应：不压（压完更大）
 *  3. SSE：绝不能压（压缩窗口会缓冲事件，实时性没了）
 *  4. 未声明 gzip 的客户端：保持原样
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { gunzipSync } from "node:zlib";
import { registerCompression } from "../src/http-compression.ts";

const BIG = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, title: "站点标题-" + i, description: "描述".repeat(20) })) };

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.get("/big", async () => BIG);
  app.get("/small", async () => ({ ok: true }));
  app.get("/sse", async (_req, reply) => {
    reply.header("content-type", "text/event-stream");
    reply.raw.write("data: hello\n\n");
    reply.raw.end();
    return reply;
  });
  registerCompression(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("http-compression", () => {
  it("大 JSON：gzip 压缩且可无损解压", async () => {
    const res = await app.inject({ method: "GET", url: "/big", headers: { "accept-encoding": "gzip" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(String(res.headers["vary"])).toContain("accept-encoding");
    const decoded = JSON.parse(gunzipSync(res.rawPayload).toString("utf8"));
    expect(decoded).toEqual(BIG);
    // 压缩必须真的带来收益，否则这个特性就没有意义
    expect(res.rawPayload.length).toBeLessThan(JSON.stringify(BIG).length / 2);
  });

  it("小于 1KB 的响应不压缩", async () => {
    const res = await app.inject({ method: "GET", url: "/small", headers: { "accept-encoding": "gzip" } });
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.json()).toEqual({ ok: true });
  });

  it("SSE 不压缩（事件必须即时到达）", async () => {
    const res = await app.inject({ method: "GET", url: "/sse", headers: { "accept-encoding": "gzip" } });
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body).toContain("data: hello");
  });

  it("客户端未声明 gzip 时原样返回", async () => {
    const res = await app.inject({ method: "GET", url: "/big" });
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.json()).toEqual(BIG);
  });

  it("ac-encoding: gzip;q=0 视为拒绝", async () => {
    const res = await app.inject({ method: "GET", url: "/big", headers: { "accept-encoding": "gzip;q=0" } });
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("显式 gzip 优先于通配符（*;q=0, gzip 仍应压缩）", async () => {
    const res = await app.inject({ method: "GET", url: "/big", headers: { "accept-encoding": "*;q=0, gzip" } });
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(gunzipSync(res.rawPayload).toString("utf8"))).toEqual(BIG);
  });

  it("显式拒绝 gzip 优先于通配符（gzip;q=0, * 不应压缩）", async () => {
    const res = await app.inject({ method: "GET", url: "/big", headers: { "accept-encoding": "gzip;q=0, *" } });
    expect(res.headers["content-encoding"]).toBeUndefined();
  });
});
