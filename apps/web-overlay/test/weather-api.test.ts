/**
 * /api/weather 的行为测试（代取 Open-Meteo）。
 *
 * 天气卡以前是纯静态表，没有可测的取数路径；现在它有了真实的失败面，
 * 所以要把「失败必须说清楚、缺失必须是 null、旧观测必须挂 stale」钉住。
 *
 * DNS 被桩成公网 IP：SSRF 防护的三层校验照跑，但不依赖测试机的解析结果。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34" }]),
}));

type FetchCall = { url: string };

const calls: FetchCall[] = [];
let originalFetch: typeof globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 上游行为：按 URL 关键字分派，返回值可以是 Response、Error 或状态码 */
function stubUpstream(handler: (url: string) => Response | Error): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    const out = handler(url);
    if (out instanceof Error) throw out;
    return out;
  }) as typeof globalThis.fetch;
}

const FORECAST_OK = {
  current: {
    time: "2026-10-23T20:15",
    temperature_2m: 18.7,
    apparent_temperature: 17.4,
    relative_humidity_2m: 63,
    weather_code: 81,
    wind_speed_10m: 11.2,
    wind_direction_10m: 315,
  },
  daily: {
    time: ["2026-10-23", "2026-10-24", "2026-10-25"],
    weather_code: [80, 1, 0],
    temperature_2m_max: [19.2, 21.5, 22.1],
    temperature_2m_min: [12.4, 13.1, 14.8],
  },
};

const AIR_OK = { current: { us_aqi: 42 } };

async function getWeather(query: string, headers?: Record<string, string>) {
  const route = await import("../src/app/api/weather/route");
  const request = new Request(`http://localhost/api/weather${query}`, { headers });
  const res = await route.GET(request);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeEach(() => {
  calls.length = 0;
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("/api/weather：城市表就是唯一的出网面", () => {
  it("表外城市直接拒绝，并且根本不发起上游请求", async () => {
    stubUpstream(() => jsonResponse(FORECAST_OK));
    const { status, body } = await getWeather("?city=nanjing");
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("unknown_city");
    expect(body.message).toContain("nanjing");
    expect(calls).toHaveLength(0);
  });

  it("脏得离谱的 city（原型链键）也进不了坐标表", async () => {
    stubUpstream(() => jsonResponse(FORECAST_OK));
    for (const poison of ["constructor", "__proto__", "toString"]) {
      const { body } = await getWeather(`?city=${poison}`);
      expect(body.reason, poison).toBe("unknown_city");
    }
    expect(calls).toHaveLength(0);
  });

  it("经纬度只来自服务端表：请求 URL 里没有调用方可控的域名或坐标", async () => {
    stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
    const { status, body } = await getWeather("?city=tokyo");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cityKey).toBe("tokyo");
    const forecast = calls.find((c) => c.url.includes("/v1/forecast"))!;
    expect(new URL(forecast.url).host).toBe("api.open-meteo.com");
    expect(forecast.url).toContain("latitude=35.6895");
    expect(forecast.url).toContain("longitude=139.6917");
    expect(forecast.url).toContain("forecast_days=3");
    expect(forecast.url).toContain("timezone=Asia");
    expect(calls.every((c) => /open-meteo\.com/.test(c.url))).toBe(true);
  });

  it("实况与预报按字段解析，观测时间用城市本地时区原文", async () => {
    stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
    const { body } = await getWeather("?city=sf");
    expect(body.current).toMatchObject({
      tempC: 18.7,
      feelsLikeC: 17.4,
      humidity: 63,
      code: 81,
      windSpeedKmh: 11.2,
      windDirectionDeg: 315,
      observedAt: "2026-10-23T20:15",
    });
    expect(body.days.map((d: any) => d.label)).toEqual(["今天", "明天", "后天"]);
    expect(body.days[2]).toMatchObject({ code: 0, highC: 22.1, lowC: 14.8 });
    expect(body.aqi).toBe(42);
    expect(body.aqiNote).toBeNull();
    expect(body.stale).toBe(false);
    expect(body.source).toBe("open-meteo");
  });

  it("上游少字段 / 给脏值时留 null，不换算成 0", async () => {
    stubUpstream((url) =>
      url.includes("air-quality")
        ? jsonResponse({ current: {} })
        : jsonResponse({
            current: { temperature_2m: null, apparent_temperature: "cold", relative_humidity_2m: "63" },
            daily: { time: ["2026-10-23"], weather_code: [null], temperature_2m_max: [] },
          }),
    );
    const { body } = await getWeather("?city=chengdu");
    expect(body.current.tempC).toBeNull();
    expect(body.current.feelsLikeC).toBeNull();
    expect(body.current.humidity).toBe(63);
    expect(body.current.code).toBeNull();
    expect(body.current.windSpeedKmh).toBeNull();
    expect(body.days[0]).toMatchObject({ code: null, highC: null, lowC: null });
    // 字符串 "63" 是上游真的给了数字文本，可以收；"cold" 不是温度，只能是 null
    expect(body.aqi).toBeNull();
    expect(body.aqiNote).toContain("空气指数");
  });

  it("空气指数上游挂了不拖累气温：仍然 200，但 aqi 为 null 并说明原因", async () => {
    stubUpstream((url) => (url.includes("air-quality") ? new Response("boom", { status: 503 }) : jsonResponse(FORECAST_OK)));
    const { status, body } = await getWeather("?city=guangzhou");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.current.tempC).toBe(18.7);
    expect(body.aqi).toBeNull();
    expect(body.aqiNote).toContain("空气指数未取到");
  });

  it("预报为空数组算失败，不能渲染成「今天没有天气」", async () => {
    stubUpstream((url) =>
      url.includes("air-quality")
        ? jsonResponse(AIR_OK)
        : jsonResponse({ current: { temperature_2m: 3 }, daily: { time: [] } }),
    );
    const { status, body } = await getWeather("?city=shenzhen");
    expect(status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("bad_response");
  });

  it("连不上上游 → reason=network，带明确 message", async () => {
    stubUpstream(() => Object.assign(new Error("connect ECONNREFUSED"), { name: "TypeError" }));
    const { status, body } = await getWeather("?city=beijing");
    expect(status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("network");
    expect(body.message).toContain("无法连接气象服务");
  });

  it("非 JSON 响应 → bad_response，而不是空数据冒充成功", async () => {
    stubUpstream(() => jsonResponse("<html>rate limited</html>"));
    const { status, body } = await getWeather("?city=hangzhou");
    expect(status).toBe(502);
    expect(body.reason).toBe("bad_response");
  });

  it("刷新失败但有历史成功结果 → 200 + stale 标记与旧时刻", async () => {
    stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
    const first = await getWeather("?city=shanghai");
    expect(first.body.ok).toBe(true);
    expect(first.body.stale).toBe(false);
    const fetchedAt = first.body.fetchedAt as number;

    stubUpstream(() => new Response("upstream down", { status: 500 }));
    const second = await getWeather("?city=shanghai&fresh=1");
    expect(second.status).toBe(200);
    expect(second.body.ok).toBe(true);
    expect(second.body.stale).toBe(true);
    expect(second.body.staleAt).toBe(fetchedAt);
    expect(second.body.current.tempC).toBe(18.7);
  });

  it("10 分钟内重复请求走缓存，不再打上游", async () => {
    stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
    await getWeather("?city=beijing");
    const before = calls.length;
    const again = await getWeather("?city=beijing");
    expect(again.body.cached).toBe(true);
    expect(calls.length).toBe(before);
  });

  it("刷新过频被限流：429 + rate_limited，而不是把上游打穿", async () => {
    stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
    const headers = { "x-forwarded-for": "203.0.113.9" };
    let limited: Record<string, any> | null = null;
    // 每城市仍会走缓存，所以逐个换城市，确保请求真的进到限流分支
    const cities = ["beijing", "shanghai", "guangzhou", "shenzhen", "hangzhou", "chengdu", "tokyo", "sf"];
    for (let i = 0; i < 70; i++) {
      const { body } = await getWeather(`?city=${cities[i % cities.length]}&fresh=1`, headers);
      if (body.reason === "rate_limited") {
        limited = body;
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect(limited!.ok).toBe(false);
    expect(limited!.message).toContain("过于频繁");
  });
});

// mock 卫生（D2）：清除本文件的模块 mock 缓存，避免驻留同 worker 的后续文件
afterAll(() => {
  vi.resetModules();
});
