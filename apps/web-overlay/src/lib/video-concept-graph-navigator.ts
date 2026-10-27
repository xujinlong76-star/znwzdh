/**
 * Interactive Video Knowledge Graph & Mindmap Timeline Navigator
 * Proposal [4]: Concept Graph & Mindmap Timeline Navigator
 * Builds cross-course topological knowledge trees, calculates Dijkstra shortest learning paths,
 * and provides one-click timecode jump targets for any conceptual node.
 */

import type { NavigationData, NavigationItem, NavigationSubItem } from '@/types/navigation'
import { chapterStartSec } from '@/types/navigation'

export interface ConceptGraphNode {
  id: string
  label: string
  type: 'concept' | 'course' | 'chapter' | 'domain'
  degreeCentrality: number
  domainId: string
  jumpTarget?: {
    bvid: string
    title: string
    seekSec: number
    chapterTitle?: string
  }
}

export interface ConceptGraphEdge {
  id: string
  source: string
  target: string
  relation: 'prerequisite_of' | 'contains' | 'co_occurs_with'
  weight: number
}

export interface ConceptGraphTopology {
  nodes: ConceptGraphNode[]
  edges: ConceptGraphEdge[]
  adjacencyMap: Record<string, Array<{ target: string; weight: number }>>
}

/**
 * Builds the complete concept topology from navigation video items.
 */
export function buildConceptGraphFromVideos(data: NavigationData): ConceptGraphTopology {
  const nodesMap = new Map<string, ConceptGraphNode>()
  const edges: ConceptGraphEdge[] = []
  const adjacencyMap: Record<string, Array<{ target: string; weight: number }>> = {}

  function ensureAdjacency(u: string, v: string, weight: number) {
    if (!adjacencyMap[u]) adjacencyMap[u] = []
    if (!adjacencyMap[v]) adjacencyMap[v] = []
    adjacencyMap[u].push({ target: v, weight })
    adjacencyMap[v].push({ target: u, weight })
  }

  const categories = data.navigationItems || []

  categories.forEach(cat => {
    // 1. Add domain node
    if (!nodesMap.has(cat.id)) {
      nodesMap.set(cat.id, {
        id: cat.id,
        label: cat.title,
        type: 'domain',
        degreeCentrality: 0,
        domainId: cat.id,
      })
    }

    (cat.items || []).forEach(item => {
      const bvid = item.videoConfig?.bvid || item.id
      const courseNodeId = `course_${bvid}`

      // 2. Add course node
      if (!nodesMap.has(courseNodeId)) {
        nodesMap.set(courseNodeId, {
          id: courseNodeId,
          label: item.title,
          type: 'course',
          degreeCentrality: 0,
          domainId: cat.id,
          jumpTarget: {
            bvid,
            title: item.title,
            seekSec: 0,
          },
        })
      }

      // Edge domain -> course
      edges.push({
        id: `e_${cat.id}_${courseNodeId}`,
        source: cat.id,
        target: courseNodeId,
        relation: 'contains',
        weight: 1,
      })
      ensureAdjacency(cat.id, courseNodeId, 1)

      // 3. Add chapter & concept nodes
      const chapters = item.videoConfig?.chapters || []
      chapters.forEach((ch, chIdx) => {
        const chNodeId = `ch_${bvid}_${chIdx}`
        nodesMap.set(chNodeId, {
          id: chNodeId,
          label: ch.title,
          type: 'chapter',
          degreeCentrality: 0,
          domainId: cat.id,
          jumpTarget: {
            bvid,
            title: item.title,
            seekSec: chapterStartSec(ch),
            chapterTitle: ch.title,
          },
        })

        edges.push({
          id: `e_${courseNodeId}_${chNodeId}`,
          source: courseNodeId,
          target: chNodeId,
          relation: 'contains',
          weight: 1,
        })
        ensureAdjacency(courseNodeId, chNodeId, 1)
      })

      // Extract core concepts from title
      const extractedConcepts = ['DeepSeek', 'React', 'Rust', 'eBPF', 'Docker', 'Agent', 'TypeScript', 'Kubernetes']
      extractedConcepts.forEach(c => {
        if (new RegExp(c, 'i').test(item.title)) {
          const conceptId = `concept_${c.toLowerCase()}`
          if (!nodesMap.has(conceptId)) {
            nodesMap.set(conceptId, {
              id: conceptId,
              label: c,
              type: 'concept',
              degreeCentrality: 0,
              domainId: cat.id,
              jumpTarget: {
                bvid,
                title: item.title,
                seekSec: 0,
              },
            })
          }

          edges.push({
            id: `e_${conceptId}_${courseNodeId}`,
            source: conceptId,
            target: courseNodeId,
            relation: 'co_occurs_with',
            weight: 2,
          })
          ensureAdjacency(conceptId, courseNodeId, 2)
        }
      })
    })
  })

  // Calculate degree centrality
  const nodes = Array.from(nodesMap.values()).map(n => {
    const degree = (adjacencyMap[n.id] || []).length
    return {
      ...n,
      degreeCentrality: degree,
    }
  })

  return {
    nodes,
    edges,
    adjacencyMap,
  }
}

/**
 * Computes Dijkstra shortest learning path between any two concepts or courses.
 */
export function findShortestLearningPath(
  topology: ConceptGraphTopology,
  startNodeId: string,
  targetNodeId: string
): { path: string[]; totalWeight: number; found: boolean } {
  if (startNodeId === targetNodeId) {
    return { path: [startNodeId], totalWeight: 0, found: true }
  }

  const distances: Record<string, number> = {}
  const previous: Record<string, string | null> = {}
  const unvisited = new Set<string>()

  topology.nodes.forEach(n => {
    distances[n.id] = Infinity
    previous[n.id] = null
    unvisited.add(n.id)
  })

  distances[startNodeId] = 0

  while (unvisited.size > 0) {
    let current: string | null = null
    let minDistance = Infinity

    unvisited.forEach(nodeId => {
      if (distances[nodeId] < minDistance) {
        minDistance = distances[nodeId]
        current = nodeId
      }
    })

    if (!current || minDistance === Infinity) break
    if (current === targetNodeId) break

    unvisited.delete(current)

    const neighbors = topology.adjacencyMap[current] || []
    for (const edge of neighbors) {
      if (!unvisited.has(edge.target)) continue
      const alt = distances[current] + edge.weight
      if (alt < distances[edge.target]) {
        distances[edge.target] = alt
        previous[edge.target] = current
      }
    }
  }

  if (distances[targetNodeId] === Infinity) {
    return { path: [], totalWeight: Infinity, found: false }
  }

  const path: string[] = []
  let curr: string | null = targetNodeId
  while (curr) {
    path.unshift(curr)
    curr = previous[curr]
  }

  return {
    path,
    totalWeight: distances[targetNodeId],
    found: true,
  }
}
