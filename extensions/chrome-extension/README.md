# 山羊胡智能导航随身助手 (Chrome / Edge 扩展)

山羊胡官方浏览器随身扩展，将导航站从标签页解放为全场景生产力随身外脑。

生产站点：https://www.shanyanghu.com（本地开发时可在 popup 里把「Web 站点地址」改回 `http://localhost:3000`，把「中枢 API 地址」改回 `http://127.0.0.1:8787`）。

## 功能亮点

1. **新标签页轻量首页（v1.2.0 新增）**：
   - 每次开新标签页即本站轻量首页：搜索框 + 今日一件事 + 常用站。
   - 先画“上次缓存的样子”秒开，后台再拉最新数据无缝替换；离线停在上次缓存的样子，不白屏。
   - 今日一件事只存本机（`chrome.storage.local`），每天从空白开始，不进云端。
2. **Omnibox 地址栏极速搜索**：
   - 在 Chrome / Edge 地址栏输入 `nh` 然后按 `Space` 或 `Tab`，即可直接触发 NavHub 在线混合检索（中枢 `/api/search` 五路召回），实时展示匹配结果并按回车秒级直达。
3. **一键智能网页收录**：
   - 点击浏览器右上角 NavHub 扩展图标，一键将当前打开的页面提交至 NavHub 中枢。
   - 自动触发后端 AI 智能抓取、生成标题、分类归纳与标签富化。
4. **随身搜索面板**：
   - 无论处于何种工作界面，点击扩展面板即可毫秒级查询站库、探索平替与直达微动作。

## 安装指南

### 方式一：Chrome 应用商店（上架审核中）

商店上架需走 Chrome Web Store 开发者账号提交与审核流程，本轮未提交——商店链接待上架后在此公布。站内安装引导页：https://www.shanyanghu.com/extension

### 方式二：开发者模式手动加载

1. 打开浏览器扩展管理页面：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
2. 开启右上角的 **「开发者模式」** 开关。
3. 点击 **「加载已解压的扩展程序」** (Load unpacked)。
4. 选择当前项目的 `extensions/chrome-extension` 目录即可！
5. 打开一个新标签页，立即体验轻量首页；在地址栏输入 `nh` 并按空格，体验极速导航搜索。

恢复浏览器默认新标签页：停用或卸载本扩展即可。

## 单测

```bash
node --check background.js && node --check popup.js && node --check newtab.js
node --test test/newtab.test.mjs
```
