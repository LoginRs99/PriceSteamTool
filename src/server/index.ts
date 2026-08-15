import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import { apiRoutes } from './routes/api.js';
import { getDb, closeDb } from './db/index.js';
import { syncOrchestrator } from './sync/orchestrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: config.isDev ? 'info' : 'warn'
    }
  });

  // Enable CORS
  await fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // Initialize SQLite database schema
  getDb();

  // Register API Routes
  await fastify.register(apiRoutes);

  // Serve compiled SPA in production mode
  const clientDist = path.resolve(__dirname, '../../dist/client');
  if (fs.existsSync(clientDist)) {
    await fastify.register(fastifyStatic, {
      root: clientDist,
      prefix: '/'
    });

    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        reply.status(404).send({ error: 'Endpoint not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  return fastify;
}

import { initAutoSyncScheduler, stopAutoSyncScheduler } from './sync/scheduler.js';

async function bootstrap() {
  const app = await createApp();

  // Initialize automatic periodic background sync scheduler
  initAutoSyncScheduler();

  // Graceful shutdown
  const handleShutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`);
    
    // Safety failsafe: guarantee container terminates within 3 seconds even if connections are open
    const forceExitTimer = setTimeout(() => {
      console.warn('Graceful shutdown timeout reached (3s). Forcing clean exit.');
      try { closeDb(); } catch {}
      process.exit(0);
    }, 3000);
    forceExitTimer.unref();

    try {
      stopAutoSyncScheduler();
      syncOrchestrator.cancelSync();
      await app.close();
      closeDb();
    } catch (err) {
      console.error('Error during graceful shutdown:', err);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`🚀 Pricetool Server running at http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only auto-start when run directly as the main entrypoint
const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
);

if (isMain) {
  bootstrap();
}
