import { describe, it, expect } from 'vitest';
import {
  encryptVault,
  decryptVault,
  encryptGenericPayload,
  decryptGenericPayload,
  calculateMotionVector,
  isHeadingTowardsRect,
  extractSafeOrigin,
  shouldPreconnectOrigin,
  type VaultItem,
} from '../src/index.ts';

describe('本地优先零知识 E2EE 加密金库引擎 (Vault Engine)', () => {
  const sampleItems: VaultItem[] = [
    {
      id: 'jira-internal',
      title: '内部 Jira 敏捷看板',
      url: 'https://jira.corp.internal/secure/RapidBoard.jspa',
      description: '企业内网敏感敏捷研发任务看板',
      tags: ['内网', '研发'],
      isInternal: true,
    },
    {
      id: 'vault-prod-db',
      title: '生产环境只读控制台',
      url: 'https://10.10.20.100:8443/admin',
      isInternal: true,
    },
  ];

  it('使用主密码可完整加密并在正确密码下还原所有私密书签', async () => {
    const password = 'SuperSecretDevPassword!2026';
    const encrypted = await encryptVault(sampleItems, password);

    expect(encrypted.version).toBe(1);
    expect(encrypted.itemCount).toBe(2);
    expect(encrypted.cipherTextBase64).toBeTruthy();
    expect(encrypted.ivHex.length).toBe(24); // 12 bytes = 24 hex
    expect(encrypted.saltHex.length).toBe(32); // 16 bytes = 32 hex

    // 正确解密
    const decrypted = await decryptVault(encrypted, password);
    expect(decrypted.length).toBe(2);
    expect(decrypted[0]?.title).toBe('内部 Jira 敏捷看板');
    expect(decrypted[1]?.url).toBe('https://10.10.20.100:8443/admin');
  });

  it('使用错误密码解密时必须坚决拒绝并抛出安全异常', async () => {
    const password = 'CorrectPassword123';
    const encrypted = await encryptVault(sampleItems, password);

    await expect(decryptVault(encrypted, 'WrongPassword456')).rejects.toThrow(
      '金库解密失败'
    );
  });

  it('密文遭受任何单字节篡改时，AES-GCM 认证标签校验失败并抛错', async () => {
    const password = 'MyPassword';
    const encrypted = await encryptVault(sampleItems, password);

    // 篡改密文字符串的正文字符（确定性改变密文字节流）
    const tamperedCipher =
      (encrypted.cipherTextBase64[0] === 'A' ? 'B' : 'A') +
      encrypted.cipherTextBase64.slice(1);

    const tamperedPayload = {
      ...encrypted,
      cipherTextBase64: tamperedCipher,
    };

    await expect(decryptVault(tamperedPayload, password)).rejects.toThrow(
      '金库解密失败'
    );
  });

  it('空密码应当被禁止', async () => {
    await expect(encryptVault(sampleItems, '')).rejects.toThrow('密码不能为空');
  });

  it('支持对任意 JSON 结构进行通用零知识认证加解密 (如 DIY 布局配置)', async () => {
    const diyConfig = {
      version: 3,
      viewMode: 'hybrid',
      cardDisplayMode: 'compact',
      pinnedCategoryIds: ['ai-tools', 'dev-frameworks'],
      hiddenCategoryIds: ['news'],
      accentColor: 'violet',
      customCategories: [{ id: 'my-cat', title: '我的私密工作区', items: [] }],
    };

    const password = 'DiyVaultSecretKey#2026';
    const encrypted = await encryptGenericPayload(diyConfig, password, 'navhub_home_diy_config_v3');

    expect(encrypted.version).toBe(1);
    expect(encrypted.type).toBe('navhub_home_diy_config_v3');
    expect(encrypted.cipherTextBase64).toBeTruthy();

    // 成功解密
    const decrypted = await decryptGenericPayload<typeof diyConfig>(encrypted, password);
    expect(decrypted.version).toBe(3);
    expect(decrypted.viewMode).toBe('hybrid');
    expect(decrypted.pinnedCategoryIds).toEqual(['ai-tools', 'dev-frameworks']);
    expect(decrypted.customCategories[0]?.title).toBe('我的私密工作区');

    // 错误密码解密失败
    await expect(decryptGenericPayload(encrypted, 'WrongPassword')).rejects.toThrow('解密失败');
  });
});

describe('预测性鼠标轨迹预取与 0-RTT 物理瞬开引擎 (Prefetch Engine)', () => {
  it('计算正确的运动矢量与速度模长', () => {
    const p1 = { x: 100, y: 100, t: 1000 };
    const p2 = { x: 130, y: 140, t: 1100 }; // dt = 100ms, dx = 30, dy = 40 (3:4:5 三角形)
    const vec = calculateMotionVector(p1, p2);

    expect(vec.vx).toBeCloseTo(0.3, 4);
    expect(vec.vy).toBeCloseTo(0.4, 4);
    expect(vec.speed).toBeCloseTo(0.5, 4); // sqrt(0.3^2 + 0.4^2) = 0.5
  });

  it('当光标以一定速度直接朝向卡片移动时触发命中预测', () => {
    // 光标在 (100, 200)，目标卡片在 (250, 150) 到 (350, 250)，中心在 (300, 200)
    const current = { x: 100, y: 200 };
    const targetRect = { left: 250, top: 150, right: 350, bottom: 250 };

    // 矢量纯正向右 (vx = 0.6, vy = 0.0) -> 余弦相似度为 1.0
    const forwardVector = { vx: 0.6, vy: 0.0, speed: 0.6 };
    expect(isHeadingTowardsRect(current, forwardVector, targetRect)).toBe(true);

    // 矢量反向左移 (vx = -0.6, vy = 0.0) -> 不应命中
    const backwardVector = { vx: -0.6, vy: 0.0, speed: 0.6 };
    expect(isHeadingTowardsRect(current, backwardVector, targetRect)).toBe(false);

    // 速度太慢 (低于 0.15px/ms 临界值) -> 不应命中
    const slowVector = { vx: 0.05, vy: 0.0, speed: 0.05 };
    expect(isHeadingTowardsRect(current, slowVector, targetRect)).toBe(false);
  });

  it('精准提取有效安全 Origin 并过滤非协议与相对路径', () => {
    expect(extractSafeOrigin('https://github.com/explore/repos')).toBe(
      'https://github.com'
    );
    expect(extractSafeOrigin('http://localhost:3000/graph')).toBe(
      'http://localhost:3000'
    );
    expect(extractSafeOrigin('/relative/path')).toBeNull();
    expect(extractSafeOrigin('javascript:void(0)')).toBeNull();
  });

  it('严格控制预连接并发去重与上限', () => {
    const connected = new Set(['https://github.com', 'https://react.dev']);
    expect(shouldPreconnectOrigin('https://github.com', connected, 5)).toBe(
      false
    ); // 已连接
    expect(shouldPreconnectOrigin('https://vuejs.org', connected, 5)).toBe(true); // 新连接
    expect(shouldPreconnectOrigin('https://vuejs.org', connected, 2)).toBe(
      false
    ); // 达到连接上限
  });
});
