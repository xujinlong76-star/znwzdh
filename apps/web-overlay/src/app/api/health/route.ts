import { NextResponse } from 'next/server'
export const runtime = 'edge'

const START_TIME = Date.now()

export async function GET() {
  let uptime: number
  try {
    // Node.js runtime: process.uptime() 可用
    uptime = Math.floor(process.uptime())
  } catch {
    // Edge Runtime: process 对象存在但 uptime() 不可调用，降级为启动时间差
    uptime = Math.floor((Date.now() - START_TIME) / 1000)
  }

  return NextResponse.json({
    app: 'NavSphere',
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime,
  })
}