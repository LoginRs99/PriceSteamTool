import { afterAll } from 'vitest';
import { closeDb } from '../src/server/db/index.js';

afterAll(() => {
  closeDb();
});

