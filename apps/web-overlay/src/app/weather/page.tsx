import type { Metadata } from 'next'
import { WeatherPage } from './weather-page'

/**
 * 独立天气页（`/weather`）。
 *
 * 挂件放不下 24 小时逐小时与 7 日详情，这一页承载它们：城市搜索、实况大卡、
 * 逐小时 24 小时横向条、7 日预报列表、空气质量卡、数据来源与预警免责文字。
 * 数据由客户端调服务端 /api/weather 取（服务端代理 Open-Meteo），首屏骨架先出。
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: '天气',
    description: '实时天气、24 小时逐小时预报、7 日预报与空气质量，数据来自 Open-Meteo。',
  }
}

export default function WeatherRoutePage() {
  return <WeatherPage />
}
