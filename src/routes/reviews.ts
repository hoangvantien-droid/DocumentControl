/**
 * src/routes/reviews.ts — rà soát định kỳ (T-076, T-077).
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireDocFlow } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import { sendBusinessError } from '../lib/http-errors.js';
import { reviewBacklogForOwner, reviewBacklogForSites, recordVerdict, type Verdict } from '../domain/review.js';
import { canRegisterDocuments, siteIdsWithDocControl } from '../domain/permissions.js';

export function registerReviewRoutes(app: FastifyInstance, sql: Sql): void {
  app.get('/reviews', async (req, reply) => {
    const user = await requireDocFlow(sql, req, reply);
    if (!user) return reply;
    // Nhánh Author: tồn đọng theo BỘ PHẬN SỞ HỮU (có nút kết luận).
    const rows = await reviewBacklogForOwner(sql, user.user_id);
    const active = rows.filter((r) => r.status === 'dang_ra_soat');
    const pending = rows.filter((r) => r.status === 'treo_cho_ban_moi');
    // Nhánh DC Site: bảng nhắc CHỈ-ĐỌC theo site người dùng phụ trách.
    let siteReminders: typeof rows = [];
    if (req.nav.isSiteDocControl) {
      const siteIds = [...await siteIdsWithDocControl(sql, user.user_id)];
      siteReminders = await reviewBacklogForSites(sql, siteIds);
    }
    return reply.view('reviews.eta', {
      active, pending, siteReminders,
      canRegister: req.nav.canRegister, isSiteDocControl: req.nav.isSiteDocControl,
    });
  });

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    '/reviews/:id/verdict',
    async (req, reply) => {
      const user = await requireDocFlow(sql, req, reply);
      if (!user) return reply;
      try {
        await recordVerdict(sql, {
          reviewId: req.params.id,
          verdict: ((req.body ?? {}).verdict ?? '') as Verdict,
          note: (req.body ?? {}).note ?? '',
          userId: user.user_id,
        });
        return reply.redirect('/reviews');
      } catch (err) {
        if (isBusinessError(err)) return sendBusinessError(req, reply, err);
        throw err;
      }
    },
  );
}
