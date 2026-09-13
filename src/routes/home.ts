/**
 * src/routes/home.ts — trang chủ và điểm kiểm tra sức khoẻ.
 *
 * Route MỎNG (DCS-8 §2.1): chỉ kết xuất, chưa gọi domain vì giai đoạn nền
 * móng chưa có nghiệp vụ. Các route nghiệp vụ thêm ở giai đoạn sau.
 */
import type { FastifyInstance } from 'fastify';
import { getCurrentUser, requireUser } from '../middleware/auth.js';

export function registerHomeRoutes(app: FastifyInstance): void {
  app.get('/', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply; // đã chuyển hướng tới /login
    return reply.view('home.eta', { user });
  });

  // Kiểm tra sức khoẻ cho systemd / proxy ngược (DCS-5 §4.3).
  app.get('/healthz', async () => ({ status: 'ok', phase: 'foundation' }));
}
