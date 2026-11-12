/**
 * W1-3 Vault 验证器：实验室用篡改助手。
 *
 * 把一段 Base64 密文的某一位改成另一个合法 Base64 字符，用于演示
 * AES-GCM 认证标签对篡改的拦截。替换后仍是合法 Base64（长度不变、
 * 字符仍在字母表内），但解码字节改变，解密时 GCM 标签校验必然失败。
 */
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export interface TamperedCiphertext {
  tampered: string;
  position: number;
  from: string;
  to: string;
}

/**
 * 把密文首个合法 Base64 字符替换为字母表中下一个字符。
 * 密文为空或不含合法 Base64 字符时返回 position -1 且密文不变。
 */
export function tamperCiphertextBase64(
  cipherTextBase64: string,
): TamperedCiphertext {
  const chars = cipherTextBase64.split("");
  for (let i = 0; i < chars.length; i += 1) {
    const idx = BASE64_ALPHABET.indexOf(chars[i]);
    if (idx < 0) continue;
    const from = chars[i];
    const to = BASE64_ALPHABET[(idx + 1) % BASE64_ALPHABET.length];
    chars[i] = to;
    return { tampered: chars.join(""), position: i, from, to };
  }
  return { tampered: cipherTextBase64, position: -1, from: "", to: "" };
}
