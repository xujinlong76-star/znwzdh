import { describe, it, expect } from 'vitest';
import {
  parseSpeculativeIntent,
  extractContextFeatures,
  createLinUCBModel,
  predictArmWeights,
  updateArmReward,
  invertMatrix,
  matVecMul,
  serializeLinUCB,
  deserializeLinUCB,
  poincareDistance,
  expMap0,
  logMap0,
  mobiusAdd,
  computeHyperbolicAlternativeScore,
  findTopAlternativesInHyperbolicSpace,
  calculateShannonEntropy,
  hammingDistance64,
  auditPageHealth,
} from '../src/index.ts';

describe('推测性意图 0-RTT 预执行引擎 (Speculative Intent)', () => {
  it('应当准确解码标准 Base64 字符串', () => {
    // "SGVsbG8gV29ybGQ=" -> "Hello World"
    const res = parseSpeculativeIntent('SGVsbG8gV29ybGQ=');
    expect(res).not.toBeNull();
    expect(res?.type).toBe('base64_decode');
    expect(res?.previewValue).toBe('Hello World');
    expect(res?.actionLabel).toBe('复制解码内容');
  });

  it('应当响应显式 b64: 前缀与 b64e: 编码前缀', () => {
    const enc = parseSpeculativeIntent('b64e: NavHub');
    expect(enc?.type).toBe('base64_encode');
    expect(enc?.previewValue).toBe(Buffer.from('NavHub').toString('base64'));

    const dec = parseSpeculativeIntent('b64: TmF2SHVi');
    expect(dec?.type).toBe('base64_decode');
    expect(dec?.previewValue).toBe('NavHub');
  });

  it('应当解析 Unix 时间戳（秒级与毫秒级）', () => {
    // 1710328900 秒 = 2024-03-13T11:21:40.000Z
    const resSec = parseSpeculativeIntent('1710328900');
    expect(resSec).not.toBeNull();
    expect(resSec?.type).toBe('timestamp');
    expect(resSec?.details?.['Unix 秒']).toBe('1710328900');

    // 毫秒级
    const resMs = parseSpeculativeIntent('1710328900000');
    expect(resMs?.type).toBe('timestamp');
    expect(resMs?.details?.['Unix 毫秒']).toBe('1710328900000');
  });

  it('应当识别 HEX 与 RGB 颜色并生成速览', () => {
    const hex = parseSpeculativeIntent('#ff4500');
    expect(hex?.type).toBe('color');
    expect(hex?.previewValue).toBe('#FF4500');

    const rgb = parseSpeculativeIntent('rgb(255, 69, 0)');
    expect(rgb?.type).toBe('color');
    expect(rgb?.previewValue).toBe('#FF4500');
  });

  it('应当安全计算算术表达式且杜绝任意代码执行', () => {
    const math1 = parseSpeculativeIntent('(100 + 28) * 8');
    expect(math1?.type).toBe('math');
    expect(math1?.previewValue).toBe('1024');

    const math2 = parseSpeculativeIntent('2^10');
    expect(math2?.type).toBe('math');
    expect(math2?.previewValue).toBe('1024');

    // 非法或含变量代码不应被执行
    const invalid = parseSpeculativeIntent('alert(1) + 2');
    expect(invalid).toBeNull();
  });

  it('应当验证并格式化有效 JSON', () => {
    const jsonRes = parseSpeculativeIntent('{"name":"navhub","v":4}');
    expect(jsonRes?.type).toBe('json_format');
    expect(jsonRes?.copyValue).toContain('"name": "navhub"');
  });

  it('应当识别哈希指纹长度（MD5 与 SHA-256）', () => {
    const md5 = parseSpeculativeIntent('e10adc3949ba59abbe56e057f20f883e');
    expect(md5?.type).toBe('hash_detect');
    expect(md5?.title).toContain('MD5');

    const sha256 = parseSpeculativeIntent(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256?.type).toBe('hash_detect');
    expect(sha256?.title).toContain('SHA-256');
  });

  it('常规导航查询应当回退为 null', () => {
    expect(parseSpeculativeIntent('github')).toBeNull();
    expect(parseSpeculativeIntent('react 官网')).toBeNull();
  });
});

describe('LinUCB 情境自适应多通道融合引擎', () => {
  it('应当精准提取查询特征向量', () => {
    const cjkVec = extractContextFeatures('自然语言处理技术');
    expect(cjkVec[1]).toBe(1.0); // cjkRatio
    expect(cjkVec[2]).toBe(0.0); // alphaRatio

    const pyVec = extractContextFeatures('wangzhi');
    expect(pyVec[2]).toBe(1.0); // alphaRatio
    expect(pyVec[3]).toBe(1.0); // pinyinLikelihood
  });

  it('求逆矩阵函数满足 A * A^(-1) = I', () => {
    const mat = [
      [2, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ];
    const inv = invertMatrix(mat);
    const id = mat.map((row) => matVecMul(inv, row));
    // 对角线为 1，非对角线为 0
    expect(id[0][0]).toBeCloseTo(1.0, 4);
    expect(id[1][1]).toBeCloseTo(1.0, 4);
    expect(id[2][2]).toBeCloseTo(1.0, 4);
    expect(id[0][1]).toBeCloseTo(0.0, 4);
  });

  it('LinUCB 能够基于特征预测通道权重并在反馈后学习更新', () => {
    const model = createLinUCBModel(0.2);
    const initWeights = predictArmWeights(model, 'csdn');
    expect(initWeights.exact).toBeGreaterThan(0);
    expect(initWeights.pinyin).toBeGreaterThan(0);

    // 模拟用户在拼音模式下持续采纳 pinyin 通道
    for (let i = 0; i < 5; i++) {
      updateArmReward(model, 'pinyin', 'csdn', 1.0);
    }

    const updatedWeights = predictArmWeights(model, 'csdn');
    // pinyin 通道的权重应显著增加
    expect(updatedWeights.pinyin).toBeGreaterThan(initWeights.pinyin);
  });

  it('模型支持 JSON 序列化与反序列化持久存储', () => {
    const model = createLinUCBModel();
    updateArmReward(model, 'fts', 'test', 1.0);
    const serialized = serializeLinUCB(model);
    const restored = deserializeLinUCB(serialized);
    expect(restored.arms.fts.b[0]).toBe(model.arms.fts.b[0]);
  });
});

describe('庞加莱双曲空间度量与平替推理引擎', () => {
  it('测地线距离应当满足恒等律与对称性', () => {
    const u = [0.2, 0.3];
    const v = [-0.1, 0.4];
    expect(poincareDistance(u, u)).toBeCloseTo(0.0, 5);
    expect(poincareDistance(u, v)).toBeCloseTo(poincareDistance(v, u), 5);
  });

  it('越靠近庞加莱球边界，欧氏微小距离的双曲距离越大', () => {
    // 中心点微小距离
    const centerA = [0.0, 0.0];
    const centerB = [0.1, 0.0];
    const distCenter = poincareDistance(centerA, centerB);

    // 边缘点微小距离 (同样欧式位移 0.1)
    const edgeA = [0.85, 0.0];
    const edgeB = [0.95, 0.0];
    const distEdge = poincareDistance(edgeA, edgeB);

    expect(distEdge).toBeGreaterThan(distCenter * 2);
  });

  it('指数映射与对数映射在原点附近互为逆运算', () => {
    const tangent = [0.3, -0.4];
    const inBall = expMap0(tangent);
    const recovered = logMap0(inBall);
    expect(recovered[0]).toBeCloseTo(tangent[0], 4);
    expect(recovered[1]).toBeCloseTo(tangent[1], 4);
  });

  it('平替评分能同时考虑测地线距离与模长抽象深度一致性', () => {
    // React 与 Vue：同处深层框架级别 (模长相当，且距离近)
    const react = [0.7, 0.2];
    const vue = [0.68, 0.22];
    const scoreClose = computeHyperbolicAlternativeScore(react, vue);

    // React 与前端大类根节点：模长差异大
    const frontendRoot = [0.1, 0.05];
    const scoreRoot = computeHyperbolicAlternativeScore(react, frontendRoot);

    expect(scoreClose).toBeGreaterThan(scoreRoot);
  });

  it('能够在候选集合中正确推导 Top-K 最佳双曲平替', () => {
    const target = { id: 'react', name: 'React', embedding: [0.7, 0.2] };
    const candidates = [
      { id: 'vue', name: 'Vue', embedding: [0.68, 0.22] },
      { id: 'svelte', name: 'Svelte', embedding: [0.65, 0.25] },
      { id: 'docker', name: 'Docker', embedding: [-0.6, -0.5] },
    ];
    const alts = findTopAlternativesInHyperbolicSpace(target, candidates, 2);
    expect(alts.length).toBe(2);
    expect(alts[0].name).toBe('Vue');
    expect(alts[1].name).toBe('Svelte');
  });
});

describe('页面视觉感知防劫持与软 404 巡检引擎', () => {
  it('应当准确计算 Shannon 文本信息熵', () => {
    // 单一字符重复信息熵为 0
    expect(calculateShannonEntropy('aaaaaaaa')).toBe(0.0);

    // 自然多样文本信息熵大于 3.0
    const normalText = 'NavHub 是专为开发者打造的下一代智能认知型网址导航中枢平台';
    expect(calculateShannonEntropy(normalText)).toBeGreaterThan(3.0);
  });

  it('应当计算正确的 64 位感知哈希汉明距离', () => {
    const hashA = '0000000000000000';
    const hashB = '0000000000000001';
    expect(hammingDistance64(hashA, hashB)).toBe(1);

    const hashF = 'ffffffffffffffff';
    expect(hammingDistance64(hashA, hashF)).toBe(64);
  });

  it('应当精准识破域名停放广告与假 200 软 404', () => {
    const parkedHtml = `
      <html>
        <body>
          <h1>This domain is for sale! Buy this domain on Dan.com</h1>
          <p>Renew this domain or inquire about this domain.</p>
        </body>
      </html>
    `;
    const audit1 = auditPageHealth('https://example-parked.com', parkedHtml);
    expect(audit1.status).toBe('SUSPICIOUS_PARKED');
    expect(audit1.matchedParkingKeywords.length).toBeGreaterThan(0);

    const normalHtml = `
      <html>
        <body>
          <h1>React 官方中文文档</h1>
          <p>用于构建 Web 和原生交互界面的 JavaScript 库。组件化思想与虚拟 DOM 体系让前端开发更加模块化与健壮。</p>
          <pre>npm install react react-dom</pre>
        </body>
      </html>
    `;
    const audit2 = auditPageHealth('https://zh-hans.react.dev', normalHtml);
    expect(audit2.status).toBe('HEALTHY');
  });

  it('应当通过视觉感知哈希汉明距离识破停放模板', () => {
    const templateHash = 'a1b2c3d4e5f60718';
    const pageHash = 'a1b2c3d4e5f60719'; // 汉明距离仅为 1
    const audit = auditPageHealth(
      'https://spoofed.com',
      '<html><body>Welcome to portal</body></html>',
      pageHash,
      [templateHash]
    );
    expect(audit.status).toBe('SUSPICIOUS_PARKED');
    expect(audit.minHammingDistance).toBe(1);
  });
});
