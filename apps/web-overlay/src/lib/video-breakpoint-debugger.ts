export interface DebugVariable {
  name: string
  value: any
  type: string
}

export interface DebugFrameState {
  currentLine: number
  callStack: string[]
  variables: Record<string, DebugVariable>
  output: string[]
}

export interface DebugBreakpoint {
  id: string
  lineNumber: number
  enabled: boolean
  condition?: string
  hitCount: number
}

/**
 * Parses Python / JavaScript / Shell script lines into sequential execution steps.
 */
export class InteractiveCodeDebugger {
  private sourceLines: string[] = []
  private breakpoints: Map<number, DebugBreakpoint> = new Map()
  private history: DebugFrameState[] = []
  private currentStepIndex: number = 0

  constructor(sourceCode: string = '') {
    this.loadSource(sourceCode)
  }

  loadSource(sourceCode: string): void {
    this.sourceLines = sourceCode.split('\n')
    this.history = []
    this.currentStepIndex = 0
    this.buildExecutionHistory()
  }

  toggleBreakpoint(lineNumber: number, condition?: string): boolean {
    if (this.breakpoints.has(lineNumber)) {
      this.breakpoints.delete(lineNumber)
      return false
    } else {
      this.breakpoints.set(lineNumber, {
        id: `bp-${lineNumber}`,
        lineNumber,
        enabled: true,
        condition,
        hitCount: 0,
      })
      return true
    }
  }

  getBreakpoints(): DebugBreakpoint[] {
    return Array.from(this.breakpoints.values())
  }

  getCurrentState(): DebugFrameState {
    if (this.history.length === 0) {
      return {
        currentLine: 1,
        callStack: ['<main>'],
        variables: {},
        output: [],
      }
    }
    return this.history[Math.min(this.currentStepIndex, this.history.length - 1)]
  }

  stepOver(): DebugFrameState {
    if (this.currentStepIndex < this.history.length - 1) {
      this.currentStepIndex++
    }
    return this.getCurrentState()
  }

  stepBack(): DebugFrameState {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--
    }
    return this.getCurrentState()
  }

  continueToNextBreakpoint(): { state: DebugFrameState; hitBreakpoint: boolean } {
    while (this.currentStepIndex < this.history.length - 1) {
      this.currentStepIndex++
      const cur = this.getCurrentState()
      const bp = this.breakpoints.get(cur.currentLine)
      if (bp && bp.enabled) {
        bp.hitCount++
        return { state: cur, hitBreakpoint: true }
      }
    }
    return { state: this.getCurrentState(), hitBreakpoint: false }
  }

  private buildExecutionHistory(): void {
    const vars: Record<string, DebugVariable> = {}
    const output: string[] = []

    this.history.push({
      currentLine: 1,
      callStack: ['<module>'],
      variables: {},
      output: [],
    })

    this.sourceLines.forEach((line, idx) => {
      const lineNum = idx + 1
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
        return
      }

      // Variable assignment parsing: var = val or let/const x = val
      const assign = trimmed.match(/^(?:let|const|var)?\s*([a-zA-Z_]\w*)\s*=\s*(.+)$/)
      if (assign) {
        const name = assign[1]
        let rawVal = assign[2].replace(/;$/, '').trim()
        let typedVal: any = rawVal
        let vType = 'string'

        if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
          typedVal = rawVal.slice(1, -1)
          vType = 'string'
        } else if (!isNaN(Number(rawVal))) {
          typedVal = Number(rawVal)
          vType = 'number'
        } else if (rawVal === 'true' || rawVal === 'false') {
          typedVal = rawVal === 'true'
          vType = 'boolean'
        }

        vars[name] = { name, value: typedVal, type: vType }
      }

      // Print / log parsing
      const printMatch = trimmed.match(/(?:console\.log|print)\((.*)\)/)
      if (printMatch) {
        const arg = printMatch[1].replace(/['"]/g, '').trim()
        output.push(vars[arg] ? String(vars[arg].value) : arg)
      }

      this.history.push({
        currentLine: lineNum,
        callStack: ['<main>'],
        variables: JSON.parse(JSON.stringify(vars)),
        output: [...output],
      })
    })
  }
}
