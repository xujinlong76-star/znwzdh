'use client'

import React, { useState } from 'react'
import { CloudSun, Sun, CloudRain, Wind, Droplets, MapPin } from 'lucide-react'

interface WeatherWidgetProps {
  config?: {
    city?: string
    unit?: 'celsius' | 'fahrenheit'
  }
}

interface CityWeather {
  name: string
  province: string
  tempC: number
  condition: string
  conditionType: 'sun' | 'cloud' | 'rain'
  humidity: number
  aqi: number
  aqiLabel: string
  wind: string
  forecast: Array<{ day: string; tempC: number; type: 'sun' | 'cloud' | 'rain' }>
}

const CITY_DATA: Record<string, CityWeather> = {
  beijing: {
    name: '北京',
    province: '直辖市',
    tempC: 21,
    condition: '晴朗微风',
    conditionType: 'sun',
    humidity: 38,
    aqi: 28,
    aqiLabel: '优',
    wind: '东北风 2级',
    forecast: [
      { day: '今天', tempC: 21, type: 'sun' },
      { day: '明天', tempC: 23, type: 'sun' },
      { day: '后天', tempC: 19, type: 'cloud' },
    ],
  },
  shanghai: {
    name: '上海',
    province: '直辖市',
    tempC: 24,
    condition: '多云转晴',
    conditionType: 'cloud',
    humidity: 58,
    aqi: 35,
    aqiLabel: '优',
    wind: '东南风 3级',
    forecast: [
      { day: '今天', tempC: 24, type: 'cloud' },
      { day: '明天', tempC: 25, type: 'sun' },
      { day: '后天', tempC: 22, type: 'rain' },
    ],
  },
  guangzhou: {
    name: '广州',
    province: '广东',
    tempC: 27,
    condition: '多云温暖',
    conditionType: 'cloud',
    humidity: 68,
    aqi: 42,
    aqiLabel: '良',
    wind: '南风 2级',
    forecast: [
      { day: '今天', tempC: 27, type: 'cloud' },
      { day: '明天', tempC: 28, type: 'rain' },
      { day: '后天', tempC: 26, type: 'cloud' },
    ],
  },
  shenzhen: {
    name: '深圳',
    province: '广东',
    tempC: 26,
    condition: '清风微拂',
    conditionType: 'sun',
    humidity: 62,
    aqi: 22,
    aqiLabel: '优',
    wind: '微风 1级',
    forecast: [
      { day: '今天', tempC: 26, type: 'sun' },
      { day: '明天', tempC: 27, type: 'sun' },
      { day: '后天', tempC: 25, type: 'cloud' },
    ],
  },
  hangzhou: {
    name: '杭州',
    province: '浙江',
    tempC: 23,
    condition: '烟雨朦胧',
    conditionType: 'rain',
    humidity: 74,
    aqi: 31,
    aqiLabel: '优',
    wind: '东风 2级',
    forecast: [
      { day: '今天', tempC: 23, type: 'rain' },
      { day: '明天', tempC: 22, type: 'cloud' },
      { day: '后天', tempC: 25, type: 'sun' },
    ],
  },
  chengdu: {
    name: '成都',
    province: '四川',
    tempC: 20,
    condition: '阴天清爽',
    conditionType: 'cloud',
    humidity: 65,
    aqi: 39,
    aqiLabel: '优',
    wind: '无持续风向',
    forecast: [
      { day: '今天', tempC: 20, type: 'cloud' },
      { day: '明天', tempC: 21, type: 'cloud' },
      { day: '后天', tempC: 22, type: 'sun' },
    ],
  },
  tokyo: {
    name: '东京',
    province: '日本',
    tempC: 18,
    condition: '晴朗干爽',
    conditionType: 'sun',
    humidity: 45,
    aqi: 18,
    aqiLabel: '极佳',
    wind: '北风 2级',
    forecast: [
      { day: '今天', tempC: 18, type: 'sun' },
      { day: '明天', tempC: 19, type: 'sun' },
      { day: '后天', tempC: 17, type: 'cloud' },
    ],
  },
  sf: {
    name: '旧金山',
    province: '加州',
    tempC: 16,
    condition: '微雾转晴',
    conditionType: 'cloud',
    humidity: 72,
    aqi: 20,
    aqiLabel: '优',
    wind: '西风 4级',
    forecast: [
      { day: '今天', tempC: 16, type: 'cloud' },
      { day: '明天', tempC: 17, type: 'sun' },
      { day: '后天', tempC: 15, type: 'cloud' },
    ],
  },
}

export function WeatherWidget({ config }: WeatherWidgetProps) {
  const cityKey = config?.city || 'shanghai'
  const city = CITY_DATA[cityKey] || CITY_DATA.shanghai
  const [useFahrenheit, setUseFahrenheit] = useState(config?.unit === 'fahrenheit')

  const toTemp = (c: number) => {
    if (useFahrenheit) {
      return `${Math.round((c * 9) / 5 + 32)}°F`
    }
    return `${c}°C`
  }

  const renderWeatherIcon = (type: 'sun' | 'cloud' | 'rain', className = 'w-4 h-4') => {
    if (type === 'sun') return <Sun className={`${className} text-amber-500`} />
    if (type === 'rain') return <CloudRain className={`${className} text-blue-500`} />
    return <CloudSun className={`${className} text-sky-500`} />
  }

  return (
    <div className="h-full flex flex-col justify-between p-3.5 select-none space-y-2">
      {/* 顶部城市位置与单位切换 */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <MapPin className="w-3.5 h-3.5 text-primary" />
          <span>{city.name}</span>
          <span className="text-xs text-muted-foreground font-normal">({city.province})</span>
        </div>

        <button
          onClick={() => setUseFahrenheit(!useFahrenheit)}
          className="text-xs font-mono px-2 py-0.5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40 transition-colors"
          title="点击切换摄氏度/华氏度"
        >
          {useFahrenheit ? '切换至 °C' : '切换至 °F'}
        </button>
      </div>

      {/* 实时气象核心大卡片 */}
      <div className="flex items-center justify-between py-1">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            {renderWeatherIcon(city.conditionType, 'w-6 h-6')}
          </div>
          <div>
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
              {toTemp(city.tempC)}
            </div>
            <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
              <span>{city.condition}</span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full font-mono">
                AQI {city.aqi} {city.aqiLabel}
              </span>
            </div>
          </div>
        </div>

        {/* 湿度与风力 */}
        <div className="text-right text-xs text-muted-foreground space-y-1">
          <div className="flex items-center justify-end gap-1">
            <Droplets className="w-3 h-3 text-sky-500" />
            <span>湿度 {city.humidity}%</span>
          </div>
          <div className="flex items-center justify-end gap-1">
            <Wind className="w-3 h-3 text-teal-500" />
            <span>{city.wind}</span>
          </div>
        </div>
      </div>

      {/* 未来 3 日趋势胶囊 */}
      <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-border/40">
        {city.forecast.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between px-2 py-1 rounded-lg bg-muted/30 border border-border/30 text-xs"
          >
            <span className="text-muted-foreground">{item.day}</span>
            <div className="flex items-center gap-1 font-mono font-medium">
              {renderWeatherIcon(item.type, 'w-2.5 h-2.5')}
              <span>{toTemp(item.tempC)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
