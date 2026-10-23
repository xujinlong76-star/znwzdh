/**
 * 推测意图（Micro-Widget）的类型契约。
 *
 * 从 speculative-intent.ts 拆出：类型与检测器（encoding/time/network/compute/
 * regex/semver/http-status）分离，编排入口见 ./parse.ts。
 */

export type SpeculativeIntentType =
  | 'cron'
  | 'jwt'
  | 'curl_to_fetch'
  | 'base64_decode'
  | 'base64_encode'
  | 'timestamp'
  | 'color'
  | 'math'
  | 'json_format'
  | 'url_decode'
  | 'url_encode'
  | 'hash_detect'
  | 'ip_detect'
  | 'cidr'
  | 'uuid'
  | 'byte_size'
  | 'regex'
  | 'semver'
  | 'http_status';

export interface SpeculativeIntentResult {
  type: SpeculativeIntentType;
  title: string;
  subtitle: string;
  previewValue: string;
  actionLabel: string;
  copyValue?: string;
  details?: Record<string, string>;
}
