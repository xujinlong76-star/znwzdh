import { describe, expect, it } from "vitest";
import {
  KEY_LENGTH_BITS,
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  VAULT_IV_LENGTH_BYTES,
  VAULT_SALT_LENGTH_BYTES,
  decryptVault,
  encryptVault,
  measureVaultDeriveMs,
} from "../src/lib/vault";
import { tamperCiphertextBase64 } from "../src/lib/lab-vault";

const DEMO_ITEMS = [
  {
    id: "1",
    title: "内部 GitLab 敏捷看板",
    url: "https://gitlab.corp.internal/board",
    isInternal: true,
  },
  {
    id: "2",
    title: "生产数据库只读审计",
    url: "https://10.0.8.50:9000/db",
    isInternal: true,
  },
];
const PASSWORD = "DemoPass123!";

describe("W1-3 Vault 验证器：KDF 公开常量", () => {
  it("公开 KDF 参数与实现一致", () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    expect(PBKDF2_HASH).toBe("SHA-256");
    expect(KEY_LENGTH_BITS).toBe(256);
    expect(VAULT_SALT_LENGTH_BYTES).toBe(16);
    expect(VAULT_IV_LENGTH_BYTES).toBe(12);
  });
});
describe("W1-3 Vault 验证器：篡改密文一位", () => {
  it("替换首个合法 Base64 字符并报告位置与前后字符", () => {
    const result = tamperCiphertextBase64("Ab3dEf==");
    expect(result.position).toBe(0);
    expect(result.from).toBe("A");
    expect(result.to).toBe("B");
    expect(result.tampered).toBe("Bb3dEf==");
    expect(result.tampered.length).toBe("Ab3dEf==".length);
  });

  it("只改一位：其余字符与长度都不变", () => {
    const src = "xQ7vK9mN2pL8w==";
    const result = tamperCiphertextBase64(src);
    const diffs = [...src].filter((c, i) => c !== result.tampered[i]);
    expect(diffs).toHaveLength(1);
    expect(result.tampered).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("空密文返回 position -1 且密文不变", () => {
    const result = tamperCiphertextBase64("");
    expect(result.position).toBe(-1);
    expect(result.tampered).toBe("");
  });

  it("篡改一位后解密必失败（GCM 认证拦截），未篡改可正常还原", async () => {
    const payload = await encryptVault(DEMO_ITEMS, PASSWORD);
    expect(await decryptVault(payload, PASSWORD)).toEqual(DEMO_ITEMS);
    const { tampered, position } = tamperCiphertextBase64(
      payload.cipherTextBase64,
    );
    expect(position).toBeGreaterThanOrEqual(0);
    const bad = { ...payload, cipherTextBase64: tampered };
    await expect(decryptVault(bad, PASSWORD)).rejects.toThrow();
  });
});

describe("W1-3 Vault 验证器：派生耗时", () => {
  it("measureVaultDeriveMs 返回有限非负毫秒数", async () => {
    const ms = await measureVaultDeriveMs(PASSWORD);
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});
