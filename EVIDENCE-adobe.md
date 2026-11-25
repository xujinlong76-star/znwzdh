# Adobe Color 图标实施证据（2026-11-25）

单站 worker：Adobe Color（`https://color.adobe.com`，navigation.json 标题 `Adobe Color`）。
用户 2026-11-25 19:18 拍板：用 App Store 版图标——黑底圆角方块 + 12 色色轮
（每块色是三角楔形往中心收），即“像三角形的彩色的，背景是黑色”。
分支：`feat/icons-remaining-w-adobe`（基于 `feat/icons-remaining-2026-11-25`，HEAD bef26ed）。
不推分支、不合入 main；不碰 17K小说网、书旗小说；不改 navigation.json。

## 1. 原始图标来源（App Store CDN 方形原图）

任务单给出的参考图为 App Store 预览裁切：

- 预览 URL：`https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/9e/ae/f0/9eaef096-056e-67f8-fe33-5d03249dea77/AppIcon-0-0-1x_U007ephone-0-1-0-85-220.jpeg/1200x630wa.jpg`
- 预览实测：HTTP 200、image/jpeg、39,931 B、1200×630。内容为浅灰底（RGB 248）
  卡片中央的同一色轮（中心像素 RGB (133,203,89)，与原图中心 (113,201,88)
  在 JPEG 误差内一致）——预览图本身是裁切展示图，**不作为取标源**。

取标以去掉末段后的原图 URL 为准，逐个变体实测（curl，浏览器 UA，2026-11-25）：

| 变体 | 结果 |
|---|---|
| `…/AppIcon-0-0-1x_U007ephone-0-1-0-85-220.jpeg`（无后缀） | HTTP 404、application/json、115 B |
| `…/AppIcon-…-0-1-0-85-220.png/1024x1024bb.png` | HTTP 404、application/json、227 B |
| `…/AppIcon-0-0-1x_U007ephone-0-1-0-85-220.jpeg/1024x1024bb.jpg` | **HTTP 200、image/jpeg、72,835 B、1024×1024 方形** ✅ |

采用的原始图标来源 URL（取标源）：

```
https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/9e/ae/f0/9eaef096-056e-67f8-fe33-5d03249dea77/AppIcon-0-0-1x_U007ephone-0-1-0-85-220.jpeg/1024x1024bb.jpg
```

- 尺寸：1024×1024（方形，App Store 标准 `1024x1024bb` 图标档）
- 字节：72,835 B，JPEG（JFIF），RGB
- 内容核实（Pillow 像素实测，1024 原图）：
  - 背景：四角 RGB (22,22,22) / (24,24,24) / (28,28,28) / (22,22,22)，
    四边中点约 (27,27,27)；近黑像素（通道和 <60）占采样 52.9%——黑底。
  - 色轮：中心 RGB (113,201,88) 绿；r=300 处 12 个 30° 采样点色相分别为
    72°、87°、153°、167°、205°、234°、247°、277°、350°、359°、17°、37°
    ——12 个互不相同的色相；r=250 处 5° 步进扫描色相呈阶梯状分段恒定
    （如 87° 持续 10°–40°、153° 持续 50°–80°、205° 持续 100°–130°），
    边界锐利——离散三角楔形，非平滑渐变。
  - 径向：0° 方向 r=50/150/250 均为同色系绿，r=350 起为黑底——色轮为
    收敛至中心的楔形圆盘，外围黑底。与用户确认的描述一致。
  - 未用通用 Adobe 红 A 顶替。

App Store 应用页补充核查：iTunes Lookup API
（`https://itunes.apple.com/search?term=Adobe%20Color&entity=software`）
返回 4 条，前两条为 Adobe Capture、Coolors 等，未直接返回独立 Adobe Color
应用条目——独立 Adobe Color CC 应用已并入 Adobe Capture CC（第三方应用
商店页亦载明 "Adobe Color CC is now part of Adobe Capture CC"）。本任务取标
不依赖应用页链接：mzstatic.com 为 Apple 自有 App Store CDN 域名，上述
`1024x1024bb.jpg` 变体返回的即是该应用图标的方形原图文件，内容已按
“方形、黑底、12 色三角楔形色轮”三项逐项核实通过。

## 2. adobe.com 产品页对照（未找到原始标文件，不阻塞）

- `https://color.adobe.com/`：HTTP 200、20,057 B；HTML 内图标声明仅有
  `rel="icon" href="data:,"`（空 data URI），无 apple-touch-icon、无可用
  图标文件链接。
- `https://color.adobe.com/favicon.ico`：HTTP 404。
- `https://www.adobe.com/favicon.ico`：HTTP 200（为 Adobe 通用红 A，
  非 Color 专属标，不可用——用户已明确不得用通用 Adobe 红 A 顶替）。
- 结论：color.adobe.com 站内无 Color 原始标文件；App Store 源为彩色 12 色轮
  版的唯一可用官方源。adobe.com 产品页另有深藏青底白色线形轮 SVG 版
  （见 §2b 对照），与 App Store 彩色轮版为不同渲染，不互相替代。

## 2b. 官方源对照：adobe.com 产品页 SVG（2026-11-25 浏览器实访补记）

浏览器会话在 adobe.com 官方产品页挖到的另一官方标（对照用，**不是取标源**）：

- URL：`https://www.adobe.com/cc-shared/assets/img/product-icons/svg/color-64.svg`
- 图形：深藏青圆角方块 + 白色色轮/轨道图形（白环、圆点、两条斜线），
  与产品页主视觉的标放大对比一致。
- 与 App Store 版的区别：两者都是 Adobe 官方的标，只是不同渲染——
  App Store 版为黑底 + 彩色 12 色三角楔形色轮；此 SVG 版为深藏青底 +
  白色单色线形色轮图形，无彩色楔形。用户 2026-11-25 19:18 已定按
  App Store 版做，除非他另行改口；本 SVG 只作官方源对照记录，
  不得因此改用 SVG 版，也不得把它当作 App Store 版的替代来源。
- 获取限制：该 SVG 直接 curl 会被 Adobe WAF 回 403（浏览器实访结论），
  故本 worker 未对其 curl（避免反复触发 WAF），未取回字节、未核 md5；
  需要字节级核实时须用浏览器会话取。本条不阻塞 App Store 版实施。

## 3. 设计（落盘文件）

- 文件：`apps/web-overlay/public/brand-icons/adobe-color.png`
- 生成：Pillow LANCZOS 由 1024×1024 原图直缩至 128×128（站内统一尺寸，
  与 Unsplash / Adobe Fonts 等 128×128 PNG 一致；16px 原图不放大问题
  不适用——源为 1024 方形原图，只缩小不放大）。
- 属性：128×128、RGBA（alpha 全 255，不透明）、10,693 B、
  md5 `321add7d498ab3e23f0d5e4cde805166`。
- 未改色、未重绘、未加圆角裁切：App Store `bb` 原图本身即方形满幅黑底，
  站内以 `object-contain` 渲染，黑方块形态与站内其他满幅应用图标
  （如极客公园黑底方块标）处理一致；黑底不透明，浅/深双主题均可见，
  不进 `LOGO_TILE_MAP`（无底块补丁）。
- 128 成品像素复核：四角 RGB (17,17,17) / (22,22,22) / (24,24,24) /
  (17,17,17)（通道和 ≤72）；中心 (83,239,77) 绿主导；r=32/36/40 处
  12 个 30° 采样点分属 8 个 15° 色相桶（缩后 LANCZOS 混色使 4 对相邻
  近似楔并桶，见测试注释；1024 原图上为 12 个互不相同的色相）。

## 4. 接线

- `apps/web-overlay/src/components/site-favicon.tsx`（`LOCAL_LOGO_MAP`，
  `LOCAL_LOGO_ENTRIES` 1 字符后缀编码，`p` = .png）：新增
  `'color.adobe.com=adobe-colorp'`（→ `/brand-icons/adobe-color.png`），
  位于 a2b 块 `helpx.adobe.com` 条目之后；`adobe.com` 裸键未动
  （仍为删除状态，Firefly / Illustrator 标题规则不受影响）。
- 到达性：navigation.json 中 Adobe Color 唯一条目
  （href `https://color.adobe.com`，icon `https://color.adobe.com/favicon.ico`，
  全库仅此 1 站命中 `color.adobe.com`，无子域站）；其 icon 字段为远端
  `…/favicon.ico`，实测 404，且 `resolveSiteIcon` 开头的
  `isRemoteRawFavicon` 会拦截该类远端裸 favicon 地址后回落 map，
  故本键运行时可达，无需清空 icon 字段；**navigation.json 未改动**。
- 测试：`apps/web-overlay/test/site-favicon-iconbatch-a2b.test.ts`——
  取消注释 Adobe Color 用例
  （`https://color.adobe.com` + `Adobe Color` → `/brand-icons/adobe-color.png`），
  `LOCAL_ASSETS` 补 `adobe-color.png`；PNG 魔数与 128×128 尺寸断言覆盖
  新资产；新增色轮事实断言（四角近黑 + 中心绿 + r=32 处 ≥8 个 15° 色相桶，
  解码器复用 mc-antd 同款 `pngPixels`）。

## 5. 旧阻塞源说明

2026-11-17 a2b 阻塞源 upload.wikimedia.org / web.archive.org（多次 429）
已作废：用户改判 App Store 源后不再重试。本次未使用 Wayback 时间戳
20200320072615 / 2,436 B 候选（该候选为旧版 Kuler 时代图标，与用户确认的
App Store 版描述不符，不再采用）。

## 6. 390px 渲染验证（2026-11-25，C7 替代法）

- 方法：真实卡片 28px（size-7）+ `object-contain`（SiteFavicon 默认
  className `w-full h-full object-contain`），Playwright 1.65.1 + 本地
  Chromium（ms-playwright chromium-1255），视口 390×844，浅/深双主题，
  静态 harness 复现卡片结构（`~/workspace/adobe-render/light.html` /
  `dark.html`，图片为落盘文件原样复制）。
- 截图：`~/workspace/adobe-render/shot-light.png`（26,977 B）、
  `~/workspace/adobe-render/shot-dark.png`（27,284 B），均为 390×844。
- 目视结论：浅色主题——28px 卡片内黑底方块 + 彩色 12 色轮清晰可辨，
  112px 放大对照确认楔形边界锐利；深色主题——色轮同样清晰，黑底方块
  边缘与深色卡片底色相融，但卡片描边定界、色轮本身（识别主体）完整
  可见。两主题下图标均可识别，无破图、无字母回落。
- 像素复核（截图实测）：28px 框内饱和像素 285、11 个 30° 色相扇区
  （浅/深一致）；框角像素浅色 (18,18,18)、深色 (10,10,10)——近黑，
  与落盘文件四角一致。
- 深色主题观察（未改动，仅记录，供复审裁决）：黑底方块在深色卡片上
  边缘相融，类同站内极客公园黑底方块标曾给 `light` 底块的情形；但
  本站色轮为高亮彩色识别主体、双主题均完整可辨，按“底块留待统一
  处理轮”先例（C7 maoyan 等）本次不加 `LOGO_TILE_MAP` 单站补丁。
  如复审裁决加 light 底块，改一处 map 即可，资产与接线不动。
