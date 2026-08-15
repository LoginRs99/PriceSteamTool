import Fastify from 'fastify';
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

async function bootstrap() {
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

  // Graceful shutdown
  const handleShutdown = async (signal: string) => {
    fastify.log.info(`Received ${signal}. Shutting down gracefully...`);
    syncOrchestrator.cancelSync();
    await fastify.close();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  try {
    await fastify.listen({ port: config.port, host: config.host });
    console.log(`🚀 Pricetool Server running at http://${config.host}:${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

bootstrap();
