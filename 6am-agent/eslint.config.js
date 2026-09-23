import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const osSpecificPlatformCode = [
  '**/platform/darwin',
  '**/platform/darwin/**',
  '**/platform/win32',
  '**/platform/win32/**',
  '**/platform/linux',
  '**/platform/linux/**',
];

const platformBoundaryMessage =
  'src/core is OS-agnostic: receive OS behaviour through the injected PlatformAdapter instead.';

export default defineConfig(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: osSpecificPlatformCode, message: platformBoundaryMessage }] },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'platform', message: platformBoundaryMessage },
        { object: 'os', property: 'platform', message: platformBoundaryMessage },
      ],
    },
  },
);
