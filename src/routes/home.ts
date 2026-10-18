/**
 * src/routes/home.ts — trang chủ "hôm nay tôi cần làm gì" + healthz.
 *
 * Mô hình receipt mới:
 *  - DC Site: các receipt đang chờ site mình phản hồi.
 *  - Author: tài liệu mình ban hành bị site báo sai sót (receipt tu_choi).
 * Bỏ khối "chờ xác nhận" (cho_xac_nhan) của mô hình dept-head cũ.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { siteIdsWithDocControl } from '../domain/permissions.js';
import { pendingReceiptsForSites } from '../domain/receipt.js';

export function registerHomeRoutes(app: FastifyInstance, sql: Sql): void {
  app.get('/', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;

    // DC Site: receipt chờ site mình phản hồi.
    const siteIds = [...await siteIdsWithDocControl(sql, user.user_id)];
    const pendingReceipts = siteIds.length > 0
      ? await pendingReceiptsForSites(sql, siteIds)
      : [];

    // Author: tài liệu mình ban hành bị site báo sai sót (có receipt tu_choi).
    const rejectedMine = await sql`
      SELECT DISTINCT v.version_id, v.doc_id, v.version_no, v.title
        FROM document_versions v
        JOIN document_receipt r ON r.version_id = v.version_id
       WHERE v.registrant_user_id = ${user.user_id}
         AND r.status = 'tu_choi'
       ORDER BY v.version_id`;

    return reply.view('home.eta', {
      user,
      pendingReceipts,
      rejectedMine,
      isSiteDocControl: siteIds.length > 0,
    });
  });

  app.get('/healthz', async () => ({ status: 'ok', phase: 'receipt' }));
}
