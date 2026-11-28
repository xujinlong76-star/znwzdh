/**
 * /api/weather/search 的行为测试（服务端代理 Open-Meteo geocoding）。
 *
 * 安全面与 /api/weather 相同：前端只传关键词，坐标只由服务端在注册候选时决定；
 * 搜索结果里的经纬度只是展示信息，回传给天气接口的只能是不透明 id。
 *
 * DNS 走注入的假解析器（返回公网 IP）：SSRF 防护的三层校验照跑，
 * 但不依赖测试机的解析结果；系统解析器不再被天气路由调用。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __setWeatherDnsResolverForTest } from '../src/lib/weather-dns';

type FetchCall = { url: string };

const calls: FetchCall[] = [];
let originalFetch: typeof globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubUpstream(handler: (url: string) => Response | Error): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    const out = handler(url);
    if (out instanceof Error) throw out;
    return out;
  }) as typeof globalThis.fetch;
}

const NANJING_GEO = {
  results: [
    {
      id: 1799962,
      name: "南京",
      latitude: 32.0603,
      longitude: 118.7969,
      country: "中国",
      admin1: "江苏",
      timezone: "Asia/Shanghai",
    },
    {
      id: 1799963,
      name: "南京市",
      latitude: 32.0617,
      longitude: 118.7778,
      country: "中国",
      admin1: "江苏",
      timezone: "Asia/Shanghai",
    },
  ],
};

const FORECAST_OK = {
  current: { time: "2026-10-23T20:15", temperature_2m: 18.7, weather_code: 0 },
  hourly: { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [], precipitation: [] },
  daily: {
    time: ["2026-10-23"],
    weather_code: [0],
    temperature_2m_max: [19.2],
    temperature_2m_min: [12.4],
    precipitation_probability_max: [10],
    precipitation_sum: [0],
  },
};

const AIR_OK = { current: { us_aqi: 42 } };

async function getSearch(query: string, headers?: Record<string, string>) {
  const route = await import("../src/app/api/weather/search/route");
  const request = new Request(`http://localhost/api/weather/search${query}`, { headers });
  const res = await route.GET(request);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeEach(() => {
  calls.length = 0;
  originalFetch = globalThis.fetch;
  // 天气路由只认注入的解析器：测试里注入返回公网 IP 的假解析器
  __setWeatherDnsResolverForTest({ lookup: async () => [{ address: "93.184.216.34" }] });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  __setWeatherDnsResolverForTest(null);
});

describe("/api/weather/search：关键词进，候选出", () => {
  it("空关键词直接 400，不打上游", async () => {
    stubUpstream(() => jsonResponse(NANJING_GEO));
    const { status, body } = await getSearch("?q=%20%20");
    expect(status).toBe(400);
    expect(body.reason).toBe("bad_query");
    expect(calls).toHaveLength(0);
  });

  it("中文「南京」返回真实候选，id 是不透明注册 id 且能在天气接口取数", async () => {
    stubUpstream(() => jsonResponse(NANJING_GEO));
    const { status, body } = await getSearch("?q=南京");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    const nanjing = body.results.find((r: any) => r.name === "南京");
    expect(nanjing).toBeDefined();
    expect(nanjing.latitude).toBe(32.0603);
    expect(nanjing.longitude).toBe(118.7969);
    expect(nanjing.timezone).toBe("Asia/Shanghai");
    expect(typeof nanjing.id).toBe("string");
    expect(nanjing.id).toMatch(/^geo-/);
    // 拿这个 id 去天气接口：应取到南京的天气，而不是 400
    stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
    const weather = await import("../src/app/api/weather/route");
    const wres = await weather.GET(new Request(`http://localhost/api/weather?city=${encodeURIComponent(nanjing.id)}`));
    const wbody = (await wres.json()) as Record<string, any>;
    expect(wres.status).toBe(200);
    expect(wbody.cityName).toBe("南京");
  });

  it("拼音 nanjing 同样能搜到南京（上游按 ASCII 名匹配）", async () => {
    stubUpstream(() => jsonResponse(NANJING_GEO));
    const { body } = await getSearch("?q=nanjing");
    expect(body.results.some((r: any) => r.name === "南京")).toBe(true);
  });

  it("内置城市优先：搜「上海」第一条就是内置上海（id 即 key），候选不超 10 条", async () => {
    stubUpstream(() => jsonResponse({ results: [] }));
    const { body } = await getSearch("?q=上海");
    expect(body.results.length).toBeLessThanOrEqual(10);
    expect(body.results[0]).toMatchObject({ id: "shanghai", name: "上海", builtin: true });
  });

  it("拼音也能命中内置城市：shanghai 首条即上海", async () => {
    stubUpstream(() => jsonResponse({ results: [] }));
    const { body } = await getSearch("?q=shanghai");
    expect(body.results[0]).toMatchObject({ id: "shanghai", name: "上海" });
  });

  it("上游挂了但有内置匹配：仍 200 返回内置结果并附注，不编候选", async () => {
    stubUpstream(() => new Response("boom", { status: 503 }));
    const { status, body } = await getSearch("?q=北京");
    expect(status).toBe(200);
    expect(body.results[0]).toMatchObject({ id: "beijing" });
    expect(typeof body.note).toBe("string");
    expect(body.note).toContain("仅显示内置城市");
  });

  it("上游挂了且无内置匹配：502 明示，不返回假候选", async () => {
    stubUpstream(() => new Response("boom", { status: 503 }));
    const { status, body } = await getSearch("?q=武汉");
    expect(status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("upstream_status");
  });

  it("24 小时内重复搜索走缓存，不再打上游", async () => {
    stubUpstream(() => jsonResponse(NANJING_GEO));
    await getSearch("?q=南京市");
    const before = calls.length;
    const again = await getSearch("?q=南京市");
    expect(again.body.cached).toBe(true);
    expect(calls.length).toBe(before);
  });

  it("搜索限流：同一 IP 1 分钟超 20 次返回 429 rate_limited", async () => {
    stubUpstream(() => jsonResponse(NANJING_GEO));
    const headers = { "x-forwarded-for": "203.0.113.77" };
    let limited: Record<string, any> | null = null;
    for (let i = 0; i < 25; i++) {
      const { body } = await getSearch(`?q=南京${i}`, headers);
      if (body.reason === "rate_limited") {
        limited = body;
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect(limited!.ok).toBe(false);
    expect(limited!.message).toContain("过于频繁");
  });

  it("地理编码只打固定域名，不接受调用方控制的域名或坐标", async () => {
    stubUpstream(() => jsonResponse(NANJING_GEO));
    await getSearch("?q=西安");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => new URL(c.url).host === "geocoding-api.open-meteo.com")).toBe(true);
    expect(calls.every((c) => c.url.includes("name="))).toBe(true);
  });
});

// mock 卫生（D2）：清除本文件的模块 mock 缓存，避免驻留同 worker 的后续文件
afterAll(() => {
  vi.resetModules();
});
