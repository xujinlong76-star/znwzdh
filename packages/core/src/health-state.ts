/**
 * 体检视图状态机（纯函数，**全仓唯一一份**）。
 *
 * 放在 core 而不是前端，是因为现在有两个消费方：
 *   1. 面板（决定渲染「待复检 / 无有效数据 / 未体检 / 达标」）；
 *   2. 只读健康 API `GET /api/plugins/:slug/health`（给扩展/Raycast/MCP 用）。
 * 若各留一份，迟早出现「面板说待复检、接口说健康」——这正是 [1] 方向要消灭的重复。
 *
 * 早先的面板实现：
 *
 * 为什么单独抽出来：面板原本把「有没有数据 / 是不是待复检 / 有没有测准」的判断
 * 散在 JSX 里（`snap ? … : snap?.stale ? …`、`snap && !snap.stale`、三处重复），
 * 于是出现了一个永远跑不到的分支（外层 else 里再判 snap?.stale），被前端门禁
 * TS2339 当场抓出。这类缺陷的根因不是手误，而是**状态没有唯一来源**。
 *
 * 现在视图只有四种状态，任何渲染都从 `state.kind` 分支，不再各自判断：
 *
 *   verified  有真实测量值（可能好坏参半）→ 展示指标行 + 徽标
 *   stale     清单被改过、尚无新测量值    → 琥珀色「待复检」，禁止展示任何百分比
 *   no-data   跑过体检但一条有效样本都没有 → 「无有效数据」，区别于「没测过」
 *   untested  从未跑过体检               → 引导去点「抽样体检」
 */

/** 面板/接口共用的健康快照（字段都可缺，因为历史摘要里计数可能是 null） */
export interface HealthSnapshotLike {
  stale?: boolean;
  declared?: number | null;
  sampled?: number | null;
  okCount?: number | null;
  blockedCount?: number | null;
  suspiciousCount?: number | null;
  brokenCount?: number | null;
  reachability?: number | null;
}

export type HealthPanelState =
  | {
      kind: "verified";
      reachability: number;
      okCount: number;
      blockedCount: number;
      suspiciousCount: number;
      brokenCount: number;
      sampled: number | null;
      declared: number | null;
    }
  | { kind: "stale"; declared: number | null }
  | { kind: "no-data"; declared: number | null }
  | { kind: "untested" };

/**
 * 从快照推导视图状态。
 *
 * `stale` 优先于一切数值：清单被替换/剔除过之后，任何百分比都是旧数据，
 * 展示它就是伪造健康度（历史缺陷 D2）。
 */
export function deriveHealthPanelState(snap: HealthSnapshotLike | null | undefined): HealthPanelState {
  if (!snap) return { kind: "untested" };
  if (snap.stale === true) return { kind: "stale", declared: snap.declared ?? null };

  const sampled = typeof snap.sampled === "number" ? snap.sampled : null;
  const reachability =
    typeof snap.reachability === "number" && Number.isFinite(snap.reachability) ? snap.reachability : null;
  if (reachability === null) {
    // 有快照但没有有效测量：这是「跑了但没测出来」，不是「没测过」
    return { kind: "no-data", declared: snap.declared ?? null };
  }

  return {
    kind: "verified",
    reachability,
    okCount: snap.okCount ?? 0,
    blockedCount: snap.blockedCount ?? 0,
    suspiciousCount: snap.suspiciousCount ?? 0,
    brokenCount: snap.brokenCount ?? 0,
    sampled,
    declared: snap.declared ?? null,
  };
}
