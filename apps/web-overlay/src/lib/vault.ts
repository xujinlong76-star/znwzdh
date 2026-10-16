/**
 * 客户端零知识端到端加密金库适配器
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

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;

// TS 5.7+ 的 TypedArray 泛型化：注解裸 Uint8Array 会退化为 Uint8Array<ArrayBufferLike>，
// 不再满足 WebCrypto 的 BufferSource（= ArrayBufferView<ArrayBuffer>），故显式标注。
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
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

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
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

function getCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  if (typeof window !== 'undefined' && window.crypto) {
    return window.crypto;
  }
  throw new Error('当前运行环境不支持 Web Cryptography API');
}

export async function deriveVaultKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const crypto = getCrypto();
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
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

export async function encryptVault(
  items: VaultItem[],
  passphrase: string
): Promise<EncryptedVaultPayload> {
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error('密码不能为空');
  }

  const crypto = getCrypto();
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const key = await deriveVaultKey(passphrase, salt);

  const plaintextStr = JSON.stringify(items);
  const plaintextBytes = new TextEncoder().encode(plaintextStr);

  const cipherBuffer = await crypto.subtle.encrypt(
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

export async function decryptVault(
  payload: EncryptedVaultPayload,
  passphrase: string
): Promise<VaultItem[]> {
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error('密码不能为空');
  }

  const crypto = getCrypto();
  const salt = hexToBytes(payload.saltHex);
  const iv = hexToBytes(payload.ivHex);
  const cipherBytes = base64ToBytes(payload.cipherTextBase64);

  const key = await deriveVaultKey(passphrase, salt);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
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

  const crypto = getCrypto();
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const key = await deriveVaultKey(passphrase, salt);

  const plaintextStr = JSON.stringify(data);
  const plaintextBytes = new TextEncoder().encode(plaintextStr);

  const cipherBuffer = await crypto.subtle.encrypt(
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

  const crypto = getCrypto();
  const salt = hexToBytes(payload.saltHex);
  const iv = hexToBytes(payload.ivHex);
  const cipherBytes = base64ToBytes(payload.cipherTextBase64);

  const key = await deriveVaultKey(passphrase, salt);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
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

