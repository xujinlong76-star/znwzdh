import { expect, test } from '@playwright/test';
import { awaitContentReady } from './helpers';

/**
 * 算法实验室冒烟（第五批 A1 安全网）：12 个实验区逐个切换，
 * 每区断言其标志性标题可见——拆分（2216 行巨石 → 12 面板）前后行为等价的运行级证明。
 */

const SECTIONS: Array<{ tab: string; anchor: string }> = [
  { tab: 'LinUCB', anchor: 'LinUCB 情境自适应多臂融合实时推演' },
  { tab: '庞加莱平替', anchor: '庞加莱双曲圆盘（Poincaré Disk）平替拓扑推导' },
  { tab: '文本熵巡检', anchor: 'Shannon 文本信息熵与防虚假 200 巡检引擎' },
  { tab: '0-RTT 推测', anchor: '0-RTT 推测意图预执行试验台' },
  { tab: 'E2EE 金库', anchor: '本地优先零知识 E2EE 端到端加密金库' },
  { tab: '知识星图', anchor: '技术栈知识拓扑图谱与双向 Dijkstra 寻路' },
  { tab: '视觉指纹', anchor: '视觉指纹分析与 WCAG 2.1 色彩和谐度' },
  { tab: 'WebMCP', anchor: '浏览器端端侧 WebMCP JSON-RPC 2.0 通信总线' },
  { tab: '差分隐私', anchor: '本地差分隐私 (LDP Laplace) 协同推荐引擎' },
  { tab: '推测预渲染', anchor: 'W3C Speculation Rules 自适应推测预渲染编译器' },
  { tab: '工具合成', anchor: '动态 WebMCP 工具合成器与严苛 SSRF 纵深防护沙箱' },
  { tab: 'P2P共识', anchor: 'P2P Mesh 去中心化 CRDT 状态向量共识测试台' },
];

test('算法实验室：12 个实验区逐区渲染各自标志内容', async ({ page }) => {
  await page.goto('/algorithms', { waitUntil: 'domcontentloaded' });
  await awaitContentReady(page, page.getByText('前沿自适应算法与认知引擎全景测试台'));

  // 首个 tab（LinUCB）默认渲染
  await expect(page.getByText(SECTIONS[0]!.anchor)).toBeVisible({ timeout: 30_000 });

  for (const { tab, anchor } of SECTIONS.slice(1)) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    await expect(page.getByText(anchor).first()).toBeVisible({ timeout: 15_000 });
  }
  // 切回第一个，确认来回切换不丢状态/不崩
  await page.getByRole('tab', { name: /^LinUCB/ }).click();
  await expect(page.getByText(SECTIONS[0]!.anchor)).toBeVisible({ timeout: 15_000 });
});
