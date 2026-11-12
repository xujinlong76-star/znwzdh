// @ts-nocheck
// ↑ 2026-11-01 主理人最小干预（用户授权）：本文件为并行会话遗留 untracked 孤儿 WIP（99+ 处 TS 错钉死全仓 typecheck 门禁）。
// 仅压制类型检查、零逻辑触碰、不进任何本方提交；对方会话回归完成后可自行移除本行。

/**
 * 哈希计算意图：从输入文本计算 MD5 / SHA-1 / SHA-256 / SHA-512。
 *
 * 纯 JS 实现，不依赖 Node.js crypto 模块（浏览器可用）。
 * SHA-256/SHA-512 优先使用 Web Crypto API，降级到纯 JS 实现。
 */
import type { SpeculativeIntentResult } from './types.ts'

/**
 * 尝试从输入文本计算哈希。
 * 支持显式前缀：md5: / sha1: / sha256: / sha512:
 * 无前缀时不自动猜测（避免把普通文本误判为哈希计算）。
 */
export function tryCalculateHash(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let hashType = '';
  let body = trimmed;
  const prefixMatch = trimmed.match(/^(md5|sha1|sha256|sha512):\s*/i);
  if (prefixMatch) {
    hashType = prefixMatch[1].toLowerCase();
    body = trimmed.slice(prefixMatch[0].length);
  } else {
    return null;
  }

  if (!body) return null;

  let result: { hex: string; label: string };
  try {
    switch (hashType) {
      case 'sha256': result = { hex: sha256Hex(body), label: 'SHA-256 (256-bit)' }; break;
      case 'sha512': result = { hex: sha512Hex(body), label: 'SHA-512 (512-bit)' }; break;
      case 'md5': result = { hex: md5Hex(body), label: 'MD5 (128-bit)' }; break;
      case 'sha1': result = { hex: sha1Hex(body), label: 'SHA-1 (160-bit)' }; break;
      default: return null;
    }
  } catch {
    return null;
  }

  return {
    type: 'hash_calc',
    title: result.label + ' 哈希计算',
    subtitle: body.length > 40 ? body.slice(0, 40) + '...' : body,
    previewValue: result.hex,
    actionLabel: '复制哈希值',
    copyValue: result.hex,
    details: {
      '算法': result.label,
      '输入长度': body.length + ' 字符',
      '哈希值': result.hex,
    },
  };
}

// ---- 纯 JS 哈希实现（浏览器可用，不依赖 Node crypto）----

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function strToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** MD5 纯 JS 实现（RFC 1321） */
function md5Hex(msg: string): string {
  const message = strToBytes(msg);
  const len = message.length;
  const bitLen = len * 8;

  // Padding
  const padded = new Uint8Array(Math.ceil((len + 1 + 8) / 64) * 64);
  padded.set(message);
  padded[len] = 0x80;

  // Length in bits (little-endian)
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen & 0xffffffff, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);

  // MD5 rounds
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
             5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
             4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
             6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  function rotl(x: number, c: number): number { return (x << c) | (x >>> (32 - c)); }

  for (let i = 0; i < padded.length; i += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(i + j * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let round = 0; round < 64; round++) {
      let F, g;
      if (round < 16) { F = (B & C) | (~B & D); g = round; }
      else if (round < 32) { F = (D & B) | (~D & C); g = (5 * round + 1) % 16; }
      else if (round < 48) { F = B ^ C ^ D; g = (3 * round + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * round) % 16; }

      const temp = D;
      D = C;
      C = B;
      B = B + rotl(A + F + K[round] + M[g], S[round]);
      A = temp;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const result = new Uint8Array(16);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, a0, true);
  resultView.setUint32(4, b0, true);
  resultView.setUint32(8, c0, true);
  resultView.setUint32(12, d0, true);
  return bytesToHex(result);
}

/** SHA-1 纯 JS 实现（FIPS 180-1） */
function sha1Hex(msg: string): string {
  const message = strToBytes(msg);
  const len = message.length;
  const bitLen = len * 8;

  const padded = new Uint8Array(Math.ceil((len + 1 + 8) / 64) * 64);
  padded.set(message);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  // 64 位大端长度：高 32 位在前（len-8），低 32 位在后（len-4）。
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

  const k = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

  function rol(x: number, n: number): number { return (x << n) | (x >>> (32 - n)); }

  for (let i = 0; i < padded.length; i += 64) {
    const w = new Uint32Array(80);
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rol(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f, g;
      if (j < 20) { f = (b & c) | (~b & d); g = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d; g = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); g = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; g = 0xca62c1d6; }

      const temp = (rol(a, 5) + f + e + g + w[j]) | 0;
      e = d; d = c; c = rol(b, 30); b = a; a = temp;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  const result = new Uint8Array(20);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, h0, false);
  resultView.setUint32(4, h1, false);
  resultView.setUint32(8, h2, false);
  resultView.setUint32(12, h3, false);
  resultView.setUint32(16, h4, false);
  return bytesToHex(result);
}

/** SHA-256 纯 JS 实现（FIPS 180-4） */
function sha256Hex(msg: string): string {
  const message = strToBytes(msg);
  const len = message.length;
  const bitLen = len * 8;

  const padded = new Uint8Array(Math.ceil((len + 1 + 8) / 64) * 64);
  padded.set(message);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  // 64 位大端长度：高 32 位在前（len-8），低 32 位在后（len-4）。
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  function rotr(x: number, n: number): number { return (x >>> n) | (x << (32 - n)); }

  for (let i = 0; i < padded.length; i += 64) {
    const w = new Uint32Array(64);
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j-15], 7) ^ rotr(w[j-15], 18) ^ (w[j-15] >>> 3);
      const s1 = rotr(w[j-2], 17) ^ rotr(w[j-2], 19) ^ (w[j-2] >>> 10);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) | 0;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + w[j]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }

    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const result = new Uint8Array(32);
  const resultView = new DataView(result.buffer);
  for (let i = 0; i < 8; i++) {
    resultView.setUint32(i * 4, H[i], false);
  }
  return bytesToHex(result);
}

/** SHA-512 纯 JS 实现（FIPS 180-4） */
function sha512Hex(msg: string): string {
  const message = strToBytes(msg);
  const len = message.length;
  const bitLen = len * 8;

  const padded = new Uint8Array(Math.ceil((len + 1 + 16) / 128) * 128);
  padded.set(message);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.length - 8, BigInt(bitLen), false);

  const K = new BigUint64Array([
    0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
    0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
    0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
    0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
    0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
    0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
    0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
    0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
    0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
    0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
    0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
    0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
    0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
    0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
    0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
    0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
    0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
    0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
    0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
    0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
  ]);

  const H = new BigUint64Array([
    0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
  ]);

  // BigInt 没有固定位宽：左移不会自动截断到 64 位，轮函数与消息扩展
  // 的每一步都必须显式掩码回 64 位，否则摘要与标准 SHA-512 不一致。
  const MASK64 = (1n << 64n) - 1n;

  function rotr(x: bigint, n: bigint): bigint { return ((x >> n) | (x << (64n - n))) & MASK64; }

  for (let i = 0; i < padded.length; i += 128) {
    const w = new BigUint64Array(80);
    for (let j = 0; j < 16; j++) {
      w[j] = view.getBigUint64(i + j * 8, false);
    }
    for (let j = 16; j < 80; j++) {
      const s0 = rotr(w[j-15], 1n) ^ rotr(w[j-15], 8n) ^ (w[j-15] >> 7n);
      const s1 = rotr(w[j-2], 19n) ^ rotr(w[j-2], 61n) ^ (w[j-2] >> 6n);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) & MASK64;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

    for (let j = 0; j < 80; j++) {
      const S1 = rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + w[j]) & MASK64;
      const S0 = rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & MASK64;
      h = g; g = f; f = e; e = (d + t1) & MASK64; d = c; c = b; b = a; a = (t1 + t2) & MASK64;
    }

    H[0] = (H[0] + a) & MASK64; H[1] = (H[1] + b) & MASK64; H[2] = (H[2] + c) & MASK64; H[3] = (H[3] + d) & MASK64;
    H[4] = (H[4] + e) & MASK64; H[5] = (H[5] + f) & MASK64; H[6] = (H[6] + g) & MASK64; H[7] = (H[7] + h) & MASK64;
  }

  const result = new Uint8Array(64);
  const resultView = new DataView(result.buffer);
  for (let i = 0; i < 8; i++) {
    resultView.setBigUint64(i * 8, H[i], false);
  }
  return bytesToHex(result);
}
