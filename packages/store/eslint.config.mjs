/**
 * 存储层 ESLint 配置（方案 P1-8）。
 *
 * 首轮只开三条规则：`packages/store` 此前零静态检查，
 * 一次套 recommended 只会制造一片没人看的噪音。规则意图与 `apps/api` 一致，
 * 注释见 `apps/api/eslint.config.mjs` 文件头。
 *
 * 与 apps/api 同步升为 error（配合 lint 脚本里的 `--max-warnings 0`）：
 * 两侧口径必须一致，否则同一类问题一边红一边黄，最后大家按黄色那侧理解规则。
 */
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'drizzle/**'],
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
      // 与 apps/api 同口径：warn/error/info 是正常日志，调试残留的 console.log 判错。
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
]
