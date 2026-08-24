import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'resources/**', '.git-fixtures/**', '.electron-cache/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts and the main process run outside the browser.
    files: ['scripts/**/*.{mts,mjs}', 'src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    // In eslint-plugin-react-hooks 7 the flat config lives under `configs.flat`;
    // the top-level one is the legacy eslintrc shape and ESLint 10 rejects it.
    ...reactHooks.configs.flat['recommended-latest']
  },
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
)
