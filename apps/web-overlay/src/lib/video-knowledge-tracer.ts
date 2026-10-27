/**
 * Bayesian Knowledge Tracing (BKT) & Diagnostic Remedy Engine
 * Models probabilistic skill mastery using Slip, Guess, and Transition parameters across DAG prerequisites.
 */

export interface BKTNodeParams {
  conceptId: string
  conceptName: string
  priorMastery: number // P(L0) default 0.2
  transitionProb: number // P(T) default 0.15
  guessProb: number // P(G) default 0.20
  slipProb: number // P(S) default 0.10
  prerequisiteIds: string[]
  recommendedTimestampSec?: number
}

export interface ConceptMasteryState {
  conceptId: string
  conceptName: string
  currentMastery: number // P(Lt) 0.0 - 1.0
  practiceCount: number
  status: 'mastered' | 'learning' | 'critical_weakness'
  prerequisiteIds: string[]
  recommendedTimestampSec?: number
}

export interface DiagnosticWeaknessReport {
  overallProficiency: number // 0.0 - 1.0
  masteredCount: number
  weakCount: number
  remedialSuggestions: Array<{
    conceptId: string
    conceptName: string
    masteryScore: number
    reason: string
    jumpToTimeSec?: number
  }>
}

/**
 * Calculates updated Bayesian mastery probability given an observed binary attempt.
 */
export function calculateBKTUpdate(
  priorLt: number,
  isCorrect: boolean,
  pT: number = 0.15,
  pG: number = 0.2,
  pS: number = 0.1
): number {
  let posteriorLt = 0
  if (isCorrect) {
    const num = priorLt * (1 - pS)
    const den = (priorLt * (1 - pS)) + ((1 - priorLt) * pG)
    posteriorLt = den > 0 ? num / den : priorLt
  } else {
    const num = priorLt * pS
    const den = (priorLt * pS) + ((1 - priorLt) * (1 - pG))
    posteriorLt = den > 0 ? num / den : priorLt
  }

  // State transition update: P(Lt) = P(Lt|obs) + (1 - P(Lt|obs)) * P(T)
  const nextLt = posteriorLt + ((1 - posteriorLt) * pT)
  return Math.max(0.01, Math.min(0.99, nextLt))
}

/**
 * Bayesian Knowledge Tracer managing interconnected skill graph nodes.
 */
export class BayesianKnowledgeTracer {
  private concepts: Map<string, BKTNodeParams> = new Map()
  private masteryMap: Map<string, { mastery: number; practiceCount: number }> = new Map()

  constructor(initialNodes?: BKTNodeParams[]) {
    if (initialNodes) {
      initialNodes.forEach(node => this.registerConcept(node))
    }
  }

  registerConcept(params: BKTNodeParams): void {
    this.concepts.set(params.conceptId, params)
    if (!this.masteryMap.has(params.conceptId)) {
      this.masteryMap.set(params.conceptId, {
        mastery: params.priorMastery,
        practiceCount: 0,
      })
    }
  }

  recordAttempt(conceptId: string, isCorrect: boolean): ConceptMasteryState | null {
    const node = this.concepts.get(conceptId)
    const current = this.masteryMap.get(conceptId)
    if (!node || !current) return null

    const updated = calculateBKTUpdate(
      current.mastery,
      isCorrect,
      node.transitionProb,
      node.guessProb,
      node.slipProb
    )

    this.masteryMap.set(conceptId, {
      mastery: updated,
      practiceCount: current.practiceCount + 1,
    })

    return this.getConceptState(conceptId)
  }

  getConceptState(conceptId: string): ConceptMasteryState | null {
    const node = this.concepts.get(conceptId)
    const cur = this.masteryMap.get(conceptId)
    if (!node || !cur) return null

    let status: ConceptMasteryState['status'] = 'learning'
    if (cur.mastery >= 0.8) {
      status = 'mastered'
    } else if (cur.mastery < 0.45 && cur.practiceCount > 0) {
      status = 'critical_weakness'
    }

    return {
      conceptId: node.conceptId,
      conceptName: node.conceptName,
      currentMastery: Math.round(cur.mastery * 100) / 100,
      practiceCount: cur.practiceCount,
      status,
      prerequisiteIds: node.prerequisiteIds,
      recommendedTimestampSec: node.recommendedTimestampSec,
    }
  }

  getAllStates(): ConceptMasteryState[] {
    const states: ConceptMasteryState[] = []
    this.concepts.forEach((_, id) => {
      const st = this.getConceptState(id)
      if (st) states.push(st)
    })
    return states
  }

  getDiagnosticReport(): DiagnosticWeaknessReport {
    const states = this.getAllStates()
    if (states.length === 0) {
      return { overallProficiency: 0.5, masteredCount: 0, weakCount: 0, remedialSuggestions: [] }
    }

    let totalMastery = 0
    let mastered = 0
    let weak = 0
    const suggestions: DiagnosticWeaknessReport['remedialSuggestions'] = []

    states.forEach(s => {
      totalMastery += s.currentMastery
      if (s.status === 'mastered') mastered++
      if (s.currentMastery < 0.5) {
        weak++
        suggestions.push({
          conceptId: s.conceptId,
          conceptName: s.conceptName,
          masteryScore: Math.round(s.currentMastery * 100),
          reason: s.practiceCount > 0 ? '近期测验多次失误，概念未完全内化' : '尚未进行专项验证练习，置信度较低',
          jumpToTimeSec: s.recommendedTimestampSec,
        })
      }
    })

    // Sort by lowest mastery first
    suggestions.sort((a, b) => a.masteryScore - b.masteryScore)

    return {
      overallProficiency: Math.round((totalMastery / states.length) * 100) / 100,
      masteredCount: mastered,
      weakCount: weak,
      remedialSuggestions: suggestions,
    }
  }
}
