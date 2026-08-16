import { afterEach } from 'vitest';
import { clearStmtCache } from '../src/server/db/index.js';

afterEach(() => {
  clearStmtCache();
});
