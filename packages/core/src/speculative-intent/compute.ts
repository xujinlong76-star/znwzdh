/**
 * 计算/取值族检测器：算术表达式求值、颜色（HEX/RGB）速览、UUID/ULID 识别、存储字节换算。
 */
import type { SpeculativeIntentResult } from './types.ts'
import { evaluateArithmeticExpression, formatArithmeticResult } from './arithmetic.ts'

/**
 * 纯算术表达式求值（安全计算，杜绝 unsafe eval）
 */
export function tryParseMath(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  // 长度上限：防止长串每击键解析一次 DoS
  if (trimmed.length > 200) return null;
  // 必须包含至少一个算术运算符，且仅包含数字、小数点、括号、运算符与空白
  if (!/[+\-*/%^]/.test(trimmed)) return null;
  if (!/^[\d\s+\-*/%^().]+$/.test(trimmed)) return null;

  // 避免将类似版本号或单一负数判断为算式
  if (/^\d+(\.\d+)+$/.test(trimmed)) return null;

  const result = evaluateArithmeticExpression(trimmed);
  if (result === null) return null;

  const formatted = formatArithmeticResult(result);
  return {
    type: 'math',
    title: '算术即刻计算',
    subtitle: `${trimmed} =`,
    previewValue: formatted,
    actionLabel: '复制计算结果',
    copyValue: formatted,
  };
}

/**
 * 颜色意图解析 (HEX, RGB, HSL)
 */
export function tryParseColor(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();

  // HEX 匹配：裸 3 位 hex（如 abc/fff）误触发太多短查询，要求 # 前缀或长度>=6
  const hexMatch = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hexMatch && hexMatch[1]) {
    const rawHex = hexMatch[1];
    if (!trimmed.startsWith('#') && rawHex.length === 3) return null;
    let hex = rawHex;
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    // 8 位 HEX 的 alpha 直接展示，不静默丢弃
    const alpha = hex.length === 8 ? hex.slice(6, 8) : null;
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const fullHex = `#${hex.toUpperCase()}`;
    const rgbStr = `rgb(${r}, ${g}, ${b})`;

    return {
      type: 'color',
      title: '颜色即刻速览',
      subtitle: `${fullHex} · ${rgbStr}${alpha ? ` · alpha ${alpha}` : ''}`,
      previewValue: fullHex,
      actionLabel: '复制 HEX 色值',
      copyValue: fullHex,
      details: {
        HEX: fullHex,
        RGB: rgbStr,
        ...(alpha ? { Alpha: alpha } : {}),
      },
    };
  }

  // RGB 匹配
  const rgbMatch = trimmed.match(/^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*([\d.]+))?\)$/i);
  if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
    const r = Math.min(255, Number.parseInt(rgbMatch[1], 10));
    const g = Math.min(255, Number.parseInt(rgbMatch[2], 10));
    const b = Math.min(255, Number.parseInt(rgbMatch[3], 10));
    const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
    return {
      type: 'color',
      title: 'RGB 颜色速览',
      subtitle: `${hex} · rgb(${r}, ${g}, ${b})`,
      previewValue: hex,
      actionLabel: '复制 HEX 色值',
      copyValue: hex,
      details: {
        HEX: hex,
        RGB: `rgb(${r}, ${g}, ${b})`,
      },
    };
  }

  return null;
}

/**
 * UUID (v1/v3/v4/v5/v7) 与 ULID 结构识别及内嵌时间戳提取
 */
export function tryParseUuidOrUlid(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();

  // 1. 标准 UUID 匹配: 8-4-4-4-12
  const uuidMatch = trimmed.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([1-8][0-9a-f]{3})-([89ab][0-9a-f]{3})-([0-9a-f]{12})$/i);
  if (uuidMatch) {
    const normalized = trimmed.toLowerCase();
    const versionHex = uuidMatch[3]![0]!;
    const version = Number.parseInt(versionHex, 16);
    const details: Record<string, string> = {
      '标准格式': normalized,
      '无连字符': normalized.replace(/-/g, ''),
      'UUID 版本': `v${version}`,
      '变体 (Variant)': 'RFC 4122 / RFC 9562 (DCE 1.1)',
    };

    let subtitle = `UUID v${version} · 标准 128-bit 唯一标识符`;
    let preview = `UUID: ${normalized}\n版本: UUID v${version}`;

    // UUIDv7 前 48 bits 为 Unix 毫秒级时间戳
    if (version === 7) {
      const hexTs = uuidMatch[1]! + uuidMatch[2]!;
      const tsMs = Number.parseInt(hexTs, 16);
      if (Number.isFinite(tsMs) && tsMs > 0) {
        const iso = new Date(tsMs).toISOString();
        details['内嵌时间戳'] = `${iso} (${tsMs} ms)`;
        subtitle = `UUID v7 (时序索引) · 签发于 ${iso}`;
        preview += `\n内嵌时间: ${iso}`;
      }
    }

    return {
      type: 'uuid',
      title: `UUID v${version} 唯一标识解析`,
      subtitle,
      previewValue: preview,
      actionLabel: '复制规范 UUID',
      copyValue: normalized,
      details,
    };
  }

  // 2. Crockford Base32 ULID 匹配 (26 位，首字符 0-7)
  const ulidMatch = trimmed.match(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i);
  if (ulidMatch) {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const upper = trimmed.toUpperCase();
    let timeMs = 0;
    for (let i = 0; i < 10; i++) {
      const idx = alphabet.indexOf(upper[i]!);
      if (idx < 0) return null;
      timeMs = timeMs * 32 + idx;
    }
    const date = new Date(timeMs);
    if (date.getFullYear() < 1990 || date.getFullYear() > 2100) return null;
    const iso = date.toISOString();
    return {
      type: 'uuid',
      title: 'ULID 字典序唯一标识解析',
      subtitle: `128-bit ULID · 签发时间 ${iso}`,
      previewValue: `ULID: ${upper}\n签发时间 (UTC): ${iso}\nUnix 毫秒: ${timeMs}`,
      actionLabel: '复制标准 ULID',
      copyValue: upper,
      details: {
        ULID: upper,
        '内嵌时间 (UTC)': iso,
        'Unix 毫秒': String(timeMs),
      },
    };
  }

  return null;
}

/**
 * 存储容量 / 字节单位即时换算 (e.g., 1048576 bytes, 16 GB, 512 MiB)
 */
export function tryParseByteSize(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*(b|byte|bytes|kb|kib|mb|mib|gb|gib|tb|tib)$/i);
  if (!m) return null;

  const val = Number.parseFloat(m[1]!);
  if (!Number.isFinite(val) || val < 0) return null;
  const unit = m[2]!.toLowerCase();

  const unitMultipliers: Record<string, number> = {
    b: 1,
    byte: 1,
    bytes: 1,
    kb: 1000,
    kib: 1024,
    mb: 1000 ** 2,
    mib: 1024 ** 2,
    gb: 1000 ** 3,
    gib: 1024 ** 3,
    tb: 1000 ** 4,
    tib: 1024 ** 4,
  };

  const bytes = val * (unitMultipliers[unit] ?? 1);
  const kib = bytes / 1024;
  const mib = bytes / (1024 ** 2);
  const gib = bytes / (1024 ** 3);
  const tib = bytes / (1024 ** 4);

  const fmt = (n: number) => (n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4).replace(/\.?0+$/, '') : n.toPrecision(3));
  const preview = `${Math.round(bytes).toLocaleString()} Bytes\n= ${fmt(kib)} KiB | ${fmt(mib)} MiB | ${fmt(gib)} GiB`;

  return {
    type: 'byte_size',
    title: '存储容量与字节单位换算',
    subtitle: `${trimmed} = ${Math.round(bytes).toLocaleString()} Bytes`,
    previewValue: preview,
    actionLabel: '复制字节数 (Bytes)',
    copyValue: String(Math.round(bytes)),
    details: {
      Bytes: `${Math.round(bytes).toLocaleString()} B`,
      'KiB (1024)': `${fmt(kib)} KiB`,
      'MiB (1024²)': `${fmt(mib)} MiB`,
      'GiB (1024³)': `${fmt(gib)} GiB`,
      'TiB (1024⁴)': `${fmt(tib)} TiB`,
    },
  };
}
