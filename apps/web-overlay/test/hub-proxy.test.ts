/**
 * /api/hub/* 反向代理的 HTTP 语义判定。
 *
 * 这几条判定都直接对应"用户能感知的错误"，且此前都踩过或迟早会踩：
 *   1. 超时上限 —— 卡死的中枢会把前端请求无限期挂住（SSE 必须豁免）；
 *   2. 缓存头透传 —— 中枢发了 cache-control/etag，代理只透传 content-type，
 *      于是浏览器既拿不到 ETag 做条件请求，也看不到 no-store，只能启发式缓存 JSON；
 *   3. 空体状态码 —— 304/204/205 带 body 构造 Response 会直接抛 TypeError；
 *   4. 二进制响应 —— 走 .text() 会按 UTF-8 解码把内容解码坏。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RESPONSE_CACHE_CONTROL,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  FORWARD_REQUEST_HEADERS,
  createDeadline,
  isNullBodyStatus,
  isStreamingContentType,
  isTextContentType,
  pickResponseHeaders,
  upstreamTimeoutMs,
} from "../src/lib/hub-proxy";

afterEach(() => {
  vi.useRealTimers();
});

describe("upstreamTimeoutMs", () => {
  it("falls back to the default for missing or nonsense values", () => {
    for (const raw of [undefined, "", "abc", "0", "-5", "NaN", "Infinity"]) {
      expect(upstreamTimeoutMs(raw), String(raw)).toBe(DEFAULT_UPSTREAM_TIMEOUT_MS);
    }
  });

  it("honours an explicit positive override", () => {
    expect(upstreamTimeoutMs("1500")).toBe(1500);
  });
});

describe("createDeadline", () => {
  it("aborts once the deadline passes", () => {
    vi.useFakeTimers();
    const deadline = createDeadline(1000);

    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(deadline.signal.aborted).toBe(true);
    deadline.clear();
  });

  it("never aborts after clear (this is what keeps SSE streams alive)", () => {
    vi.useFakeTimers();
    const deadline = createDeadline(1000);

    deadline.clear();
    vi.advanceTimersByTime(60_000);
    expect(deadline.signal.aborted).toBe(false);
  });
});

describe("isStreamingContentType", () => {
  it("detects SSE even with a charset suffix", () => {
    expect(isStreamingContentType("text/event-stream")).toBe(true);
    expect(isStreamingContentType("text/event-stream; charset=utf-8")).toBe(true);
  });

  it("does not treat plain JSON as streamable", () => {
    expect(isStreamingContentType("application/json")).toBe(false);
    expect(isStreamingContentType(null)).toBe(false);
    expect(isStreamingContentType(undefined)).toBe(false);
  });
});

describe("isTextContentType", () => {
  it("treats JSON/text/xml/script payloads as text", () => {
    for (const ct of [
      "application/json",
      "application/json; charset=utf-8",
      "text/plain",
      "text/html; charset=utf-8",
      "application/xml",
      "application/javascript",
      "application/x-www-form-urlencoded",
    ]) {
      expect(isTextContentType(ct), ct).toBe(true);
    }
  });

  it("treats images, fonts and octet streams as binary", () => {
    for (const ct of ["image/png", "font/woff2", "application/octet-stream", "application/zip"]) {
      expect(isTextContentType(ct), ct).toBe(false);
    }
    expect(isTextContentType(undefined)).toBe(false);
  });
});

describe("isNullBodyStatus", () => {
  it("flags the statuses that must not carry a body", () => {
    expect(isNullBodyStatus(304)).toBe(true);
    expect(isNullBodyStatus(204)).toBe(true);
    expect(isNullBodyStatus(205)).toBe(true);
  });

  it("keeps normal statuses body-bearing", () => {
    for (const status of [200, 201, 400, 404, 500, 502, 504]) {
      expect(isNullBodyStatus(status), String(status)).toBe(false);
    }
  });
});

describe("pickResponseHeaders", () => {
  it("forwards the cache semantics the hub declares", () => {
    const upstream = new Headers({
      "content-type": "application/json",
      "cache-control": "private, max-age=60",
      etag: 'W/"abc"',
      vary: "Accept-Encoding",
    });

    expect(pickResponseHeaders(upstream)).toEqual({
      "content-type": "application/json",
      "cache-control": "private, max-age=60",
      etag: 'W/"abc"',
      vary: "Accept-Encoding",
    });
  });

  it("defaults to no-store when the hub sends no cache policy", () => {
    const headers = pickResponseHeaders(new Headers({ "content-type": "application/json" }));
    expect(headers["cache-control"]).toBe(DEFAULT_RESPONSE_CACHE_CONTROL);
  });

  it("never leaks non-allowlisted upstream headers (e.g. cookies)", () => {
    const upstream = new Headers({
      "content-type": "application/json",
      "set-cookie": "session=secret",
      "x-internal-debug": "1",
    });

    const headers = pickResponseHeaders(upstream);
    expect(Object.keys(headers).sort()).toEqual(["cache-control", "content-type"]);
    expect(headers["set-cookie"]).toBeUndefined();
  });

  it("forwards If-None-Match so the hub can answer 304", () => {
    expect(FORWARD_REQUEST_HEADERS).toContain("if-none-match");
  });
});
