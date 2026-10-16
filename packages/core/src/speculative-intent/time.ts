/**
 * 时间族检测器：Unix 时间戳转换、Cron 表达式解释。
 */
import type { SpeculativeIntentResult } from './types.ts'

/**
 * 时间戳意图解析（支持秒级 10 位与毫秒级 13 位）
 */
export function tryParseTimestamp(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const explicit = trimmed.startsWith('ts:') || trimmed.startsWith('time:');
  const numStr = explicit ? trimmed.replace(/^(ts:|time:)\s*/, '') : trimmed;

  if (!/^\d{10}(\d{3})?$/.test(numStr)) return null;

  const num = Number.parseInt(numStr, 10);
  if (Number.isNaN(num)) return null;

  const ms = numStr.length === 10 ? num * 1000 : num;
  const date = new Date(ms);

  // 合理性区间：2000 年至 2050 年之间
  if (date.getFullYear() < 2000 || date.getFullYear() > 2050) return null;

  const iso = date.toISOString();
  const local = date.toLocaleString('zh-CN', { hour12: false });
  const diffSec = Math.round((Date.now() - ms) / 1000);
  let relative = '';
  if (Math.abs(diffSec) < 60) relative = '刚刚';
  else if (Math.abs(diffSec) < 3600) relative = `${Math.floor(Math.abs(diffSec) / 60)} 分钟${diffSec > 0 ? '前' : '后'}`;
  else if (Math.abs(diffSec) < 86400) relative = `${Math.floor(Math.abs(diffSec) / 3600)} 小时${diffSec > 0 ? '前' : '后'}`;
  else relative = `${Math.floor(Math.abs(diffSec) / 86400)} 天${diffSec > 0 ? '前' : '后'}`;

  return {
    type: 'timestamp',
    title: 'Unix 时间戳转换',
    subtitle: `${numStr.length === 10 ? '秒级' : '毫秒级'}时间戳 · ${relative}`,
    previewValue: `${local} (${iso})`,
    actionLabel: '复制 ISO 时间',
    copyValue: iso,
    details: {
      '本地时间': local,
      'UTC 时间': iso,
      '相对时间': relative,
      'Unix 秒': Math.floor(ms / 1000).toString(),
      'Unix 毫秒': ms.toString(),
    },
  };
}

/**
 * Cron 表达式解析与自然语言解释
 */
export function tryParseCron(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  // 显式前缀或严格 5/6 段才判 cron，避免普通短串误触发
  const explicit = trimmed.startsWith('cron:');
  const body = explicit ? trimmed.slice(5).trim() : trimmed;
  const parts = body.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return null;

  // 基础 Cron 字符集校验（支持 @daily/MON 等前置校验：含字母时要求显式前缀）
  if (/[A-Za-z@]/.test(body) && !explicit) return null;
  const validChars = /^[0-9\*\/\,\-]+$/;
  if (!parts.every(p => validChars.test(p))) return null;
  // 范围粗检：分0-59 时0-23 日1-31 月1-12 周0-7
  const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  for (let i = 0; i < 5; i++) {
    const seg = parts[i] ?? "*";
    if (seg === "*") continue;
    const nums = seg.match(/\d+/g)?.map(Number) ?? [];
    const [lo, hi] = ranges[i]!;
    if (nums.some((n) => n < lo || n > hi)) return null;
  }

  const [min, hour, dom, mon, dow] = parts;
  let explanation = '定时执行任务: ';
  if (min === '*' && hour === '*') {
    explanation = '每分钟执行一次';
  } else if (min?.startsWith('*/')) {
    const step = min.slice(2);
    explanation = `每隔 ${step} 分钟执行一次`;
  } else if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*') {
    explanation = '每天午夜 00:00 执行一次';
  } else if (min === '0' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
    explanation = `每天 ${hour}:00 执行一次`;
  } else if (dow !== '*' && dom === '*') {
    explanation = `每周特定工作日/周末执行 (星期: ${dow})`;
  } else {
    explanation = `计划表达式: [分:${min} 时:${hour} 日:${dom} 月:${mon} 周:${dow}]`;
  }

  return {
    type: 'cron',
    title: 'Cron 定时任务表达式',
    subtitle: explanation,
    previewValue: body,
    actionLabel: '复制 Cron 语法',
    copyValue: body,
    details: {
      '标准格式': body,
      '语义释义': explanation,
      '分/时/日/月/周': parts.slice(0, 5).join(' | '),
    },
  };
}
