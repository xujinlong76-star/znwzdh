import type { VideoTranscriptItem } from '@/types/navigation'

export interface VectorDocumentChunk {
  id: string
  startSec: number
  endSec: number
  text: string
  vector: number[]
  category: 'transcript' | 'code' | 'note'
}

export interface RagSearchResult {
  chunk: VectorDocumentChunk
  similarity: number
  explanation: string
}

/**
 * Generates a normalized 32-dimensional TF-IDF/N-gram hash vector from a text string.
 */
export function generateSparseEmbedding(text: string, dimensions: number = 32): number[] {
  const vector = new Array(dimensions).fill(0)
  const clean = text.toLowerCase()
  if (!clean.trim()) return vector

  // Hash character trigrams
  for (let i = 0; i < clean.length - 2; i++) {
    const gram = clean.slice(i, i + 3)
    let h = 0
    for (let c = 0; c < gram.length; c++) {
      h = ((h << 5) - h) + gram.charCodeAt(c)
      h = h & h
    }
    const idx = Math.abs(h) % dimensions
    vector[idx] += 1
  }

  // L2 Normalization
  let sumSq = 0
  for (let i = 0; i < dimensions; i++) {
    sumSq += vector[i] * vector[i]
  }
  const norm = Math.sqrt(sumSq)
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] = vector[i] / norm
    }
  }

  return vector
}

/**
 * Computes cosine similarity between two normalized vectors.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0
  let dot = 0
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i]
  }
  return Math.max(0, Math.min(1.0, dot))
}

/**
 * In-memory Vector RAG Store indexing video knowledge.
 */
export class VideoLocalRagStore {
  private chunks: VectorDocumentChunk[] = []

  indexTranscripts(transcripts: VideoTranscriptItem[]): void {
    this.chunks = transcripts.map((t) => ({
      id: t.id,
      startSec: t.startSec,
      endSec: t.endSec,
      text: t.text,
      vector: generateSparseEmbedding(t.text),
      category: 'transcript',
    }))
  }

  addCodeSnippet(id: string, timeSec: number, codeText: string): void {
    this.chunks.push({
      id,
      startSec: timeSec,
      endSec: timeSec + 60,
      text: codeText,
      vector: generateSparseEmbedding(codeText),
      category: 'code',
    })
  }

  search(query: string, topK: number = 3): RagSearchResult[] {
    const queryVec = generateSparseEmbedding(query)
    const results: Array<{ chunk: VectorDocumentChunk; sim: number }> = []

    for (const chunk of this.chunks) {
      const sim = cosineSimilarity(queryVec, chunk.vector)
      results.push({ chunk, sim })
    }

    results.sort((a, b) => b.sim - a.sim)

    return results.slice(0, topK).map(({ chunk, sim }) => {
      let advice = '相关原文字幕已定位，可点击时间戳直接跳转到该时刻。'
      if (chunk.category === 'code') {
        advice = '相关代码块已被检索到，可点击复制或发送至沙箱。'
      }
      return {
        chunk,
        similarity: Math.round(sim * 100) / 100,
        explanation: advice,
      }
    })
  }
}
