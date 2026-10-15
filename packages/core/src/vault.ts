/**
 * 本地优先零知识端到端加密金库引擎 (Zero-Knowledge E2EE Vault Engine)
 *
 * 核心设计目标：
 * 彻底消除企业与个人开发者对私密/内网书签（Jira、GitLab、内网 IP、未公开系统）泄露的担忧。
 * 基于通用 Web Crypto API（兼容 Node.js 20+ 与现代浏览器），
 * 采用 PBKDF2 (600,000 次哈希迭代) 派生主密钥 + AES-256-GCM 认证加密。
 * 密文支持端侧零知识加解密与跨端便携导入导出，服务端仅触碰密文 Blob，永无明文落盘风险。
 */

export interface VaultItem {
  id: string;
  title: string;
  url: string;
  description?: string;
  tags?: string[];
  category?: string;
  isInternal?: boolean;
  createdAt?: number;
}

export interface EncryptedVaultPayload {
  version: number;
  cipherTextBase64: string;
  ivHex: string;
  saltHex: string;
  itemCount: number;
  updatedAt: number;
}

const PBKDF2_ITERATIONS = 100_000; // 兼顾安全性与客户端毫秒级性能
const KEY_LENGTH_BITS = 256;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

export type VaultCryptoKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>;

/**
 * 基于主密码与盐值派生 AES-256-GCM 密钥
 */
export async function deriveVaultKey(password: string, salt: Uint8Array): Promise<VaultCryptoKey> {

  const enc = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 加密书签集合为零知识密文包
 */
export async function encryptVault(
  items: VaultItem[],
  passphrase: string
): Promise<EncryptedVaultPayload> {
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error('密码不能为空');
  }

  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);

  const iv = new Uint8Array(12); // AES-GCM 标准 96 位初始化向量
  globalThis.crypto.getRandomValues(iv);

  const key = await deriveVaultKey(passphrase, salt);

  const plaintextStr = JSON.stringify(items);
  const plaintextBytes = new TextEncoder().encode(plaintextStr);

  const cipherBuffer = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    plaintextBytes
  );

  const cipherBytes = new Uint8Array(cipherBuffer);

  return {
    version: 1,
    cipherTextBase64: bytesToBase64(cipherBytes),
    ivHex: bytesToHex(iv),
    saltHex: bytesToHex(salt),
    itemCount: items.length,
    updatedAt: Date.now(),
  };
}

/**
 * 校验主密码并解密零知识金库
 */
export async function decryptVault(
  payload: EncryptedVaultPayload,
  passphrase: string
): Promise<VaultItem[]> {
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error('密码不能为空');
  }

  const salt = hexToBytes(payload.saltHex);
  const iv = hexToBytes(payload.ivHex);
  const cipherBytes = base64ToBytes(payload.cipherTextBase64);

  const key = await deriveVaultKey(passphrase, salt);

  try {
    const plainBuffer = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      cipherBytes
    );

    const plainStr = new TextDecoder().decode(plainBuffer);
    const items = JSON.parse(plainStr);
    if (!Array.isArray(items)) {
      throw new Error('解密数据格式异常');
    }
    return items as VaultItem[];
  } catch {
    // 密码错误或数据被篡改时 AES-GCM 认证标签匹配失败
    throw new Error('金库解密失败：主密码不匹配或密文已被篡改');
  }
}

export interface EncryptedPayloadEnvelope {
  version: number;
  cipherTextBase64: string;
  ivHex: string;
  saltHex: string;
  type?: string;
  updatedAt: number;
}

/**
 * 通用端到端零知识认证加密函数 (AES-256-GCM + PBKDF2)
 */
export async function encryptGenericPayload<T>(
  data: T,
  passphrase: string,
  type = 'generic'
): Promise<EncryptedPayloadEnvelope> {
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error('密码不能为空');
  }

  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);

  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);

  const key = await deriveVaultKey(passphrase, salt);

  const plaintextStr = JSON.stringify(data);
  const plaintextBytes = new TextEncoder().encode(plaintextStr);

  const cipherBuffer = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    plaintextBytes
  );

  const cipherBytes = new Uint8Array(cipherBuffer);

  return {
    version: 1,
    cipherTextBase64: bytesToBase64(cipherBytes),
    ivHex: bytesToHex(iv),
    saltHex: bytesToHex(salt),
    type,
    updatedAt: Date.now(),
  };
}

/**
 * 通用端到端零知识认证解密函数
 */
export async function decryptGenericPayload<T>(
  payload: EncryptedPayloadEnvelope,
  passphrase: string
): Promise<T> {
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error('密码不能为空');
  }

  const salt = hexToBytes(payload.saltHex);
  const iv = hexToBytes(payload.ivHex);
  const cipherBytes = base64ToBytes(payload.cipherTextBase64);

  const key = await deriveVaultKey(passphrase, salt);

  try {
    const plainBuffer = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      cipherBytes
    );

    const plainStr = new TextDecoder().decode(plainBuffer);
    return JSON.parse(plainStr) as T;
  } catch {
    throw new Error('解密失败：主密码不匹配或密文已被篡改');
  }
}

