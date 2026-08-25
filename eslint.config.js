import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dev-dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Only the two classic hook rules — eslint-plugin-react-hooks v7's
      // "recommended" also bundles the newer React Compiler—oriented rules
      // (set-state-in-effect, immutability, purity, ...), which fire
      // throughout the existing codebase and aren't part of this project's
      // conventions.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // tsc (noUnusedLocals/noUnusedParameters, strict mode) already
      // enforces these — avoid duplicate, differently-configured errors.
      // ignoreRestSiblings covers the `{ omitMe, ...rest }` pattern used to
      // drop a key from an object.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
