export interface AsciinemaEvent {
  timeSec: number
  type: 'o' | 'i'
  data: string
}

export interface TerminalCastHeader {
  version: number
  width: number
  height: number
  title?: string
  env?: Record<string, string>
}

export interface TerminalCast {
  header: TerminalCastHeader
  events: AsciinemaEvent[]
  totalDurationSec: number
}

export interface AnsiToken {
  text: string
  color?: string
  isBold?: boolean
  isDim?: boolean
}

/**
 * Parses raw ANSI escape codes into structured colored tokens.
 */
export function parseAnsiString(raw: string): AnsiToken[] {
  // Regex to match ANSI escape sequences (e.g., \x1b[32m, \x1b[0m, \x1b[1;34m)
  const ansiRegex = /\x1b\[([0-9;]*)m/g
  const tokens: AnsiToken[] = []

  let lastIndex = 0
  let currentColor: string | undefined
  let currentBold = false
  let currentDim = false

  let match: RegExpExecArray | null
  while ((match = ansiRegex.exec(raw)) !== null) {
    const textChunk = raw.slice(lastIndex, match.index)
    if (textChunk.length > 0) {
      tokens.push({
        text: textChunk,
        color: currentColor,
        isBold: currentBold,
        isDim: currentDim,
      })
    }

    const codeStr = match[1] || '0'
    const codes = codeStr.split(';').map(c => parseInt(c, 10))

    for (const code of codes) {
      if (code === 0) {
        currentColor = undefined
        currentBold = false
        currentDim = false
      } else if (code === 1) {
        currentBold = true
      } else if (code === 2) {
        currentDim = true
      } else if (code === 31) {
        currentColor = '#f87171' // red-400
      } else if (code === 32) {
        currentColor = '#4ade80' // green-400
      } else if (code === 33) {
        currentColor = '#facc15' // yellow-400
      } else if (code === 34) {
        currentColor = '#60a5fa' // blue-400
      } else if (code === 35) {
        currentColor = '#c084fc' // purple-400
      } else if (code === 36) {
        currentColor = '#22d3ee' // cyan-400
      } else if (code === 37) {
        currentColor = '#f4f4f5' // zinc-100
      } else if (code === 90) {
        currentColor = '#71717a' // zinc-500
      }
    }

    lastIndex = ansiRegex.lastIndex
  }

  const remaining = raw.slice(lastIndex)
  if (remaining.length > 0) {
    tokens.push({
      text: remaining,
      color: currentColor,
      isBold: currentBold,
      isDim: currentDim,
    })
  }

  return tokens
}

/**
 * Parses asciinema v2 format raw newline-delimited JSON text.
 */
export function parseAsciinemaCast(rawText: string): TerminalCast {
  const lines = rawText.trim().split('\n').filter(Boolean)
  if (lines.length === 0) {
    return {
      header: { version: 2, width: 80, height: 24, title: '空终端' },
      events: [],
      totalDurationSec: 0,
    }
  }

  let header: TerminalCastHeader = { version: 2, width: 80, height: 24 }
  try {
    header = JSON.parse(lines[0])
  } catch {
    // fallback header
  }

  const events: AsciinemaEvent[] = []
  let maxTime = 0

  for (let i = 1; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i])
      if (Array.isArray(parsed) && parsed.length >= 3) {
        const timeSec = Number(parsed[0])
        const type = parsed[1] as 'o' | 'i'
        const data = String(parsed[2])
        events.push({ timeSec, type, data })
        if (timeSec > maxTime) maxTime = timeSec
      }
    } catch {
      // ignore corrupt lines
    }
  }

  return {
    header,
    events,
    totalDurationSec: maxTime,
  }
}

/**
 * Synthesizes a realistic technical terminal cast from bash/sh code snippets and chapters.
 */
export function generateSyntheticTerminalCast(params: {
  title: string
  commands: string[]
  durationSec?: number
}): TerminalCast {
  const { title, commands, durationSec = 300 } = params
  const events: AsciinemaEvent[] = []

  const stepTime = durationSec / Math.max(1, commands.length)
  let currentTime = 1.0

  // Shell prompt prefix
  events.push({
    timeSec: 0.1,
    type: 'o',
    data: `\x1b[36mdevops@cluster\x1b[0m:\x1b[34m~/workspace\x1b[0m$ \x1b[32m# 欢迎进入 ${title} 演练环境\x1b[0m\r\n`,
  })

  commands.forEach((cmd, idx) => {
    // Type out command char by char
    const chars = cmd.split('')
    chars.forEach((ch, cIdx) => {
      events.push({
        timeSec: Number((currentTime + (cIdx * 0.04)).toFixed(2)),
        type: 'o',
        data: ch,
      })
    })

    const cmdFinishedTime = currentTime + (chars.length * 0.04) + 0.3
    // Simulate execution output
    let output = ''
    if (cmd.startsWith('kubectl get') || cmd.startsWith('docker ps')) {
      output = `\r\n\x1b[1mNAME                          READY   STATUS    RESTARTS   AGE\x1b[0m\r\n` +
               `app-server-79d58498f-4kmw2   1/1     Running   0          42s\r\n` +
               `app-server-79d58498f-9xll1   1/1     Running   0          42s\r\n` +
               `\x1b[32m✔ 资源查询就绪\x1b[0m\r\n`
    } else if (cmd.startsWith('helm install') || cmd.startsWith('kubectl apply')) {
      output = `\r\n\x1b[32mdeployment.apps/production-gateway configured\x1b[0m\r\n` +
               `\x1b[32mservice/production-gateway-svc created\x1b[0m\r\n` +
               `\x1b[36mSTATUS: deployed (REVISION: 1)\x1b[0m\r\n`
    } else {
      output = `\r\n\x1b[32m[SUCCESS] 执行成功：${cmd.slice(0, 30)}...\x1b[0m\r\n`
    }

    events.push({
      timeSec: Number(cmdFinishedTime.toFixed(2)),
      type: 'o',
      data: output,
    })

    // Next prompt
    currentTime += Math.max(8.0, stepTime)
    events.push({
      timeSec: Number(currentTime.toFixed(2)),
      type: 'o',
      data: `\x1b[36mdevops@cluster\x1b[0m:\x1b[34m~/workspace\x1b[0m$ `,
    })
  })

  return {
    header: {
      version: 2,
      width: 80,
      height: 24,
      title,
    },
    events,
    totalDurationSec: currentTime + 2,
  }
}

/**
 * Computes terminal screen state text up to the specified playback timestamp.
 */
export function getTerminalStateAtTime(
  cast: TerminalCast,
  timeSec: number
): { rawOutput: string; tokens: AnsiToken[]; lineCount: number } {
  let combined = ''

  for (const ev of cast.events) {
    if (ev.timeSec <= timeSec) {
      if (ev.type === 'o') {
        combined += ev.data
      }
    } else {
      break
    }
  }

  const tokens = parseAnsiString(combined)
  const lineCount = (combined.match(/\n/g) || []).length + 1

  return {
    rawOutput: combined,
    tokens,
    lineCount,
  }
}
