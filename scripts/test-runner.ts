import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const unitTests = readdirSync('tests/unit')
  .filter(f => f.endsWith('.test.ts'))
  .map(f => join('tests/unit', f));

const integrationTests = readdirSync('tests/integration')
  .filter(f => f.endsWith('.test.ts'))
  .map(f => join('tests/integration', f));

const allTestFiles = [...unitTests, ...integrationTests];

console.log(`\n======================================================`);
console.log(`🧪 PRICETOOL TEST SUITE - ${allTestFiles.length} TEST FILES`);
console.log(`======================================================\n`);

let passedCount = 0;
let failedCount = 0;

for (const rawFile of allTestFiles) {
  const file = rawFile.replace(/\\/g, '/');
  process.stdout.write(`• Running ${file}... `);
  try {
    execSync(`npx vitest run "${file}"`, { stdio: 'pipe' });
    console.log(`\x1b[32mPASSED\x1b[0m`);
    passedCount++;
  } catch (err: any) {
    console.log(`\x1b[31mFAILED\x1b[0m`);
    console.error(err.stdout?.toString() || err.stderr?.toString() || err.message);
    failedCount++;
  }
}

console.log(`\n======================================================`);
console.log(`Results: ${passedCount} passed, ${failedCount} failed (${allTestFiles.length} total)`);
console.log(`======================================================\n`);

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
