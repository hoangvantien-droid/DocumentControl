/**
 * src/routes/data-check.ts — lỗi #16: trang read-only kiểm tra dữ liệu nhập.
 *
 * Mọi user đã đăng nhập đều xem được. Liệt kê bản nháp (cho_hoan_thien) và bản
 * chờ xác nhận (cho_xac_nhan) của chính user, kèm checklist tự động giống trang
 * xác nhận (tái dùng buildChecklist). KHÔNG đổi trạng thái tài liệu.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { buildChecklist, type ChecklistItem } from '../domain/confirmation.js';

export function registerDataCheckRoutes(app: FastifyInstance, sql: Sql): void {
  app.get('/data-check', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;

    // Lấy tất cả bản nháp + chờ xác nhận của user, kèm scope.
    const rows = await sql<{
      version_id: string; doc_id: string; version_no: string; title: string;
      doc_type: string; status: string; effective_date: string | null;
      file_hash: string; approval_reference: string | null;
      registrant_user_id: string; supersedes_version_id: string | null;
      parse_status: string; scope_level: 'group' | 'bu' | 'site' | 'dept';
      scope_bu_id: string | null; scope_site_id: string | null; scope_dept_id: string | null;
    }[]>`
      SELECT v.version_id, v.doc_id, v.version_no, v.title, d.doc_type, v.status,
             v.effective_date::text AS effective_date, v.file_hash, v.approval_reference,
             v.registrant_user_id, v.supersedes_version_id, v.parse_status,
             d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
        FROM document_versions v
        JOIN documents d ON d.doc_id = v.doc_id
       WHERE v.registrant_user_id = ${user.user_id}
         AND v.status IN ('cho_hoan_thien', 'cho_xac_nhan')
       ORDER BY v.submitted_at DESC NULLS LAST, v.updated_at DESC`;

    // Dựng checklist tự động cho mỗi version (giống trang xác nhận, mục 7-9 null).
    const items: Array<{
      version: (typeof rows)[number];
      checklist: ChecklistItem[];
    }> = [];
    for (const v of rows) {
      const checklist = await buildChecklist(sql, v, user.user_id);
      items.push({ version: v, checklist });
    }

    return reply.view('data-check.eta', { user, items });
  });
}
