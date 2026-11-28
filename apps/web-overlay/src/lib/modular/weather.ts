/**
 * 天气小卡的纯函数层（城市表 + 取值口径）。
 *
 * 为什么城市表写死在这里：/api/weather 是服务端出网代理，如果让前端传经纬度或
 * 域名，它就成了一个可被任意打的开放代理。只接受 key → 固定经纬度，注入面归零。
 *
 * 取值口径：上游缺字段一律留 null，由展示层渲染成「—」；绝不用 0 或上一次的值冒充
 * 读数（0°C 是真实温度，不是「没有数据」）。
 */

export type WeatherIconKind = 'sun' | 'cloud' | 'rain' | 'snow' | 'fog' | 'storm'

export interface WeatherCity {
  key: string
  name: string
  region: string
  latitude: number
  longitude: number
  /** 观测时间按城市本地时区给，避免展示一个不知道属于谁的 HH:mm */
  timezone: string
}

/** 键必须与 registry / core 目录里 weather-clock 的 city 选项一致 */
export const WEATHER_CITIES: Record<string, WeatherCity> = {
  beijing: { key: 'beijing', name: '北京', region: '直辖市', latitude: 39.9042, longitude: 116.4074, timezone: 'Asia/Shanghai' },
  shanghai: { key: 'shanghai', name: '上海', region: '直辖市', latitude: 31.2304, longitude: 121.4737, timezone: 'Asia/Shanghai' },
  guangzhou: { key: 'guangzhou', name: '广州', region: '广东', latitude: 23.1291, longitude: 113.2644, timezone: 'Asia/Shanghai' },
  shenzhen: { key: 'shenzhen', name: '深圳', region: '广东', latitude: 22.5431, longitude: 114.0579, timezone: 'Asia/Shanghai' },
  hangzhou: { key: 'hangzhou', name: '杭州', region: '浙江', latitude: 30.2741, longitude: 120.1551, timezone: 'Asia/Shanghai' },
  chengdu: { key: 'chengdu', name: '成都', region: '四川', latitude: 30.5728, longitude: 104.0668, timezone: 'Asia/Shanghai' },
  tokyo: { key: 'tokyo', name: '东京', region: '关东', latitude: 35.6895, longitude: 139.6917, timezone: 'Asia/Tokyo' },
  sf: { key: 'sf', name: '旧金山', region: '加州', latitude: 37.7749, longitude: -122.4194, timezone: 'America/Los_Angeles' },
}

export const DEFAULT_CITY_KEY = 'shanghai'

/** 只认自有属性：`constructor` / `toString` 这类原型链上的键必须当成不存在的城市 */
function cityByKey(raw: string): WeatherCity | undefined {
  return Object.prototype.hasOwnProperty.call(WEATHER_CITIES, raw) ? WEATHER_CITIES[raw] : undefined
}

/** 配置里的城市标识只认表内 key：脏值要能被展示层发现，而不是静默换个城市 */
export function resolveCityKey(raw: unknown): { key: string; requested: string; unknown: boolean } {
  const requested = typeof raw === 'string' ? raw.trim() : ''
  // 大小写宽容不改变「这是不是表内城市」这件事：key 全是小写，命中即合法；
  // 表外值（nanjing / 任意字符串）仍然报 unknown，让卡片把话说出来。
  const hit = cityByKey(requested) ?? cityByKey(requested.toLowerCase())
  if (hit) return { key: hit.key, requested: hit.key, unknown: false }
  return { key: DEFAULT_CITY_KEY, requested, unknown: requested !== '' }
}

export type WeatherUnit = 'celsius' | 'fahrenheit'

export function normalizeUnit(raw: unknown): WeatherUnit {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return v === 'fahrenheit' || v === 'f' ? 'fahrenheit' : 'celsius'
}

/** WMO 4678 天气代码 → 中文描述。表外的码说「未知」，不猜成「多云」。 */
export function describeWeatherCode(code: number | null | undefined): { label: string; kind: WeatherIconKind } {
  if (code === null || code === undefined || !Number.isFinite(code)) {
    return { label: '天气状况未知', kind: 'cloud' }
  }
  const c = Math.floor(code)
  if (c === 0) return { label: '晴', kind: 'sun' }
  if (c === 1) return { label: '基本晴朗', kind: 'sun' }
  if (c === 2) return { label: '局部多云', kind: 'cloud' }
  if (c === 3) return { label: '阴天', kind: 'cloud' }
  if (c === 45 || c === 48) return { label: '雾', kind: 'fog' }
  if (c >= 51 && c <= 53) return { label: '毛毛雨', kind: 'rain' }
  if (c >= 55 && c <= 57) return { label: '冻毛毛雨', kind: 'rain' }
  if (c >= 61 && c <= 63) return { label: c === 61 ? '小雨' : c === 62 ? '中雨' : '大雨', kind: 'rain' }
  if (c === 65) return { label: '暴雨', kind: 'rain' }
  if (c >= 66 && c <= 67) return { label: '冻雨', kind: 'rain' }
  if (c >= 71 && c <= 73) return { label: c === 71 ? '小雪' : c === 72 ? '中雪' : '大雪', kind: 'snow' }
  if (c === 75 || c === 77) return { label: '雪粒/雪霰', kind: 'snow' }
  if (c >= 80 && c <= 82) return { label: '阵雨', kind: 'rain' }
  if (c >= 85 && c <= 86) return { label: '阵雪', kind: 'snow' }
  if (c === 95) return { label: '雷阵雨', kind: 'storm' }
  if (c === 96 || c === 99) return { label: '雷阵雨伴冰雹', kind: 'storm' }
  return { label: `未知天气码 ${c}`, kind: 'cloud' }
}

const WIND_DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']

/** 风向 + 风速（km/h）；任一缺失就返回 null，由卡片显示「—」而不是编一个「微风」 */
export function windLabel(deg: number | null, kmh: number | null): string | null {
  if (kmh === null || !Number.isFinite(kmh)) return null
  const speed = `${Math.round(kmh)} km/h`
  if (deg === null || !Number.isFinite(deg)) return `风力 ${speed}`
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  return `${WIND_DIRS[idx] ?? '未知'}风 ${speed}`
}

/** 缺失一律「—」；曾经这里用 `?? 0` 把「没数据」渲染成「0°C」 */
export function formatTemp(celsius: number | null, unit: WeatherUnit): string {
  if (celsius === null || !Number.isFinite(celsius)) return '—'
  const v = unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius
  return `${Math.round(v)}${unit === 'fahrenheit' ? '°F' : '°C'}`
}

/** 紫外线指数分档（WHO 口径）：0–2 低 / 3–5 中等 / 6–7 高 / 8–10 很高 / 11+ 极高；未知就说未知 */
export function uvLevel(uv: number | null | undefined): { label: string } | null {
  if (uv === null || uv === undefined || !Number.isFinite(uv)) return null
  if (uv < 3) return { label: '低' }
  if (uv < 6) return { label: '中等' }
  if (uv < 8) return { label: '高' }
  if (uv < 11) return { label: '很高' }
  return { label: '极高' }
}

/** US AQI 分档（与 EPA 口径一致）；未知就说未知 */
export function aqiLevel(aqi: number | null): { label: string; tone: 'good' | 'moderate' | 'poor' } | null {
  if (aqi === null || !Number.isFinite(aqi)) return null
  if (aqi <= 50) return { label: '优', tone: 'good' }
  if (aqi <= 100) return { label: '良', tone: 'moderate' }
  if (aqi <= 150) return { label: '轻度污染', tone: 'poor' }
  if (aqi <= 200) return { label: '中度污染', tone: 'poor' }
  return { label: '重度污染', tone: 'poor' }
}

/** AQI 健康建议：一句话，按 aqiLevel 五档；只基于分档，不引入新数据、不承诺医疗效果 */
export function aqiAdvice(aqi: number | null): string | null {
  const level = aqiLevel(aqi)
  if (!level) return null
  switch (level.label) {
    case '优':
      return '空气清新，适合开窗与户外运动'
    case '良':
      return '空气良好，可正常户外活动'
    case '轻度污染':
      return '敏感人群减少长时间户外活动'
    case '中度污染':
      return '减少户外活动，外出建议佩戴口罩'
    case '重度污染':
      return '尽量减少外出，外出请佩戴口罩'
    default:
      return null
  }
}

export interface WeatherCurrent {
  tempC: number | null
  feelsLikeC: number | null
  humidity: number | null
  code: number | null
  windSpeedKmh: number | null
  windDirectionDeg: number | null
  /** 当日目前为止的降水量（mm），上游 current.precipitation；缺失为 null */
  precipMm: number | null
  /** 城市本地时区的观测时间，形如 2026-10-23T20:15 */
  observedAt: string | null
}

export interface WeatherDay {
  /** 上游给的 YYYY-MM-DD（城市本地日期） */
  date: string
  /** 今天/明天/后天，再往后直接写月-日 */
  label: string
  code: number | null
  highC: number | null
  lowC: number | null
  /** 当日降水概率最大值（%），上游 daily.precipitation_probability_max */
  precipProbMax: number | null
  /** 当日降水量合计（mm），上游 daily.precipitation_sum */
  precipSumMm: number | null
  /** 日出时刻（城市本地 ISO，形如 2026-10-23T05:58），上游 daily.sunrise；缺失为 null */
  sunrise: string | null
  /** 日落时刻（城市本地 ISO），上游 daily.sunset；缺失为 null */
  sunset: string | null
  /** 当日紫外线指数最大值，上游 daily.uv_index_max；缺失为 null */
  uvIndexMax: number | null
}

/** 逐小时预报一格：全部来自上游 hourly，缺失为 null、不补数 */
export interface WeatherHour {
  /** 城市本地时间，形如 2026-10-23T20:00 */
  time: string
  tempC: number | null
  code: number | null
  /** 该小时降水概率（%） */
  precipProb: number | null
  /** 该小时降水量（mm） */
  precipMm: number | null
  /** 该小时风速（km/h），上游 hourly.wind_speed_10m；缺失为 null */
  windSpeedKmh: number | null
  /** 该小时相对湿度（%），上游 hourly.relative_humidity_2m；缺失为 null */
  humidity: number | null
}

/** 空气质量污染物分项：全部来自 air-quality 上游 current，缺失为 null */
export interface AqiPollutants {
  pm25: number | null
  pm10: number | null
  o3: number | null
  no2: number | null
  so2: number | null
  co: number | null
}

/**
 * 预报页签文案。用数组下标而不是「和今天比差几天」：
 * 上游 daily.time 从城市本地的今天开始排，浏览器时区不同也不会算错。
 */
export function dayLabel(date: string, index: number): string {
  const byIndex = ['今天', '明天', '后天'][index]
  if (byIndex) return byIndex
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '')
  return m ? `${m[1]}-${m[2]}-${m[3]}` : `第 ${index + 1} 天`
}

/** 固定 host + 表内经纬度：这是 /api/weather 唯一的出网形态 */
export function forecastUrlPath(city: WeatherCity, days: number): string {
  const p = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation',
    hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,relative_humidity_2m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max',
    timezone: city.timezone,
    forecast_days: String(days),
  })
  return `/v1/forecast?${p.toString()}`
}

export function airQualityUrlPath(city: WeatherCity): string {
  const p = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide',
    timezone: city.timezone,
  })
  return `/v1/air-quality?${p.toString()}`
}

export interface WeatherPayload {
  cityKey: string
  /** 展示用城市名/地区：内置城市取表，搜索城市取 geocoding 候选原文 */
  cityName: string
  cityRegion: string
  current: WeatherCurrent
  days: WeatherDay[]
  /** 未来 24 小时逐小时（从观测时刻起取 24 格，不足时有几格给几格） */
  hourly: WeatherHour[]
  /** 空气指数来自另一个上游，取不到时为 null + aqiNote 说明原因 */
  aqi: number | null
  aqiNote: string | null
  /** 污染物分项与 AQI 同源；上游失败时为 null（与 aqiNote 同理） */
  aqiPollutants: AqiPollutants | null
  source: 'open-meteo'
  /** 服务端成功取数的时刻（ms），用于「几分钟前」 */
  fetchedAt: number
  /** true = 本次上游失败，展示的是缓存里的历史观测 */
  stale: boolean
  staleAt: number | null
  /** 备源和风天气是否已配置（只读服务端 env 判断，key 永不外泄）；未配置时页面明示 */
  qweatherConfigured: boolean
}

/** 「刚刚 / N 分钟前 / N 小时前 / M月D日」；给陈旧数据留可读的年龄 */
export function ageLabel(at: number, now: number = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return '时间未知'
  const diff = Math.max(0, now - at)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '时间未知' : `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 观测时间只到分钟：展示 `2026-10-23T20:15` → `10-23 20:15` */
export function observedAtLabel(observedAt: string | null): string {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(observedAt ?? '')
  if (!m) return '观测时间未知'
  return `${m[1]}-${m[2]} ${m[3]}:${m[4]}`
}

/** 逐小时格的时间只到小时：展示 `2026-10-23T20:00` → `20:00` */
export function hourLabel(time: string | null | undefined): string {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(time ?? '')
  if (!m) return '—'
  return `${m[1]}:${m[2]}`
}

/* ------------------------------------------------------------------ */
/* 搜索城市：服务端短期映射（不透明 id → 城市）                        */
/* ------------------------------------------------------------------ */

/**
 * 为什么是「服务端映射 + 不透明 id」，而不是让前端传经纬度：
 * /api/weather 若接受前端自传经纬度，就成了可被任意打的免费 Open-Meteo 代理。
 * 搜索接口在服务端把 geocoding 候选注册进这张短期映射，前端回传的只是
 * 一个猜不出来的 id；坐标始终由服务端在 search 时决定。id 24 小时过期，
 * 过期后 /weather 页用存下的城市名重新搜索一次即可拿到新 id。
 *
 * 注意：这张表只活在单个服务端进程内存里（与天气缓存同理）；多实例部署下
 * 搜索与天气请求若落到不同实例，id 会查不到、前端按 unknown_city 重新搜索。
 */
export const SEARCHED_CITY_TTL_MS = 24 * 60 * 60_000
const SEARCHED_CITY_MAX = 200

interface SearchedCityEntry {
  city: WeatherCity
  expiresAt: number
}

const searchedCities = new Map<string, SearchedCityEntry>()

export function registerSearchedCity(id: string, city: WeatherCity): void {
  const now = Date.now()
  if (searchedCities.size >= SEARCHED_CITY_MAX) {
    for (const [k, v] of searchedCities) {
      if (v.expiresAt <= now) searchedCities.delete(k)
    }
    if (searchedCities.size >= SEARCHED_CITY_MAX) {
      const oldest = searchedCities.keys().next().value
      if (oldest !== undefined) searchedCities.delete(oldest)
    }
  }
  searchedCities.set(id, { city, expiresAt: now + SEARCHED_CITY_TTL_MS })
}

export function lookupSearchedCity(id: string): WeatherCity | undefined {
  const entry = searchedCities.get(id)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    searchedCities.delete(id)
    return undefined
  }
  return entry.city
}

/** 内置 8 城的拼音（搜索时中文名之外的第二匹配面；旧金山另有常用译名） */
export const WEATHER_CITY_PINYIN: Record<string, string[]> = {
  beijing: ['beijing'],
  shanghai: ['shanghai'],
  guangzhou: ['guangzhou'],
  shenzhen: ['shenzhen'],
  hangzhou: ['hangzhou'],
  chengdu: ['chengdu'],
  tokyo: ['dongjing', 'tokyo'],
  sf: ['jiujinshan', 'sanfrancisco', 'san francisco'],
}

/* ------------------------------------------------------------------ */
/* 天气城市偏好：用户在 /weather 选定的城市                            */
/* ------------------------------------------------------------------ */

/**
 * 偏好存的是「城市描述」（id + 名 + 坐标），而不是只有 id：
 * 搜索 id 24 小时过期后，页面能用名 + 坐标重新搜索、匹配到同一城市再取新 id，
 * 刷新后仍是上次的城市。坐标只用来在重新搜索时匹配候选，绝不直接发给 /api/weather。
 *
 * 登录用户另有一份云端副本：见 lib/user-settings.ts 的 weatherCity 字段，
 * 经 PATCH /api/me/settings 同步（服务端见 apps/api/src/routes/me.ts 与
 * packages/store/src/repository/settings.ts）；未登录只写本机这一份。
 */
export interface WeatherCityPreference {
  /** /api/weather 的 city 参数：内置 key，或搜索注册的不透明 id */
  id: string
  name: string
  region: string
  country: string
  timezone: string
  latitude: number
  longitude: number
}

export const WEATHER_CITY_STORAGE_KEY = 'navhub_weather_city_v1'

export function normalizeWeatherCityPreference(raw: unknown): WeatherCityPreference | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  const timezone = typeof r.timezone === 'string' ? r.timezone.trim() : ''
  const latitude = typeof r.latitude === 'number' ? r.latitude : Number.NaN
  const longitude = typeof r.longitude === 'number' ? r.longitude : Number.NaN
  if (!id || !name || !timezone) return null
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return {
    id,
    name,
    region: typeof r.region === 'string' ? r.region : '',
    country: typeof r.country === 'string' ? r.country : '',
    timezone,
    latitude,
    longitude,
  }
}

type WeatherCityStore = Pick<Storage, 'getItem' | 'setItem'>

export function readWeatherCityPreference(store?: WeatherCityStore): WeatherCityPreference | null {
  try {
    const kv = store ?? (typeof window !== 'undefined' ? window.localStorage : null)
    if (!kv) return null
    const raw = kv.getItem(WEATHER_CITY_STORAGE_KEY)
    return raw ? normalizeWeatherCityPreference(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function writeWeatherCityPreference(pref: WeatherCityPreference, store?: WeatherCityStore): boolean {
  try {
    const kv = store ?? (typeof window !== 'undefined' ? window.localStorage : null)
    if (!kv) return false
    kv.setItem(WEATHER_CITY_STORAGE_KEY, JSON.stringify(pref))
    return true
  } catch {
    return false
  }
}
