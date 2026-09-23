import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const platformBoundaryMessage =
  'src/core is OS-agnostic: receive OS behaviour through the injected PlatformAdapter instead.';

// src/** is bundled to CommonJS (dist/agent.cjs), where import.meta is empty.
const noImportMeta = {
  selector: "MetaProperty[meta.name='import']",
  message: 'import.meta is empty in the CommonJS bundle; inject paths/config instead.',
};

export default defineConfig(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', noImportMeta],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'os', importNames: ['platform'], message: platformBoundaryMessage },
            { name: 'node:os', importNames: ['platform'], message: platformBoundaryMessage },
          ],
          patterns: [
            // OS-specific adapters, and the adapter selector that wires all of them.
            // platform/types.js stays importable.
            { regex: '(^|/)platform/(darwin|win32|linux)(/|$)', message: platformBoundaryMessage },
            { regex: '(^|/)platform(/index(\\.js)?)?$', message: platformBoundaryMessage },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'platform', message: platformBoundaryMessage },
        { object: 'os', property: 'platform', message: platformBoundaryMessage },
      ],
      'no-restricted-syntax': [
        'error',
        noImportMeta,
        { selector: 'ImportExpression', message: platformBoundaryMessage },
      ],
    },
  },
);
