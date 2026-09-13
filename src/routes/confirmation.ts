/**
 * src/routes/confirmation.ts — hàng chờ xác nhận + màn xác nhận (T-027→T-029).
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import {
  loadForConfirm, buildChecklist, hasViewedDiff,
  confirmRegistration, rejectRegistration,
} from '../domain/confirmation.js';
import { canRelease } from '../domain/permissions.js';
import { writeAudit } from '../lib/audit.js';

export function registerConfirmationRoutes(app: FastifyInstance, sql: Sql): void {
  // Hàng chờ tôi xác nhận — lọc theo quyền release (đơn giản: liệt kê cho_xac_nhan
  // rồi kiểm canRelease từng cái; quy mô nhỏ nên chấp nhận được).
  app.get('/pending-confirmation', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const rows = await sql`
      SELECT v.version_id, v.doc_id, v.version_no, v.title,
             v.effective_date::text AS effective_date,
             d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
        FROM document_versions v JOIN documents d ON d.doc_id = v.doc_id
       WHERE v.status = 'cho_xac_nhan'
       ORDER BY v.submitted_at`;
    const visible = [];
    for (const r of rows) {
      const ok = await canRelease(sql, user.user_id, {
        scope_level: r.scope_level, scope_bu_id: r.scope_bu_id,
        scope_site_id: r.scope_site_id, scope_dept_id: r.scope_dept_id,
      });
      if (ok) visible.push(r);
    }
    return reply.view('pending.eta', { docs: visible });
  });

  // Màn xác nhận
  app.get<{ Params: { id: string } }>('/confirm/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const v = await loadForConfirm(sql, req.params.id);
    if (!v) { reply.code(404); return reply.send('Không tìm thấy'); }
    const allowed = await canRelease(sql, user.user_id, {
      scope_level: v.scope_level, scope_bu_id: v.scope_bu_id,
      scope_site_id: v.scope_site_id, scope_dept_id: v.scope_dept_id,
    });
    const checklist = await buildChecklist(sql, v, user.user_id);
    const viewedDiff = v.supersedes_version_id ? await hasViewedDiff(sql, user.user_id, v.version_id) : true;
    const effectivePassed = v.effective_date !== null && v.effective_date >= new Date().toISOString().slice(0, 10);
    return reply.view('confirm.eta', { v, checklist, allowed, viewedDiff, effectivePassed, error: null });
  });

  // Ghi vết đã xem so sánh (mở khoá ô 9b). Giai đoạn 5 có màn so sánh thật;
  // ở đây ghi sự kiện xem_so_sanh để cơ chế khoá 9b hoạt động đúng.
  app.post<{ Params: { id: string } }>('/confirm/:id/viewed-diff', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    await sql.begin(async (tx) => {
      await writeAudit(tx as never, {
        eventType: 'xem_so_sanh', actorUserId: user.user_id,
        objectType: 'document_versions', objectId: req.params.id,
      });
    });
    return reply.redirect(`/confirm/${req.params.id}`);
  });

  // Xác nhận
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    '/confirm/:id/approve',
    async (req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return reply;
      // Các mục Admin tự tích (7,8,9,[9b]) gửi lên dạng checkbox on.
      const b = req.body;
      const adminChecksPassed =
        b.chk7 === 'on' && b.chk8 === 'on' && b.chk9 === 'on' &&
        (b.needs9b !== 'true' || b.chk9b === 'on');
      try {
        const { outcome } = await confirmRegistration(sql, {
          versionId: req.params.id, adminUserId: user.user_id, adminChecksPassed,
        });
        return reply.redirect(outcome === 'da_dang_ky' ? '/pending-confirmation' : '/pending-confirmation');
      } catch (err) {
        if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
        throw err;
      }
    },
  );

  // Từ chối
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/confirm/:id/reject',
    async (req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return reply;
      try {
        await rejectRegistration(sql, {
          versionId: req.params.id, adminUserId: user.user_id, reason: req.body.reason ?? '',
        });
        return reply.redirect('/pending-confirmation');
      } catch (err) {
        if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
        throw err;
      }
    },
  );
}
