/**
 * 存储层 ESLint 配置（方案 P1-8）。
 *
 * 首轮只开三条规则，且全部为 warn：`packages/store` 此前零静态检查，
 * 一次套 recommended 只会制造一片没人看的噪音。规则意图与 `apps/api` 一致，
 * 注释见 `apps/api/eslint.config.mjs` 文件头。
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
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'warn',
    },
  },
]
