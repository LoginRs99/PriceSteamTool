import { afterEach, afterAll } from 'vitest';
import { closeDb } from '../src/server/db/index.js';

afterEach(() => {
  closeDb();
});

afterAll(() => {
  closeDb();
});

