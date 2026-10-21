import { NextResponse } from 'next/server'
export const runtime = 'edge'

const START_TIME = Date.now()

export async function GET() {
  let uptime: number
  const proc = typeof globalThis !== 'undefined' ? (globalThis as unknown as { process?: { uptime?: () => number } }).process : undefined
  if (proc && typeof proc.uptime === 'function') {
    uptime = Math.floor(proc.uptime())
  } else {
    uptime = Math.floor((Date.now() - START_TIME) / 1000)
  }

  return NextResponse.json({
    app: 'NavSphere',
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime,
  })
}
