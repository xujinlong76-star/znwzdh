/**
 * Deterministic page fingerprinting and conservative duplicate classification.
 * CJK text uses character bigrams; whitespace-only tokenization collapses a Chinese paragraph.
 */
export interface PageFingerprint { algorithm: "simhash64-v1"; tokenCount: number; shingleCount: number; simhash: string; }
function tokensOf(text: string): string[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase().replace(/https?:\/\/\S+/g, " ");
  const chunks = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+/gu) ?? [];
  const tokens: string[] = [];
  for (const chunk of chunks) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(chunk)) {
      const chars = Array.from(chunk);
      if (chars.length === 1) tokens.push(chars[0]!);
      else for (let i = 0; i < chars.length - 1; i++) tokens.push(chars.slice(i, i + 2).join(""));
    } else tokens.push(chunk);
  }
  return tokens;
}
function hash64(value: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const char of value) { hash ^= BigInt(char.codePointAt(0) ?? 0); hash = BigInt.asUintN(64, hash * 0x100000001b3n); }
  return hash;
}
export function fingerprintPageContent(text: string, shingleSize = 3): PageFingerprint {
  if (!Number.isInteger(shingleSize) || shingleSize < 1 || shingleSize > 8) throw new RangeError("shingleSize 必须是 1–8 的整数");
  const tokens = tokensOf(text), shingles: string[] = [];
  for (let i = 0; i <= tokens.length - shingleSize; i++) shingles.push(tokens.slice(i, i + shingleSize).join(" "));
  const unique = new Set(shingles), vector = Array<number>(64).fill(0);
  for (const shingle of unique) {
    const hash = hash64(shingle);
    for (let bit = 0; bit < 64; bit++) vector[bit] = (vector[bit] ?? 0) + ((hash & (1n << BigInt(bit))) === 0n ? -1 : 1);
  }
  let simhash = 0n;
  for (let bit = 0; bit < 64; bit++) if (vector[bit]! >= 0) simhash |= 1n << BigInt(bit);
  return { algorithm: "simhash64-v1", tokenCount: tokens.length, shingleCount: unique.size, simhash: simhash.toString(16).padStart(16, "0") };
}
export function simhashDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) throw new TypeError("simhash 必须是 16 位十六进制字符串");
  let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), count = 0;
  while (value) { count += Number(value & 1n); value >>= 1n; }
  return count;
}
export function jaccardSimilarity<T>(left: readonly T[], right: readonly T[]): number {
  const a = new Set(left), b = new Set(right);
  if (!a.size && !b.size) return 1;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
export type DuplicateDecision = "exact_duplicate" | "near_duplicate" | "distinct" | "insufficient_content";
export function classifyContentSimilarity(input: {
  left: PageFingerprint; right: PageFingerprint; semanticSimilarity?: number | null;
  exactContentHashMatch?: boolean; maxSimhashDistance?: number; semanticThreshold?: number;
}): DuplicateDecision {
  if (input.exactContentHashMatch) return "exact_duplicate";
  if (input.left.tokenCount < 30 || input.right.tokenCount < 30) return "insufficient_content";
  const maxDistance = input.maxSimhashDistance ?? 3, threshold = input.semanticThreshold ?? 0.94;
  if (!Number.isInteger(maxDistance) || maxDistance < 0 || maxDistance > 64) throw new RangeError("maxSimhashDistance 无效");
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError("semanticThreshold 必须在 0–1 之间");
  if (simhashDistance(input.left.simhash, input.right.simhash) <= maxDistance) return "near_duplicate";
  const semantic = input.semanticSimilarity;
  if (semantic !== undefined && semantic !== null) {
    if (!Number.isFinite(semantic) || semantic < 0 || semantic > 1) throw new RangeError("semanticSimilarity 必须在 0–1 之间");
    if (semantic >= threshold) return "near_duplicate";
  }
  return "distinct";
}
export function normalizeDomainHost(value: string): string {
  let url: URL;
  try { url = new URL(value.includes("://") ? value : `https://${value}`); } catch { throw new TypeError("域名或 URL 无效"); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) throw new TypeError("域名或 URL 无效");
  return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}
/** Explicit verified alias groups only; registrable-domain parsing belongs to the URL adapter. */
export function resolveDomainFamily(host: string, aliasGroups: readonly (readonly string[])[] = []): string {
  const normalized = normalizeDomainHost(host);
  for (const group of aliasGroups) {
    const aliases = group.map(normalizeDomainHost);
    if (aliases.includes(normalized)) return [...aliases].sort()[0]!;
  }
  return normalized;
}
