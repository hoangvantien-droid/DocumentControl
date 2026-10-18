/**
 * src/routes/reviews.ts — rà soát định kỳ (T-076, T-077).
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireDocFlow } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import { reviewBacklog, recordVerdict, type Verdict } from '../domain/review.js';
import { canRelease } from '../domain/permissions.js';

export function registerReviewRoutes(app: FastifyInstance, sql: Sql): void {
  app.get('/reviews', async (req, reply) => {
    const user = await requireDocFlow(sql, req, reply);
    if (!user) return reply;
    const rows = await reviewBacklog(sql);
    const visible = [];
    for (const row of rows) {
      if (await canRelease(sql, user.user_id, row)) visible.push(row);
    }
    const active = visible.filter((r) => r.status === 'dang_ra_soat');
    const pending = visible.filter((r) => r.status === 'treo_cho_ban_moi');
    return reply.view('reviews.eta', { active, pending });
  });

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    '/reviews/:id/verdict',
    async (req, reply) => {
      const user = await requireDocFlow(sql, req, reply);
      if (!user) return reply;
      try {
        await recordVerdict(sql, {
          reviewId: req.params.id,
          verdict: (req.body.verdict ?? '') as Verdict,
          note: req.body.note ?? '',
          userId: user.user_id,
        });
        return reply.redirect('/reviews');
      } catch (err) {
        if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
        throw err;
      }
    },
  );
}
