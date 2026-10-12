/**
 * src/routes/home.ts — trang chủ và điểm kiểm tra sức khoẻ.
 *
 * Route MỎNG (DCS-8 §2.1): chỉ kết xuất, chưa gọi domain vì giai đoạn nền
 * móng chưa có nghiệp vụ. Các route nghiệp vụ thêm ở giai đoạn sau.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { canRelease } from '../domain/permissions.js';

export function registerHomeRoutes(app: FastifyInstance, sql: Sql): void {
  // Trang chủ (DCS-7 §1.3): trả lời "hôm nay tôi cần làm gì". Khối không có việc
  // thì ẩn hẳn, không hiện "không có mục nào".
  app.get('/', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply; // đã chuyển hướng tới /login

    // Việc chờ tôi xác nhận (lọc theo quyền release).
    const pendingRows = await sql`
      SELECT v.version_id, v.doc_id, v.version_no, v.title,
             d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
        FROM document_versions v JOIN documents d ON d.doc_id = v.doc_id
       WHERE v.status = 'cho_xac_nhan'
       ORDER BY v.submitted_at`;
    const pendingMine = [];
    for (const r of pendingRows) {
      const ok = await canRelease(sql, user.user_id, {
        scope_level: r.scope_level, scope_bu_id: r.scope_bu_id,
        scope_site_id: r.scope_site_id, scope_dept_id: r.scope_dept_id,
      });
      if (ok) pendingMine.push(r);
    }

    // Tài liệu của tôi bị từ chối (kèm lý do, để sửa và nộp lại).
    const rejected = await sql`
      SELECT version_id, doc_id, version_no, title, rejection_reason
        FROM document_versions
       WHERE registrant_user_id = ${user.user_id} AND status = 'tu_choi'
       ORDER BY updated_at DESC`;

    return reply.view('home.eta', { user, pending: pendingMine, rejected });
  });

  // Kiểm tra sức khoẻ cho systemd / proxy ngược (DCS-5 §4.3).
  app.get('/healthz', async () => ({ status: 'ok', phase: 'lifecycle' }));
}
