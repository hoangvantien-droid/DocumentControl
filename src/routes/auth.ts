/**
 * src/routes/auth.ts — đăng nhập, đăng xuất. Route MỎNG: gọi domain (DCS-8 §2.1).
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { authenticate } from '../domain/auth.js';
import { createSession } from '../domain/session.js';
import { isBusinessError } from '../lib/errors.js';
import { getCurrentUser, setSessionCookie, clearSession } from '../middleware/auth.js';

export function registerAuthRoutes(app: FastifyInstance, sql: Sql): void {
  app.get('/login', async (req, reply) => {
    if (getCurrentUser(req)) return reply.redirect('/');
    return reply.view('login.eta', { error: null });
  });

  app.post<{ Body: { email?: string; password?: string } }>(
    '/login',
    async (req, reply) => {
      const email = (req.body.email ?? '').trim();
      const password = req.body.password ?? '';
      try {
        const user = await authenticate(sql, email, password);
        const sessionId = await createSession(sql, user.user_id);
        setSessionCookie(reply, sessionId);
        return reply.redirect('/');
      } catch (err) {
        if (isBusinessError(err)) {
          reply.code(err.httpStatus);
          return reply.view('login.eta', { error: err.message });
        }
        throw err;
      }
    },
  );

  app.get('/logout', async (req, reply) => {
    await clearSession(sql, req, reply);
    return reply.redirect('/login');
  });
}
