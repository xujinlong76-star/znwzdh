/**
 * 「同类产品」的双曲投影必须有语义，不能是坐标截取。
 *
 * 缺陷（2026-10-31 实测，data/navhub.db 993 个有向量的站点）：
 * `/api/rank/alternatives/:siteId` 把 embedding 的**前 16 维**乘 0.6 当成庞加莱球坐标，
 * 再用它重排 KNN 候选。bge 的语义摊在全部 512 维上，前 16 维只是一个随机子空间，
 * 于是 Obsidian 的「同类产品」给出 Geek Uninstaller / Free Download Manager / Motrix，
 * 而按全维余弦给出的是 Logseq、思源笔记、有道云笔记、Joplin、印象笔记、Typora。
 *
 * 另一条更狠：候选缺向量时旧代码用「目标坐标 × 系数」造一个假近邻，它和自己的
 * 距离恒为 0 —— 索引与 embeddings 表一漂移，那个站点就会出现在所有站点的平替首位。
 *
 * 本文件锁三件事：
 *   1. 固定半径的全维投影保住余弦序（截断写法会把差异抹平成同分）；
 *   2. 投影对向量自身缩放不敏感（模长惩罚项因此不再是噪声）；
 *   3. 没有向量 = null，调用方跳过，不再编坐标。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeHyperbolicAlternativeScore, projectEmbeddingToBall } from "../src/hyperbolic.ts";

const DIM = 512;

/** 第 i 个基向量 */
function axis(i: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[i] = 1;
  return v;
}

/** cos θ·e0 + sin θ·eJ：与基向量的余弦正好是 cos θ，θ 越大越不像 */
function tilted(J: number, theta: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[0] = Math.cos(theta);
  v[J] = Math.sin(theta);
  return v;
}

/** 旧写法：取前 16 维再乘 0.6（本文件用它自证「截断会抹平差异」） */
function truncatedProjection(v: number[]): number[] {
  return projectEmbeddingToBall(v.slice(0, 16)) ?? [];
}

describe("embedding 的双曲投影", () => {
  it("全维投影保住余弦序，截前 16 维则把两个远近不同的候选抹成同分", () => {
    const anchor = projectEmbeddingToBall(axis(0));
    const near = projectEmbeddingToBall(tilted(100, 0.3)); // 余弦 ≈0.955
    const far = projectEmbeddingToBall(tilted(400, 0.9)); //  余弦 ≈0.622
    expect(anchor).not.toBeNull();
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();

    const scoreNear = computeHyperbolicAlternativeScore(anchor!, near!);
    const scoreFar = computeHyperbolicAlternativeScore(anchor!, far!);
    expect(scoreNear).toBeGreaterThan(scoreFar);

    // 同两个候选按旧写法算：第 100 / 400 维被切掉，两者与锚点变成同一个球内点
    const tNear = computeHyperbolicAlternativeScore(truncatedProjection(axis(0)), truncatedProjection(tilted(100, 0.3)));
    const tFar = computeHyperbolicAlternativeScore(truncatedProjection(axis(0)), truncatedProjection(tilted(400, 0.9)));
    expect(tNear).toBe(tFar);
  });

  it("投影只看方向不看长度（模长一致性惩罚项因此不是噪声）", () => {
    const base = tilted(7, 0.4);
    const doubled = base.map((x) => x * 7);
    const a = projectEmbeddingToBall(base)!;
    const b = projectEmbeddingToBall(doubled)!;
    expect(a.map((x) => Number(x.toFixed(9)))).toEqual(b.map((x) => Number(x.toFixed(9))));
    expect(Math.hypot(...a)).toBeCloseTo(0.6, 6);
  });

  it("零向量 / 空 / 非有限值 / 半径越界一律返回 null——缺证据就不给坐标", () => {
    expect(projectEmbeddingToBall(null)).toBeNull();
    expect(projectEmbeddingToBall(undefined)).toBeNull();
    expect(projectEmbeddingToBall([])).toBeNull();
    expect(projectEmbeddingToBall([0, 0, 0])).toBeNull();
    expect(projectEmbeddingToBall([1, Number.NaN, 0])).toBeNull();
    expect(projectEmbeddingToBall([1, 2, 3], 0)).toBeNull();
    expect(projectEmbeddingToBall([1, 2, 3], 1)).toBeNull();
  });

  it("端点不再用「目标坐标 × 系数」给缺向量的候选造假近邻", () => {
    // 读源码而不是起服务：这条钉的是「那段写法回来了没有」，
    // 归一 CRLF 是为了 Windows 工作区里同一份代码得到同一个结论。
    const route = readFileSync(
      fileURLToPath(new URL("../../../apps/api/src/routes/rank.ts", import.meta.url)),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(route).toContain("projectEmbeddingToBall");
    expect(route).not.toMatch(/slice\(0,\s*16\)/);
    expect(route).not.toMatch(/idx % 2 === 0 \? 0\.85 : 0\.9/);
  });
});
