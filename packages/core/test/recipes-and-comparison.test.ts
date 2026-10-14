import { describe, it, expect } from 'vitest';
import {
  findMatchingArchitectureRecipe,
  parseTechComparisonQuery,
  PRESET_RECIPES,
  COMPARISON_KNOWLEDGE_BASE,
} from '../src/index.ts';

describe('Graph-RAG 多跳技术栈链路配方引擎', () => {
  it('预设配方库结构完备且包含所有分层定义', () => {
    expect(PRESET_RECIPES.length).toBeGreaterThanOrEqual(3);
    for (const recipe of PRESET_RECIPES) {
      expect(recipe.layers.length).toBeGreaterThanOrEqual(3);
      for (const layer of recipe.layers) {
        expect(layer.recommended.title).toBeTruthy();
        expect(layer.recommended.url).toBeTruthy();
        expect(layer.alternatives.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('输入协同或白板时应当精准推导出协同文档系统架构配方', () => {
    const r1 = findMatchingArchitectureRecipe('如何搭建实时协同文档');
    expect(r1).not.toBeNull();
    expect(r1?.id).toBe('collaborative-editor');
    expect(r1?.layers[0]?.recommended.id).toBe('tiptap');
    expect(r1?.layers[1]?.recommended.id).toBe('yjs');
    expect(r1?.layers[2]?.recommended.id).toBe('hocuspocus');
  });

  it('输入本地知识库或 RAG 时应当推导出本地大模型链路配方', () => {
    const r2 = findMatchingArchitectureRecipe('构建本地私有化 RAG 知识库');
    expect(r2).not.toBeNull();
    expect(r2?.id).toBe('local-rag-agent');
    expect(r2?.layers.some((l) => l.recommended.id === 'ollama')).toBe(true);
    expect(r2?.layers.some((l) => l.recommended.id === 'qdrant')).toBe(true);
  });

  it('输入全栈应用时应当推导出现代化 Web 全栈架构', () => {
    const r3 = findMatchingArchitectureRecipe('全栈开发技术栈选型');
    expect(r3).not.toBeNull();
    expect(r3?.id).toBe('modern-fullstack-web');
    expect(r3?.layers.some((l) => l.recommended.id === 'nextjs')).toBe(true);
    expect(r3?.layers.some((l) => l.recommended.id === 'shadcn')).toBe(true);
  });

  it('常规无关查询应当返回 null', () => {
    expect(findMatchingArchitectureRecipe('听音乐')).toBeNull();
    expect(findMatchingArchitectureRecipe('百度')).toBeNull();
  });
});

describe('端侧 Agentic 竞品并排对比矩阵合成引擎', () => {
  it('应当准确解析 "react vs vue" 并生成 4 维对比维度', () => {
    const matrix = parseTechComparisonQuery('react vs vue');
    expect(matrix).not.toBeNull();
    expect(matrix?.id).toBe('react-vs-vue');
    expect(matrix?.itemA.name).toContain('React');
    expect(matrix?.itemB.name).toContain('Vue');
    expect(matrix?.dimensions.length).toBeGreaterThanOrEqual(4);
    expect(matrix?.verdict).toContain('Vue');
  });

  it('支持反向顺序与中文关键字（"vue 对比 react"）', () => {
    const matrix = parseTechComparisonQuery('vue 对比 react');
    expect(matrix).not.toBeNull();
    expect(matrix?.id).toBe('react-vs-vue');
  });

  it('支持 "cursor vs vscode" 效率对比', () => {
    const matrix = parseTechComparisonQuery('cursor vs vscode');
    expect(matrix).not.toBeNull();
    expect(matrix?.id).toBe('cursor-vs-vscode');
    expect(matrix?.itemA.primaryPros.length).toBeGreaterThan(0);
    expect(matrix?.verdict).toContain('Cursor');
  });

  it('支持 "pnpm pk bun" 与 "tailwind 对比 unocss"', () => {
    const m1 = parseTechComparisonQuery('pnpm pk bun');
    expect(m1).not.toBeNull();
    expect(m1?.id).toBe('pnpm-vs-bun');

    const m2 = parseTechComparisonQuery('tailwind vs unocss');
    expect(m2).not.toBeNull();
    expect(m2?.id).toBe('tailwind-vs-unocss');
  });

  it('支持前沿 AI 对决 "cline vs cursor" 与 "ollama 对比 vllm"', () => {
    const m1 = parseTechComparisonQuery('cline vs cursor');
    expect(m1).not.toBeNull();
    expect(m1?.id).toBe('cline-vs-cursor');
    expect(m1?.itemA.name).toContain('Cline');
    expect(m1?.itemB.name).toContain('Cursor');

    const m2 = parseTechComparisonQuery('ollama 对比 vllm');
    expect(m2).not.toBeNull();
    expect(m2?.id).toBe('ollama-vs-vllm');
    expect(m2?.itemB.name).toContain('vLLM');
  });

  it('常规非对比查询应当回退为 null', () => {
    expect(parseTechComparisonQuery('react 教程')).toBeNull();
    expect(parseTechComparisonQuery('vscode 下载')).toBeNull();
  });
});
