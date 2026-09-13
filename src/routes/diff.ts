/**
 * src/routes/diff.ts — màn so sánh phiên bản (T-059, T-060, T-061).
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { diffVersions, diffReliability, recordViewedDiff } from '../domain/diff.js';

export function registerDiffRoutes(app: FastifyInstance, sql: Sql): void {
  // So sánh from -> to. Ghi vết đã xem (mở khoá ô 9b khi to là phiên bản đang xác nhận).
  app.get<{ Querystring: { from?: string; to?: string } }>('/compare', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const from = req.query.from ?? null;
    const to = req.query.to ?? '';
    if (!to) { reply.code(400); return reply.send('Thiếu tham số to'); }

    const reliability = await diffReliability(sql, from, to);
    // Chỉ so khi đáng tin và có bản gốc; ba trường hợp còn lại hiện cảnh báo.
    const rows = reliability === 'dang_tin' && from ? await diffVersions(sql, from, to) : [];

    // Ghi vết đã xem so sánh cho phiên bản đích (điều kiện ô 9b).
    await recordViewedDiff(sql, user.user_id, to);

    return reply.view('compare.eta', { from, to, reliability, rows });
  });
}
