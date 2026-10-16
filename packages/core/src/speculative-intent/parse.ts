/**
 * 推测意图编排入口：按优先级串联各域检测器。
 *
 * 优先级逐层匹配：高置信度特定语法优先，防短串误判。
 * 检测器实现按域拆分在同目录下（encoding/time/network/compute/regex/
 * semver/http-status），类型定义见 ./types.ts。
 */
import type { SpeculativeIntentResult } from './types.ts'
import { tryParseBase64, tryParseUrlEncoding, tryParseJson, tryDetectHash } from './encoding.ts'
import { tryParseTimestamp, tryParseCron } from './time.ts'
import { tryDetectIp, tryParseCurl, tryParseJwt } from './network.ts'
import { tryParseMath, tryParseColor } from './compute.ts'
import { tryParseRegex } from './regex.ts'
import { tryParseSemver } from './semver.ts'
import { tryParseHttpStatus } from './http-status.ts'

export function parseSpeculativeIntent(input: string): SpeculativeIntentResult | null {
  if (!input || input.trim().length === 0) return null;
  let q = input.trim();
  if (q.length > 5000) q = q.slice(0, 5000);

  // 优先级逐层匹配：高置信度特定语法优先，防短串误判
  return (
    tryParseCron(q) ||
    tryParseJwt(q) ||
    tryParseCurl(q) ||
    tryParseHttpStatus(q) ||
    tryParseSemver(q) ||
    tryParseRegex(q) ||
    tryParseMath(q) ||
    tryParseTimestamp(q) ||
    tryParseColor(q) ||
    tryParseJson(q) ||
    tryDetectHash(q) ||
    tryParseBase64(q) ||
    tryParseUrlEncoding(q) ||
    tryDetectIp(q)
  );
}
