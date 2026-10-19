import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
  {
    // 静态资源与构建产物不参与 lint：vendored 的 bootstrap / TweenMax 等第三方压缩脚本
    // 会命中 TS 规则（no-this-alias / no-require-imports），但它们不是本仓库维护的源码。
    ignores: ["public/**", ".next/**", ".next*/**", "node_modules/**", "next-env.d.ts"],
  },
  {
    extends: [...nextCoreWebVitals, ...nextTypescript],

    rules: {
        "@typescript-eslint/no-explicit-any": "warn",

        "@typescript-eslint/no-unused-vars": ["warn", {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
        }],

        "@next/next/no-img-element": "off",

        // Next 16 起 eslint-config-next 把 React Compiler 诊断默认升级为 error，
        // 命中的几乎全是 vendored 上游组件（modular/* 等，非本仓库维护）。
        // 保留为 warning：不阻塞门禁，但本地仍能看到问题点。
        "react-hooks/set-state-in-effect": "warn",
        "react-hooks/immutability": "warn",
        "react-hooks/refs": "warn",
        "react-hooks/purity": "warn",
        "react-hooks/incompatible-library": "warn",
    },
  },
  {
    // 构建配置用 CJS require() 装配插件，属常规写法
    files: ["tailwind.config.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);
