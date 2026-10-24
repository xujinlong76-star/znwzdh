/**
 * 后端 ESLint 配置（方案 P1-8）。
 *
 * 首轮只开三条规则：`apps/api` 此前完全没有静态检查，一次性套
 * `tseslint.configs.recommended` 会倒出成百上千条历史告警，结果只有一个——
 * 所有人学会忽略这个命令。所以先只锁「空 catch / 未用变量 / 裸 console」。
 *
 * 现在这三条已升为 **error**，且 `pnpm lint` 带 `--max-warnings 0`：
 * 告警不挡门禁的过渡期结束了——历史上 25 条告警全部清零后，
 * 再出现任何一条（含以后新增规则产生的）都直接让 CI 变红。
 * 留着 warn 只会被「以后再修」无限期吞掉，那正是这批规则想防的毛病。
 */
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 服务端日志是有意为之：只把「调试残留型」的 console.log 判为错误，
      // warn/error/info 属正常运维输出，不制造噪音。
      // 启动横幅与迁移/种子脚本的 stdout 走 console.info：Node 里它同样写标准输出，
      // 不必为几个入口文件单开例外，把规则退回「人人都能加一条 override」。
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
]
