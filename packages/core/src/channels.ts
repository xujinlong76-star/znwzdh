/**
 * 检索通道注册表。
 *
 * 为什么需要它：RRF 融合的通道列表曾经是 `types.ts` 里的 const 数组，
 * 新增一路召回（例如将来的「协同过滤」）必须改 core 的导出类型，
 * 所有消费方都被迫跟着改。
 *
 * 注册表把「通道名单 + 默认权重」变成运行时可变：
 *   - 内置五路（exact/fts/pinyin/semantic/personal）开箱即用
 *   - `registerChannel(name, weight)` 追加新通道，fusion 自动纳入融合与 coverage 统计
 *   - 类型上 `SearchChannel = BuiltinChannel | (string & {})`：内置通道保留自动补全，
 *     扩展通道不报类型错
 *
 * 注意：注册表只解决「名单与权重」。新通道的**召回实现**仍由调用方提供
 * （SearchEngine 的一个 channel* 方法），本模块不假装能消除那部分成本。
 */

export const BUILTIN_CHANNELS = ["exact", "fts", "pinyin", "semantic", "personal"] as const;
export type BuiltinChannel = (typeof BUILTIN_CHANNELS)[number];

/** 内置通道的默认权重（相关性通道 0.9~1.4，个性化 0.3——见 fusion.ts 的 RRF 教训） */
export const BUILTIN_CHANNEL_WEIGHTS: Record<BuiltinChannel, number> = {
  exact: 1.4,
  fts: 1.0,
  pinyin: 0.9,
  semantic: 1.15,
  personal: 0.3,
};

const registry = new Set<string>(BUILTIN_CHANNELS);
const weights = new Map<string, number>(Object.entries(BUILTIN_CHANNEL_WEIGHTS) as Array<[string, number]>);

/** 注册新通道（幂等；重复注册以最后一次 weight 为准，不传则只加名单） */
export function registerChannel(name: string, weight?: number): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("通道名不能为空");
  registry.add(trimmed);
  if (weight !== undefined) {
    if (!Number.isFinite(weight) || weight < 0) throw new Error("通道权重必须是非负有限数: " + weight);
    weights.set(trimmed, weight);
  }
}

/** 全部通道（内置在前，扩展在后，顺序稳定） */
export function searchChannels(): string[] {
  const extra = [...registry].filter((c) => !(BUILTIN_CHANNELS as readonly string[]).includes(c));
  return [...BUILTIN_CHANNELS, ...extra.sort()];
}

/** 某通道的默认权重（未注册返回 0，融合时自然不参与） */
export function channelWeight(name: string): number {
  return weights.get(name) ?? 0;
}

/** 全部通道的默认权重表 */
export function channelWeights(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of searchChannels()) out[c] = channelWeight(c);
  return out;
}

/** 测试用：重置为内置状态 */
export function resetChannels(): void {
  registry.clear();
  for (const c of BUILTIN_CHANNELS) registry.add(c);
  weights.clear();
  for (const [c, w] of Object.entries(BUILTIN_CHANNEL_WEIGHTS) as Array<[string, number]>) weights.set(c, w);
}
