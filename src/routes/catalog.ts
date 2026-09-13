/**
 * src/routes/catalog.ts — danh mục, chi tiết, thu hồi (T-037, T-038, T-036).
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import {
  listVisibleDocuments, loadDetail, loadSections, loadLinks, currentVersionOf,
} from '../domain/catalog.js';
import { recallVersion, recallImpact } from '../domain/lifecycle.js';
import { canRelease } from '../domain/permissions.js';
import { processVersionContent } from '../domain/content.js';

export function registerCatalogRoutes(app: FastifyInstance, sql: Sql): void {
  app.get('/documents', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const docs = await listVisibleDocuments(sql, user.user_id);
    return reply.view('catalog.eta', { docs });
  });

  app.get<{ Params: { id: string } }>('/documents/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const detail = await loadDetail(sql, req.params.id);
    if (!detail) { reply.code(404); return reply.send('Không tìm thấy tài liệu'); }
    const [sections, links] = await Promise.all([
      loadSections(sql, req.params.id), loadLinks(sql, req.params.id),
    ]);
    // Nếu đang xem bản hết hiệu lực, trỏ tới bản đang áp dụng.
    const current = detail.status !== 'hieu_luc' ? await currentVersionOf(sql, detail.doc_id) : null;
    const canRecall = await canRelease(sql, user.user_id, {
      scope_level: detail.scope_level as never,
      scope_bu_id: detail.scope_bu_id, scope_site_id: detail.scope_site_id, scope_dept_id: detail.scope_dept_id,
    });
    return reply.view('detail.eta', { d: detail, sections, links, current, canRecall });
  });

  // Thu hồi: hiện tác động trước, rồi xác nhận.
  app.get<{ Params: { id: string } }>('/documents/:id/recall', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const detail = await loadDetail(sql, req.params.id);
    if (!detail) { reply.code(404); return reply.send('Không tìm thấy'); }
    const impact = await recallImpact(sql, detail.doc_id, req.params.id);
    return reply.view('recall.eta', { d: detail, impact, error: null });
  });

  // Xử lý nội dung (bóc tách + phân đoạn) — chạy nền, không chặn. Người nộp
  // hoặc người release kích hoạt. Với tệp thật OCR chạy qua jobs/ocr-worker.
  app.post<{ Params: { id: string } }>('/documents/:id/process', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    await processVersionContent(sql, req.params.id);
    return reply.redirect(`/documents/${req.params.id}`);
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/documents/:id/recall',
    async (req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return reply;
      try {
        await recallVersion(sql, {
          versionId: req.params.id, adminUserId: user.user_id, reason: req.body.reason ?? '',
        });
        return reply.redirect(`/documents/${req.params.id}`);
      } catch (err) {
        if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
        throw err;
      }
    },
  );
}
