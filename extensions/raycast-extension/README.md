# NavHub Raycast 生产力扩展

将 NavHub 的离线向量语义搜索接入 Raycast 全局快捷键启动器。

## 功能

- **全局极速唤出**：通过快捷键打开 Raycast，输入 `Search NavHub` 开始输入。
- **混合语义支持**：输入“写代码AI”、“压缩图片”、“绘图白板”等自然语言，本地 BGE 向量与 FTS5 即时召回。
- **一键动作**：按回车在默认浏览器打开站点，按 `Cmd+K` 或 `Ctrl+K` 复制网址或打开 NavHub 完整门户。

## 开发与安装

1. 进入当前目录：
   ```bash
   cd extensions/raycast-extension
   ```
2. 安装依赖：
   ```bash
   npm install
   ```
3. 在 Raycast 中以开发者模式启动：
   ```bash
   npm run dev
   ```
4. 确保 NavHub 后端 API (`http://127.0.0.1:8787`) 处于运行状态。
