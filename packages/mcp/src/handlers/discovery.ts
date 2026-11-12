/**
 * 发现域工具：双曲流形「替代站点」与 Wayback 存档解析。
 * 两者都在能力不可用时平滑降级（向量缺失 -> 启发式；网络失败 -> 只给构造 URL）。
 */
import { guardedFetch } from "@navhub/ai";
import {
  buildWaybackSaveUrl,
  buildWaybackSnapshotUrl,
  computeHyperbolicAlternativeScore,
  lorentzDistance,
  normalizeTargetUrl,
  parseWaybackAvailabilityResponse,
  poincareToLorentz,
  projectEmbeddingToBall,
  type WaybackSnapshotInfo,
} from "@navhub/core";
import { GetAlternativesInput, ResolveWaybackInput, requireScope, type ToolContext } from "../tools.ts";
import { fail, ok, type Handler, type HandlerDeps } from "./shared.ts";

export const discoveryHandlers = {
  async get_alternatives(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = GetAlternativesInput.parse(args ?? {});
    const targetSite = await ctx.repo.getSite(input.idOrUrl);
    if (!targetSite) return fail("未找到目标站点：" + input.idOrUrl);
    const limit = Math.min(input.limit || 6, 20);

    try {
      if (ctx.embedding && ctx.vectors) {
        const vec = await ctx.repo.getEmbedding(targetSite.id);
        // 投影用**全维**归一化到固定半径。旧写法取前 16 维再乘 0.6：bge 的语义摊在 512 维上，
        // 前 16 维是随机子空间，用它算测地线距离会把真正邻近的次序打乱（见 projectEmbeddingToBall 的实测）。
        const targetBall = vec ? projectEmbeddingToBall(vec) : null;
        if (vec && targetBall) {
          const matches = await ctx.vectors.search(vec, Math.max(limit * 3, 24));
          const targetLorentz = poincareToLorentz(targetBall);

          const scored = [];
          for (const m of matches) {
            if (m.siteId === targetSite.id) continue;
            const candSite = await ctx.repo.getSite(m.siteId);
            if (!candSite || candSite.status === "broken") continue;
            const candVec = await ctx.repo.getEmbedding(m.siteId);
            // 缺向量的候选以前用「目标坐标 × 系数」造一个假邻近：它和自身的距离恒为 0，
            // 索引与 embeddings 表一旦漂移，那个站点就会出现在所有站点的「同类产品」首位。
            // 现在没了——没有向量就跳过，不编。宁可少给几条也不编。
            const candBall = projectEmbeddingToBall(candVec);
            if (!candBall) continue;
            const candLorentz = poincareToLorentz(candBall);
            const lDist = lorentzDistance(targetLorentz, candLorentz);
            const altScore = computeHyperbolicAlternativeScore(targetBall, candBall);
            scored.push({
              site: { id: candSite.id, title: candSite.title, url: candSite.url, description: candSite.description },
              geodesicDistance: Number(lDist.toFixed(4)),
              alternativeScore: altScore,
              sameCategory: candSite.categoryId === targetSite.categoryId,
            });
          }
          scored.sort((a, b) => b.alternativeScore - a.alternativeScore);
          return ok({
            target: { id: targetSite.id, title: targetSite.title, url: targetSite.url },
            manifold: "lorentz-hyperboloid",
            alternatives: scored.slice(0, limit),
          });
        }
      }
    } catch {
      // 向量不可用平滑降级
    }

    // 启发式双曲特征投影兜底
    const allSites = await ctx.repo.listSites({ limit: 200 });
    const targetTags = new Set(targetSite.tags ?? []);
    const fallbackHits = allSites
      .filter((s) => s.id !== targetSite.id && s.status !== "broken")
      .map((cand) => {
        const candTags = new Set(cand.tags ?? []);
        let overlap = 0;
        for (const t of targetTags) if (candTags.has(t)) overlap++;
        const union = new Set([...targetTags, ...candTags]).size || 1;
        const jaccard = overlap / union;
        const catMatch = cand.categoryId === targetSite.categoryId ? 1 : 0;

        const uBall = [0.45, 0.35, 0.25];
        const vBall = [
          0.45 + (1 - catMatch) * 0.25,
          0.35 + (1 - jaccard) * 0.3,
          0.25,
        ];
        const lDist = lorentzDistance(poincareToLorentz(uBall), poincareToLorentz(vBall));
        const altScore = computeHyperbolicAlternativeScore(uBall, vBall);
        return {
          site: { id: cand.id, title: cand.title, url: cand.url, description: cand.description },
          geodesicDistance: Number(lDist.toFixed(4)),
          alternativeScore: Number((altScore + catMatch * 0.15 + jaccard * 0.2).toFixed(4)),
          sameCategory: Boolean(catMatch),
        };
      })
      .sort((a, b) => b.alternativeScore - a.alternativeScore)
      .slice(0, limit);

    return ok({
      target: { id: targetSite.id, title: targetSite.title, url: targetSite.url },
      manifold: "poincare-heuristic",
      alternatives: fallbackHits,
    });
  },

  async resolve_wayback(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = ResolveWaybackInput.parse(args ?? {});
    let targetUrl = input.url.trim();
    const existing = await ctx.repo.getSite(targetUrl);
    if (existing) {
      targetUrl = existing.url;
    }
    const cleanUrl = normalizeTargetUrl(targetUrl);
    if (!cleanUrl) return fail("无效的网址：" + input.url);

    let snapshot: WaybackSnapshotInfo = { available: false };
    try {
      const queryUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(cleanUrl)}${input.timestamp ? `&timestamp=${encodeURIComponent(input.timestamp)}` : ""}`;
      const res = await guardedFetch(queryUrl, { timeoutMs: 3000 });
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        snapshot = parseWaybackAvailabilityResponse(data);
      }
    } catch {
      // 网络超时或脱机环境，平滑降级
    }

    const effectiveTimestamp = snapshot.timestamp || input.timestamp;
    return ok({
      targetUrl: cleanUrl,
      available: snapshot.available,
      snapshotUrl: snapshot.url ?? buildWaybackSnapshotUrl(cleanUrl, effectiveTimestamp),
      timestamp: snapshot.timestamp,
      recoveryUrl: buildWaybackSnapshotUrl(cleanUrl, effectiveTimestamp),
      saveUrl: buildWaybackSaveUrl(cleanUrl),
    });
  },
} satisfies Record<string, Handler>;
