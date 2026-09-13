/**
 * src/routes/ops.ts — vận hành: báo cáo chất lượng nạp + chỉ số sử dụng (T-095, T-103).
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { qualityReport } from '../domain/quality-report.js';
import { usageMetrics, usageSummary } from '../domain/metrics.js';

export function registerOpsRoutes(app: FastifyInstance, sql: Sql): void {
  // Báo cáo chất lượng sau nạp (4 kiểm tra).
  app.get('/ops/quality', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const report = await qualityReport(sql);
    return reply.view('ops-quality.eta', { report });
  });

  // Màn chỉ số mức độ sử dụng — hệ thống có thực sự được dùng không.
  app.get('/ops/usage', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const [summary, days] = await Promise.all([usageSummary(sql), usageMetrics(sql, 30)]);
    return reply.view('ops-usage.eta', { summary, days });
  });
}
