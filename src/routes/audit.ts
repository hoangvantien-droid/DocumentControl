/**
 * src/routes/audit.ts — màn tra cứu ghi vết (REQ-G). Chỉ người release xem.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { queryAudit, EVENT_TYPES, type AuditFilter } from '../domain/audit-query.js';

export function registerAuditRoutes(app: FastifyInstance, sql: Sql): void {
  app.get<{ Querystring: Record<string, string> }>('/audit', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    // Chỉ Admin xem ghi vết (menu đã ẩn theo isAdmin, chặn thêm ở đây).
    if (!req.nav.isAdmin) {
      reply.code(403);
      return reply.send('Không đủ thẩm quyền xem ghi vết');
    }
    const q = req.query;
    const filter: AuditFilter = {
      objectId: q.object_id || undefined,
      eventType: q.event_type || undefined,
      fromDate: q.from || undefined,
      toDate: q.to || undefined,
    };
    const rows = await queryAudit(sql, filter);
    return reply.view('audit.eta', { rows, filter: q, eventTypes: EVENT_TYPES });
  });
}
