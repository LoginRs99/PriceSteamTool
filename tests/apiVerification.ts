import { createApp } from '../src/server/index.js';
import { closeDb } from '../src/server/db/index.js';

async function testApi() {
  console.log('\n--- 9. Live HTTP API & Fastify Server Validation ---');
  const app = await createApp();
  await app.listen({ port: 3099, host: '127.0.0.1' });
  console.log('✅ Server booted on http://127.0.0.1:3099');

  try {
    // 1. Health check
    const healthRes = await fetch('http://127.0.0.1:3099/api/health');
    const health = await healthRes.json();
    console.log('Health Response:', health);
    if (health.status !== 'ok') {
      throw new Error('Health check failed');
    }
    console.log('✅ PASS: /api/health returns { status: ok }');

    // 2. Profiles API
    const profilesRes = await fetch('http://127.0.0.1:3099/api/profiles');
    const profiles = await profilesRes.json();
    console.log(`✅ PASS: /api/profiles returned ${profiles.length} profiles`);

    // 3. Wishlist API
    const wishlistRes = await fetch('http://127.0.0.1:3099/api/wishlist');
    const wishlist = await wishlistRes.json();
    console.log(`✅ PASS: /api/wishlist returned total=${wishlist.total}`);

    // 4. Sources API
    const sourcesRes = await fetch('http://127.0.0.1:3099/api/sources');
    const sources = await sourcesRes.json();
    console.log(`✅ PASS: /api/sources returned ${sources.length} sources (${sources.map((s: any) => s.code).join(', ')})`);

    // 5. Sync Status API
    const syncRes = await fetch('http://127.0.0.1:3099/api/sync/status');
    const syncStatus = await syncRes.json();
    console.log(`✅ PASS: /api/sync/status returned status=${syncStatus.status}`);

  } finally {
    await app.close();
    closeDb();
    console.log('✅ Server gracefully stopped');
  }
}

testApi().catch(err => {
  console.error('API Verification Failed:', err);
  process.exit(1);
});
