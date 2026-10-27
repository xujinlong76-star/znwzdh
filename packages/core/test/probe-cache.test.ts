/**
 * 探活缓存的契约测试。
 *
 * 锁四件事：
 *   1. TTL 分档：越不确定的结论越快过期（unverified/server-error 1h < ok 7d）；
 *   2. 条件请求：有 ETag/Last-Modified 才带条件头，304 只续期不换结论；
 *   3. 落盘：写-读往返一致，且是原子替换（临时文件不残留）；
 *   4. 容错：文件损坏/不存在时当空缓存，不抛错（缓存坏了不能影响体检）。
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROBE_CACHE_TTL_MS,
  cacheTtlMs,
  conditionalHeaders,
  isFresh,
  openProbeCache,
  probeCacheKey,
} from "../src/probe-cache.ts";

const dirs: string[] = [];

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "probe-cache-test-"));
  dirs.push(dir);
  return join(dir, "cache.json");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("缓存键规范化", () => {
  it("协议/主机小写、去 hash、去尾斜杠、保留 query", () => {
    expect(probeCacheKey("HTTPS://Example.COM/Path/?b=2#frag")).toBe("https://example.com/Path?b=2");
  });

  it("根路径不把斜杠去掉（https://a.com/ 与 https://a.com 视为同一个键）", () => {
    expect(probeCacheKey("https://a.com/")).toBe(probeCacheKey("https://a.com"));
  });

  it("非法 URL 不抛错，退化成小写字符串", () => {
    expect(probeCacheKey("  Not A URL  ")).toBe("not a url");
  });
});

describe("TTL 分档", () => {
  it("未测准的结论比健康结论过期更快", () => {
    expect(cacheTtlMs("ok")).toBe(PROBE_CACHE_TTL_MS.ok);
    expect(cacheTtlMs("unverified")).toBeLessThan(cacheTtlMs("ok"));
    expect(cacheTtlMs("server-error")).toBeLessThan(cacheTtlMs("ok"));
    expect(cacheTtlMs("dead")).toBeLessThan(cacheTtlMs("ok"));
  });

  it("边界：刚到 TTL 算过期，提前 1 毫秒算新鲜", () => {
    const entry = { url: "https://a.com", kind: "unverified" as const, reason: "x", checkedAt: 1_000 };
    const ttl = cacheTtlMs("unverified");
    expect(isFresh(entry, 1_000 + ttl - 1)).toBe(true);
    expect(isFresh(entry, 1_000 + ttl)).toBe(false);
  });
});

describe("条件请求头", () => {
  it("有 ETag / Last-Modified 才生成条件头", () => {
    expect(
      conditionalHeaders({ url: "x", kind: "ok", reason: "", checkedAt: 0, etag: 'W/"abc"', lastModified: "Tue, 01 Jan 2026 00:00:00 GMT" }),
    ).toEqual({ "If-None-Match": 'W/"abc"', "If-Modified-Since": "Tue, 01 Jan 2026 00:00:00 GMT" });
  });

  it("没有任何校验器时返回空对象（只能走完整 GET）", () => {
    expect(conditionalHeaders({ url: "x", kind: "ok", reason: "", checkedAt: 0 })).toEqual({});
    expect(conditionalHeaders(null)).toEqual({});
  });
});

describe("存取与续期", () => {
  it("记录后能查到，并保留 status 与校验器", async () => {
    const file = await tempFile();
    const cache = await openProbeCache(file, { now: () => 5_000 });
    cache.record("https://A.com/x/", { kind: "ok", status: 200, reason: "内容检测通过" }, { etag: 'W/"1"' });
    const hit = cache.lookup("https://a.com/x");
    expect(hit?.entry.kind).toBe("ok");
    expect(hit?.entry.status).toBe(200);
    expect(hit?.entry.etag).toBe('W/"1"');
    expect(hit?.fresh).toBe(true);
  });

  it("304 续期：结论不变，checkedAt 前移", async () => {
    let now = 1_000;
    const file = await tempFile();
    const cache = await openProbeCache(file, { now: () => now });
    cache.record("https://a.com", { kind: "ok", reason: "ok" });
    const before = cache.lookup("https://a.com")?.entry.checkedAt;
    now = 2_000;
    cache.markRevalidated("https://a.com");
    const after = cache.lookup("https://a.com")?.entry;
    expect(after?.kind).toBe("ok");
    expect(after?.checkedAt).toBe(2_000);
    expect(after?.checkedAt).toBeGreaterThan(before ?? 0);
  });

  it("过期的记录仍然返回，但 fresh=false（调用方据此带条件头重测）", async () => {
    let now = 0;
    const file = await tempFile();
    const cache = await openProbeCache(file, { now: () => now });
    cache.record("https://a.com", { kind: "unverified", reason: "超时" });
    now = cacheTtlMs("unverified") + 1;
    const hit = cache.lookup("https://a.com");
    expect(hit).not.toBeNull();
    expect(hit?.fresh).toBe(false);
  });

  it("超过 maxEntries 时淘汰最久未确认的条目", async () => {
    let now = 1;
    const file = await tempFile();
    const cache = await openProbeCache(file, { now: () => now, maxEntries: 2 });
    cache.record("https://a.com", { kind: "ok", reason: "a" });
    now = 2;
    cache.record("https://b.com", { kind: "ok", reason: "b" });
    now = 3;
    cache.record("https://c.com", { kind: "ok", reason: "c" });
    expect(cache.size).toBe(2);
    expect(cache.lookup("https://a.com")).toBeNull();
    expect(cache.lookup("https://c.com")).not.toBeNull();
  });
});

describe("落盘与容错", () => {
  it("flush 后重新打开仍能读到（往返一致），且不残留临时文件", async () => {
    const file = await tempFile();
    const cache = await openProbeCache(file, { now: () => 42 });
    cache.record("https://a.com", { kind: "dead", status: 404, reason: "HTTP 404：页面不存在或已下线" });
    await cache.flush();

    const reopened = await openProbeCache(file, { now: () => 42 });
    expect(reopened.lookup("https://a.com")?.entry.kind).toBe("dead");
    const names = await readdir(join(file, ".."));
    expect(names.filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("文件损坏时当空缓存，不抛错", async () => {
    const file = await tempFile();
    await writeFile(file, "{ this is not json", "utf8");
    const cache = await openProbeCache(file);
    expect(cache.size).toBe(0);
    expect(cache.lookup("https://a.com")).toBeNull();
  });

  it("版本不匹配的文件同样被忽略（升级后旧格式不至于让体检崩）", async () => {
    const file = await tempFile();
    await writeFile(file, JSON.stringify({ version: 99, entries: { "https://a.com": {} } }), "utf8");
    const cache = await openProbeCache(file);
    expect(cache.size).toBe(0);
  });

  it("clear 会清空内存与磁盘", async () => {
    const file = await tempFile();
    const cache = await openProbeCache(file, { now: () => 7 });
    cache.record("https://a.com", { kind: "ok", reason: "ok" });
    await cache.flush();
    await cache.clear();
    const raw = JSON.parse(await readFile(file, "utf8")) as { entries: Record<string, unknown> };
    expect(Object.keys(raw.entries)).toEqual([]);
  });
});

describe("命中率计数", () => {
  it("区分命中/未命中/304 续期", async () => {
    const file = await tempFile();
    const cache = await openProbeCache(file, { now: () => 1_000 });
    expect(cache.stats()).toEqual({ hits: 0, misses: 0, revalidations: 0 });

    cache.lookup("https://miss.example/"); // 未命中
    cache.record("https://hit.example/", { kind: "ok", reason: "ok" });
    cache.lookup("https://hit.example/"); // 命中
    cache.markRevalidated("https://hit.example/"); // 304

    expect(cache.stats()).toEqual({ hits: 1, misses: 1, revalidations: 1 });
  });

  it("对不存在的键 markRevalidated 不计数（避免虚增）", async () => {
    const file = await tempFile();
    const cache = await openProbeCache(file);
    cache.markRevalidated("https://nope.example/");
    expect(cache.stats().revalidations).toBe(0);
  });
});
