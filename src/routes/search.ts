/**
 * src/routes/search.ts — ô tìm gợi ý (htmx) + trang kết quả (T-056, T-057, T-058).
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { search, suggest } from '../domain/search.js';
import { writeAudit } from '../lib/audit.js';

export function registerSearchRoutes(app: FastifyInstance, sql: Sql): void {
  // Gợi ý nhanh cho ô tìm ở thanh trên — trả HTML mảnh cho htmx.
  app.get<{ Querystring: { q?: string } }>('/search/suggest', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const hits = await suggest(sql, user.user_id, req.query.q ?? '');
    return reply.view('search-suggest.eta', { hits });
  });

  // Trang kết quả đầy đủ. Công tắc bản lịch sử mặc định tắt (REQ-K06).
  app.get<{ Querystring: { q?: string; historical?: string } }>('/search', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const q = req.query.q ?? '';
    const includeHistorical = req.query.historical === '1';
    const hits = q.trim() ? await search(sql, user.user_id, q, includeHistorical) : [];
    if (q.trim()) {
      await sql.begin(async (tx) => {
        await writeAudit(tx as never, {
          eventType: 'tim_kiem', actorUserId: user.user_id,
          objectType: 'search', objectId: q.slice(0, 64), context: { q, includeHistorical, hits: hits.length },
        });
      });
    }
    return reply.view('search-results.eta', { q, hits, includeHistorical });
  });
}
