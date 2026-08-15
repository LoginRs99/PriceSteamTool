import { afterAll } from 'vitest';
import { clearStmtCache } from '../src/server/db/index.js';

afterAll(() => {
  clearStmtCache();
});


