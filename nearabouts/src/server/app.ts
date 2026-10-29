import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';
import { registerRoutes } from './routes.ts';
import { HttpError } from './auth.ts';
import { NotEnoughLocationsError, seedDemoLocations } from './locations.ts';
import { seedBuiltinMaps } from './maps.ts';

export async function buildApp() {
  seedDemoLocations();
  seedBuiltinMaps();

  const app = Fastify({ logger: config.isProd ? { level: 'info' } : false, trustProxy: config.trustProxy, bodyLimit: 64 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', allowList: (req) => !req.url.startsWith('/api/') });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    return payload;
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, code: err.code });
    if (err instanceof NotEnoughLocationsError) return reply.status(422).send({ error: err.message, code: 'not_enough_locations', available: err.available });
    if (err.statusCode === 429) return reply.status(429).send({ error: 'Too many requests — slow down a little.', code: 'rate_limited' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message, code: 'bad_request' });
    app.log.error(err);
    console.error(err);
    return reply.status(500).send({ error: 'Something went wrong on our side.', code: 'server_error' });
  });

  registerRoutes(app);

  // Serve the built web app (npm run build) with SPA fallback.
  const dist = join(process.cwd(), 'dist');
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false, maxAge: '1h' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/socket.io')) return reply.status(404).send({ error: 'Not found', code: 'not_found' });
      return reply.sendFile('index.html', { maxAge: 0 });
    });
  }
  return app;
}
