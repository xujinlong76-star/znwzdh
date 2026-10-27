import type { VideoChapter } from '@/types/navigation'

export interface MindMapNode {
  id: string
  title: string
  timeSec?: number
  type: 'root' | 'category' | 'concept' | 'action'
  children: MindMapNode[]
}

/**
 * Builds an interactive hierarchical concept mindmap tree for a video.
 */
export function generateVideoMindMap(params: {
  videoId: string
  title: string
  chapters?: VideoChapter[]
  tags?: string[]
}): MindMapNode {
  const { videoId, title, chapters = [], tags = [] } = params

  const root: MindMapNode = {
    id: `root-${videoId}`,
    title,
    type: 'root',
    children: [],
  }

  // 1. Core Architecture Branch
  const archBranch: MindMapNode = {
    id: `branch-arch-${videoId}`,
    title: '架构与核心原理',
    type: 'category',
    children: [],
  }

  // 2. Practice & Code Branch
  const codeBranch: MindMapNode = {
    id: `branch-code-${videoId}`,
    title: '实战演练与代码清单',
    type: 'category',
    children: [],
  }

  // 3. Production Best Practices Branch
  const prodBranch: MindMapNode = {
    id: `branch-prod-${videoId}`,
    title: '生产治理与避坑实践',
    type: 'category',
    children: [],
  }

  if (chapters.length > 0) {
    chapters.forEach((ch, idx) => {
      const node: MindMapNode = {
        id: `node-${videoId}-${idx + 1}`,
        title: ch.title,
        timeSec: ch.startTime,
        type: ch.codeSnippet ? 'action' : 'concept',
        children: [],
      }

      if (ch.codeSnippet) {
        node.children.push({
          id: `node-${videoId}-${idx + 1}-code`,
          title: `代码实现 (${ch.codeLanguage || 'code'})`,
          timeSec: ch.startTime,
          type: 'action',
          children: [],
        })
      }

      if (idx === 0 || ch.title.includes('架构') || ch.title.includes('原理')) {
        archBranch.children.push(node)
      } else if (ch.codeSnippet || ch.title.includes('实战') || ch.title.includes('构建')) {
        codeBranch.children.push(node)
      } else {
        prodBranch.children.push(node)
      }
    })
  } else {
    archBranch.children.push({
      id: `node-fallback-1`,
      title: '环境准备与架构分层',
      timeSec: 0,
      type: 'concept',
      children: [],
    })
    codeBranch.children.push({
      id: `node-fallback-2`,
      title: '核心 API 编码与本地调试',
      timeSec: 120,
      type: 'action',
      children: [],
    })
    prodBranch.children.push({
      id: `node-fallback-3`,
      title: '生产环境部署与监控告警',
      timeSec: 300,
      type: 'concept',
      children: [],
    })
  }

  if (archBranch.children.length > 0) root.children.push(archBranch)
  if (codeBranch.children.length > 0) root.children.push(codeBranch)
  if (prodBranch.children.length > 0) root.children.push(prodBranch)

  return root
}

/**
 * Flattens all nodes of the tree into an array for quick indexing and search.
 */
export function flattenMindMapNodes(root: MindMapNode): MindMapNode[] {
  const result: MindMapNode[] = []
  function traverse(node: MindMapNode) {
    result.push(node)
    for (const child of node.children) {
      traverse(child)
    }
  }
  traverse(root)
  return result
}

export const flattenMindMap = flattenMindMapNodes

/**
 * Exports mindmap hierarchy as Markdown nested lists (compatible with Markmap).
 */
export function exportMindMapAsMarkdown(root: MindMapNode): string {
  let md = `# ${root.title}\n`

  function renderBranch(node: MindMapNode, level: number) {
    for (const child of node.children) {
      const indent = '  '.repeat(level)
      const timeStr = typeof child.timeSec === 'number' ? ` \`[${child.timeSec}s]\`` : ''
      md += `${indent}- ${child.title}${timeStr}\n`
      if (child.children.length > 0) {
        renderBranch(child, level + 1)
      }
    }
  }

  renderBranch(root, 0)
  return md
}
