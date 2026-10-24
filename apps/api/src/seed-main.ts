/**
 * 种子数据 CLI 入口。
 *
 * 与 main.ts 同理：不做主模块判断，导入即执行，避免 Windows 上的路径形式差异
 * 导致脚本静默不执行。
 */
import { runSeed } from "./seed.ts";

const t0 = Date.now();
const withEmbeddings = process.env.NAVHUB_SEED_EMBEDDINGS !== "0";
console.info("[seed] 开始导入内置站点（向量化：" + (withEmbeddings ? "启用" : "关闭") + "）");

const result = await runSeed({ withEmbeddings });

console.info("[seed] 完成：" + JSON.stringify(result) + "，耗时 " + (Date.now() - t0) + " ms");
if (withEmbeddings && result.embedded === 0) {
  console.warn("[seed] 警告：没有任何站点生成向量，语义检索将不可用。请检查 embedding 配置。");
}
