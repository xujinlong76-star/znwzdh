/**
 * /api/weather 的行为测试（代取 Open-Meteo）。
 *
 * 天气卡以前是纯静态表，没有可测的取数路径；现在它有了真实的失败面，
 * 所以要把「失败必须说清楚、缺失必须是 null、旧观测必须挂 stale」钉住。
 *
 * DNS 被桩成公网 IP：SSRF 防护的三层校验照跑，但不依赖测试机的解析结果。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aqiAdvice } from '../src/lib/modular/weather';

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

const HOURLY_TIMES = Array.from({ length: 48 }, (_, i) => {
  const day = i < 24 ? '2026-10-23' : '2026-10-24'
  const hour = String(i % 24).padStart(2, '0')
  return `${day}T${hour}:00`
})

const FORECAST_OK = {
  current: {
    time: "2026-10-23T20:15",
    temperature_2m: 18.7,
    apparent_temperature: 17.4,
    relative_humidity_2m: 63,
    weather_code: 81,
    wind_speed_10m: 11.2,
    wind_direction_10m: 315,
    precipitation: 0.4,
  },
  hourly: {
    time: HOURLY_TIMES,
    temperature_2m: HOURLY_TIMES.map((_, i) => 10 + (i % 9)),
    weather_code: HOURLY_TIMES.map((_, i) => (i % 5 === 0 ? 61 : 0)),
    precipitation_probability: HOURLY_TIMES.map((_, i) => (i % 4) * 10),
    precipitation: HOURLY_TIMES.map((_, i) => (i % 6 === 0 ? 0.2 : 0)),
    wind_speed_10m: HOURLY_TIMES.map((_, i) => 5 + (i % 7)),
    relative_humidity_2m: HOURLY_TIMES.map((_, i) => 40 + (i % 30)),
  },
  daily: {
    time: ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"],
    weather_code: [80, 1, 0, 61, 3, 2, 0],
    temperature_2m_max: [19.2, 21.5, 22.1, 18.0, 20.3, 23.4, 24.0],
    temperature_2m_min: [12.4, 13.1, 14.8, 11.0, 12.2, 15.1, 16.0],
    precipitation_probability_max: [70, 10, 0, 80, 20, 5, 0],
    precipitation_sum: [2.4, 0, 0, 5.1, 0.3, 0, 0],
    sunrise: ["2026-10-23T05:58", "2026-10-24T05:59", "2026-10-25T06:00", "2026-10-26T06:01", "2026-10-27T06:02", "2026-10-28T06:03", "2026-10-29T06:04"],
    sunset: ["2026-10-23T17:42", "2026-10-24T17:41", "2026-10-25T17:40", "2026-10-26T17:39", "2026-10-27T17:38", "2026-10-28T17:37", "2026-10-29T17:36"],
    uv_index_max: [5.2, 6.8, 3.1, 2.0, 8.4, 11.5, 0.5],
  },
};

const AIR_OK = {
  current: { us_aqi: 42, pm2_5: 12.5, pm10: 24, ozone: 80, nitrogen_dioxide: 15, sulphur_dioxide: 5, carbon_monoxide: 300 },
};

async function getWeather(query: string, headers?: Record<string, string>) {
  const route = await import("../src/app/api/weather/route");
  const request = new Request(`http://localhost/api/weather${query}`, { headers });
  const res = await route.GET(request);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeEach(() => {
  calls.length = 0;
  originalFetch = globalThis.fetch;
  // qweatherConfigured 的断言必须与环境无关：测试里 key 一律视为未配
  delete process.env.QWEATHER_API_HOST;
  delete process.env.QWEATHER_API_KEY;
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
    expect(forecast.url).toContain("forecast_days=7");
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
    expect(body.days.map((d: any) => d.label)).toEqual(["今天", "明天", "后天", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
    expect(body.days[2]).toMatchObject({ code: 0, highC: 22.1, lowC: 14.8 });
    expect(body.days[0]).toMatchObject({ precipProbMax: 70, precipSumMm: 2.4 });
    expect(body.days[3]).toMatchObject({ precipProbMax: 80, precipSumMm: 5.1 });
    expect(body.days[0]).toMatchObject({ sunrise: "2026-10-23T05:58", sunset: "2026-10-23T17:42", uvIndexMax: 5.2 });
    expect(body.days[4]).toMatchObject({ sunrise: "2026-10-27T06:02", sunset: "2026-10-27T17:38", uvIndexMax: 8.4 });
    expect(body.days[5]).toMatchObject({ uvIndexMax: 11.5 });
    const forecastUrl = calls.find((c) => c.url.includes("/v1/forecast"))!.url;
    expect(forecastUrl).toContain("sunrise");
    expect(forecastUrl).toContain("sunset");
    expect(forecastUrl).toContain("uv_index_max");
    expect(forecastUrl).toContain("wind_speed_10m");
    expect(forecastUrl).toContain("relative_humidity_2m");
    expect(body.current.precipMm).toBe(0.4);
    expect(body.aqi).toBe(42);
    expect(body.aqiNote).toBeNull();
    expect(body.aqiPollutants).toMatchObject({ pm25: 12.5, pm10: 24, o3: 80, no2: 15, so2: 5, co: 300 });
    expect(body.stale).toBe(false);
    expect(body.source).toBe("open-meteo");
    expect(body.qweatherConfigured).toBe(false);
  });

  it("逐小时从观测小时起取 24 格（不含已过去的半夜），降水概率与降水量随格返回", async () => {
    stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
    const { body } = await getWeather("?city=shanghai");
    expect(body.hourly).toHaveLength(24);
    expect(body.hourly[0]).toMatchObject({ time: "2026-10-23T20:00", tempC: 12, code: 61, precipProb: 0, precipMm: 0, windSpeedKmh: 11, humidity: 60 });
    expect(body.hourly[4]).toMatchObject({ time: "2026-10-24T00:00", windSpeedKmh: 8, humidity: 64 });
    expect(body.hourly[4]).toMatchObject({ time: "2026-10-24T00:00", tempC: 16, code: 0 });
    expect(body.hourly[23]).toMatchObject({ time: "2026-10-24T19:00" });
    expect(body.hourly.every((h: any) => typeof h.tempC === "number")).toBe(true);
  });

  it("days 参数可指定天数，hourly=0 不返回逐小时", async () => {
    stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
    const three = await getWeather("?city=beijing&days=3");
    expect(three.body.days).toHaveLength(3);
    const noHourly = await getWeather("?city=beijing&hourly=0");
    expect(noHourly.body.hourly).toEqual([]);
    expect(noHourly.body.days).toHaveLength(7);
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

  it("新字段缺失 / 给脏值时留 null，不编一个日出或风速", async () => {
    stubUpstream((url) =>
      url.includes("air-quality")
        ? jsonResponse({ current: {} })
        : jsonResponse({
            current: { temperature_2m: 18 },
            hourly: {
              time: ["2026-10-23T20:00"],
              temperature_2m: [12],
              wind_speed_10m: ["fast"],
              relative_humidity_2m: ["63"],
            },
            daily: {
              time: ["2026-10-23"],
              weather_code: [0],
              temperature_2m_max: [19],
              temperature_2m_min: [12],
              sunrise: [123],
              sunset: [null],
              uv_index_max: ["high"],
            },
          }),
    );
    const { body } = await getWeather("?city=chengdu&fresh=1");
    expect(body.days[0]).toMatchObject({ sunrise: null, sunset: null, uvIndexMax: null });
    expect(body.hourly[0]).toMatchObject({ windSpeedKmh: null, humidity: 63 });
  });

  it("新字段整段缺失时也留 null（上游没给数组）", async () => {
    stubUpstream((url) =>
      url.includes("air-quality")
        ? jsonResponse({ current: {} })
        : jsonResponse({
            current: { temperature_2m: 18 },
            hourly: { time: ["2026-10-23T20:00"], temperature_2m: [12] },
            daily: { time: ["2026-10-23"], weather_code: [0], temperature_2m_max: [19], temperature_2m_min: [12] },
          }),
    );
    const { body } = await getWeather("?city=chengdu&fresh=1");
    expect(body.days[0]).toMatchObject({ sunrise: null, sunset: null, uvIndexMax: null });
    expect(body.hourly[0]).toMatchObject({ windSpeedKmh: null, humidity: null });
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

  it("缓存键区分 days：days=3 与 days=5 各取一次上游，同键才命中", async () => {
    stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
    await getWeather("?city=tokyo&days=3");
    const before = calls.length;
    await getWeather("?city=tokyo&days=5");
    expect(calls.length).toBe(before + 2);
    const again = await getWeather("?city=tokyo&days=5");
    expect(again.body.cached).toBe(true);
    expect(calls.length).toBe(before + 2);
  });

  it("搜索注册的不透明 id 可取天气，未注册的 id 直接拒绝且不打上游", async () => {
    const { registerSearchedCity } = await import("../src/lib/modular/weather");
    registerSearchedCity("geo-test-nanjing", {
      key: "geo:32.0603,118.7969",
      name: "南京",
      region: "江苏",
      latitude: 32.0603,
      longitude: 118.7969,
      timezone: "Asia/Shanghai",
    });
    stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
    const { status, body } = await getWeather("?city=geo-test-nanjing");
    expect(status).toBe(200);
    expect(body.cityName).toBe("南京");
    expect(body.cityKey).toBe("geo-test-nanjing");
    const forecast = calls.find((c) => c.url.includes("/v1/forecast"))!;
    expect(forecast.url).toContain("latitude=32.0603");
    expect(forecast.url).toContain("longitude=118.7969");
    calls.length = 0;
    const bad = await getWeather("?city=geo-no-such-id");
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe("unknown_city");
    expect(calls).toHaveLength(0);
  });

  it("stale 窗口 2 小时：1 小时内旧观测可回退，超 2 小时改 502 明示", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-27T12:00:00Z"));
      stubUpstream((url) => (url.includes("air-quality") ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)));
      const first = await getWeather("?city=shanghai&days=5");
      expect(first.body.ok).toBe(true);
      const fetchedAt = first.body.fetchedAt as number;

      vi.setSystemTime(new Date("2026-11-27T13:00:00Z"));
      stubUpstream(() => new Response("upstream down", { status: 500 }));
      const within = await getWeather("?city=shanghai&days=5&fresh=1");
      expect(within.status).toBe(200);
      expect(within.body.stale).toBe(true);
      expect(within.body.staleAt).toBe(fetchedAt);

      vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
      const expired = await getWeather("?city=shanghai&days=5&fresh=1");
      expect(expired.status).toBe(502);
      expect(expired.body.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("紫外线分档按 WHO 口径：0–2 低 / 3–5 中等 / 6–7 高 / 8–10 很高 / 11+ 极高", async () => {
    const { uvLevel } = await import("../src/lib/modular/weather");
    expect(uvLevel(null)).toBeNull();
    expect(uvLevel(undefined)).toBeNull();
    expect(uvLevel(0)?.label).toBe("低");
    expect(uvLevel(2.9)?.label).toBe("低");
    expect(uvLevel(3)?.label).toBe("中等");
    expect(uvLevel(5.9)?.label).toBe("中等");
    expect(uvLevel(6)?.label).toBe("高");
    expect(uvLevel(7.9)?.label).toBe("高");
    expect(uvLevel(8)?.label).toBe("很高");
    expect(uvLevel(10.9)?.label).toBe("很高");
    expect(uvLevel(11)?.label).toBe("极高");
    expect(uvLevel(13)?.label).toBe("极高");
  });
});

describe('aqiAdvice：按 aqiLevel 五档给一句话健康建议（P1-6）', () => {
  it('五档各一例', () => {
    expect(aqiAdvice(20)).toBe('空气清新，适合开窗与户外运动')
    expect(aqiAdvice(80)).toBe('空气良好，可正常户外活动')
    expect(aqiAdvice(120)).toBe('敏感人群减少长时间户外活动')
    expect(aqiAdvice(180)).toBe('减少户外活动，外出建议佩戴口罩')
    expect(aqiAdvice(250)).toBe('尽量减少外出，外出请佩戴口罩')
  })

  it('边界值 50/100/150/200 归入低一档', () => {
    expect(aqiAdvice(50)).toBe('空气清新，适合开窗与户外运动')
    expect(aqiAdvice(100)).toBe('空气良好，可正常户外活动')
    expect(aqiAdvice(150)).toBe('敏感人群减少长时间户外活动')
    expect(aqiAdvice(200)).toBe('减少户外活动，外出建议佩戴口罩')
  })

  it('AQI 为 null 时不给建议', () => {
    expect(aqiAdvice(null)).toBeNull()
  })
})

// mock 卫生（D2）：清除本文件的模块 mock 缓存，避免驻留同 worker 的后续文件
afterAll(() => {
  vi.resetModules();
});
