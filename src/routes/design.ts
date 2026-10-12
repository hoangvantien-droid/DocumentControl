/**
 * src/routes/design.ts — trang trưng bày thành phần giao diện `/design` (Yêu cầu 21).
 *
 * Route MỎNG: chỉ kết xuất trang tài liệu sống, không gọi domain nghiệp vụ.
 * Chỉ quản trị viên hệ thống được truy cập — tái dùng mẫu `requireSystemAdmin`
 * của `admin.ts` (dựa `requireUser` + `hasSystemAdminAccess`) để nhất quán (21.3, 21.4).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { hasSystemAdminAccess } from '../domain/permissions.js';

async function requireSystemAdmin(req: FastifyRequest, reply: FastifyReply, sql: Sql): Promise<boolean> {
  const user = requireUser(req, reply);
  if (!user) return false;
  if (!await hasSystemAdminAccess(sql, user.user_id)) {
    reply.code(403);
    reply.send('Không đủ quyền quản trị hệ thống');
    return false;
  }
  return true;
}

export function registerDesignRoutes(app: FastifyInstance, sql: Sql): void {
  // Trang trưng bày (tài liệu sống): 14 thành phần ở mọi trạng thái, dùng kiểm
  // hồi quy thị giác và nghiệm thu (Yêu cầu 21, 23). Chỉ quản trị viên.
  app.get('/design', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    return reply.view('design.eta', { user: req.currentUser });
  });
}
