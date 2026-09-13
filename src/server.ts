/**
 * src/server.ts — khởi động Fastify, đăng ký plugin, lắng nghe.
 *
 * Tầng này MỎNG: chỉ dựng máy chủ và ghép các plugin. Logic nghiệp vụ
 * nằm ở domain/, không đặt ở đây (DCS-8 §2.1).
 */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';
import { getSql } from './db/client.js';
import { registerViewLayer } from './views/render.js';
import { registerAuth } from './middleware/auth.js';
import { registerHomeRoutes } from './routes/home.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerConfirmationRoutes } from './routes/confirmation.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerDiffRoutes } from './routes/diff.js';
import { registerFunctionalGroupRoutes } from './routes/functional-groups.js';
import { registerReviewRoutes } from './routes/reviews.js';
import { registerPackageRoutes } from './routes/packages.js';
import { registerPrintingRoutes } from './routes/printing.js';
import { registerQaRoutes } from './routes/qa.js';
import { registerOpsRoutes } from './routes/ops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = loadConfig();
  const sql = getSql(config);

  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === 'development'
          ? { target: 'pino-pretty' }
          : undefined,
    },
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(formbody);

  // Tài nguyên tĩnh: CSS, htmx. Phục vụ dưới /static.
  await app.register(fastifyStatic, {
    root: join(__dirname, 'public'),
    prefix: '/static/',
  });

  // Lớp kết xuất HTML với Eta.
  const eta = new Eta({
    views: join(__dirname, 'views'),
    cache: config.nodeEnv === 'production',
  });
  registerViewLayer(app, eta);

  // Xác thực: phân giải người dùng hiện tại từ cookie phiên (đường duy nhất).
  registerAuth(app, sql);

  // Các route.
  registerAuthRoutes(app, sql);
  registerHomeRoutes(app, sql);
  registerAdminRoutes(app, sql);
  registerDocumentRoutes(app, sql);
  registerConfirmationRoutes(app, sql);
  registerCatalogRoutes(app, sql);
  registerSearchRoutes(app, sql);
  registerDiffRoutes(app, sql);
  registerFunctionalGroupRoutes(app, sql);
  registerReviewRoutes(app, sql);
  registerPackageRoutes(app, sql);
  registerPrintingRoutes(app, sql);
  registerQaRoutes(app, sql, config);
  registerOpsRoutes(app, sql);

  const address = await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`DCS đang lắng nghe tại ${address}`);
}

main().catch((err) => {
  // Lỗi khởi động là lỗi chí mạng — dừng hẳn, không chạy nửa vời.
  console.error('Không khởi động được DCS:', err);
  process.exit(1);
});
