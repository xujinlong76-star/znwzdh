/**
 * 后端 ESLint 配置（方案 P1-8）。
 *
 * 为什么首轮只开三条规则：`apps/api` 此前完全没有静态检查，一次性套
 * `tseslint.configs.recommended` 会倒出成百上千条历史告警，结果只有一个——
 * 所有人学会忽略这个命令。这里先只锁「空 catch / 未用变量 / 裸 console」，
 * 故意全部设为 warn：门禁不 block，但本地与 CI 都能看见。
 *
 * 全量修复告警（以及是否升级为 error）单独立项，不走这条提交。
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
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // 服务端日志是有意为之：只把「调试残留型」的 console.log 留作告警，
      // warn/error/info 属正常运维输出，不制造噪音。
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
]
