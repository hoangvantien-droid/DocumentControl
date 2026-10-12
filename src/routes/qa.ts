/**
 * src/routes/qa.ts — hỏi đáp AI (T-088, T-089). Gắn nhãn "đang thử nghiệm".
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import type { Config } from '../config.js';
import { requireUser } from '../middleware/auth.js';
import { answer, qaEnabled } from '../domain/qa.js';

export function registerQaRoutes(app: FastifyInstance, sql: Sql, config: Config): void {
  app.get('/qa', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    return reply.view('qa.eta', { enabled: qaEnabled(config), result: null, question: '' });
  });

  app.post<{ Body: { question?: string } }>('/qa', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const question = (req.body.question ?? '').trim();
    const result = question ? await answer(sql, config, { question, userId: user.user_id }) : null;
    return reply.view('qa.eta', { enabled: qaEnabled(config), result, question });
  });
}
