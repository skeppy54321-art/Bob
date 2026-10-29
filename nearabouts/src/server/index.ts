import { config } from './config.ts';
import { buildApp } from './app.ts';
import { Hub } from './multi/hub.ts';
import { imagery } from './imagery/index.ts';

const app = await buildApp();
const hub = new Hub();
hub.attach(app.server);
await app.listen({ port: config.port, host: config.host });
console.log(`Nearabouts listening on http://localhost:${config.port}  (imagery: ${imagery.label}${imagery.live ? '' : ' — DEMO MODE'})`);

const shutdown = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
