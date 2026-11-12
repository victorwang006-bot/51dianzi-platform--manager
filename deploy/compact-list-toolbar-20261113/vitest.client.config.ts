import path from 'node:path';
const root = process.env.COMPACT_TEST_REPO!;
export default {
  root,
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    '@': path.join(root, 'client/src'),
    '@shared': path.join(root, 'shared'),
    '@assets': path.join(root, 'attached_assets'),
  } },
  test: {
    environment: 'node',
    include: ['client/src/**/*.test.{ts,tsx}'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
};
