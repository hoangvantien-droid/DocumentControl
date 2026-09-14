/**
 * src/routes/catalog.ts — danh mục, chi tiết, thu hồi (T-037, T-038, T-036).
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import {
  listVisibleDocuments, loadDetail, loadSections, loadLinks, currentVersionOf, canViewVersion,
} from '../domain/catalog.js';
import { recallVersion, recallImpact } from '../domain/lifecycle.js';
import { canRelease } from '../domain/permissions.js';
import { processVersionContent } from '../domain/content.js';
import { acknowledge, mustAcknowledge, hasAcknowledged } from '../domain/acknowledgement.js';
import { listMatrix, addMatrix, removeMatrix } from '../domain/distribution.js';
import { listDepartments } from '../domain/org.js';
import { listGroups } from '../domain/functional-groups.js';
import type { Config } from '../config.js';

export function registerCatalogRoutes(app: FastifyInstance, sql: Sql, config: Config): void {
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
    if (!detail || !(await canViewVersion(sql, user.user_id, req.params.id))) {
      reply.code(404);
      return reply.send('Không tìm thấy tài liệu');
    }
    const [sections, links] = await Promise.all([
      loadSections(sql, req.params.id), loadLinks(sql, req.params.id),
    ]);
    // Nếu đang xem bản hết hiệu lực, trỏ tới bản đang áp dụng.
    const current = detail.status !== 'hieu_luc' ? await currentVersionOf(sql, detail.doc_id) : null;
    const canRecall = await canRelease(sql, user.user_id, {
      scope_level: detail.scope_level as never,
      scope_bu_id: detail.scope_bu_id, scope_site_id: detail.scope_site_id, scope_dept_id: detail.scope_dept_id,
    });
    // Xác nhận đọc: chỉ hiện nút khi tài liệu hiệu lực + người xem thuộc diện phải đọc + chưa xác nhận.
    let ackState: { show: boolean; done: boolean; inherited: boolean } = { show: false, done: false, inherited: false };
    if (detail.status === 'hieu_luc') {
      const must = await mustAcknowledge(sql, detail.version_id, user.user_id);
      if (must) {
        const h = await hasAcknowledged(sql, detail.version_id, user.user_id);
        ackState = { show: !h.acknowledged, done: h.acknowledged, inherited: h.inherited };
      }
    }
    const matrix = await listMatrix(sql, detail.doc_id);
    return reply.view('detail.eta', { d: detail, sections, links, current, canRecall, ackState, matrix, canRecallMatrix: canRecall });
  });

  // Thu hồi: hiện tác động trước, rồi xác nhận.
  app.get<{ Params: { id: string } }>('/documents/:id/recall', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const detail = await loadDetail(sql, req.params.id);
    if (!detail) { reply.code(404); return reply.send('Không tìm thấy'); }
    const allowed = await canRelease(sql, user.user_id, {
      scope_level: detail.scope_level as never,
      scope_bu_id: detail.scope_bu_id, scope_site_id: detail.scope_site_id, scope_dept_id: detail.scope_dept_id,
    });
    if (!allowed) { reply.code(403); return reply.send('Không đủ thẩm quyền thu hồi tài liệu này'); }
    const impact = await recallImpact(sql, detail.doc_id, req.params.id);
    return reply.view('recall.eta', { d: detail, impact, error: null });
  });

  // Xác nhận đọc (T-069).
  app.post<{ Params: { id: string } }>('/documents/:id/acknowledge', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    try {
      await acknowledge(sql, req.params.id, user.user_id);
      return reply.redirect(`/documents/${req.params.id}`);
    } catch (err) {
      if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
      throw err;
    }
  });

  // Ma trận phân phối (T-065). Thêm/xoá dòng — người release quản lý.
  app.post<{ Params: { id: string }; Body: Record<string, string> }>('/documents/:id/matrix/add', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const detail = await loadDetail(sql, req.params.id);
    if (!detail) { reply.code(404); return reply.send('Không tìm thấy'); }
    const allowed = await canRelease(sql, user.user_id, {
      scope_level: detail.scope_level as never,
      scope_bu_id: detail.scope_bu_id, scope_site_id: detail.scope_site_id, scope_dept_id: detail.scope_dept_id,
    });
    if (!allowed) { reply.code(403); return reply.send('Không đủ thẩm quyền sửa ma trận phân phối'); }
    await addMatrix(sql, {
      docId: detail.doc_id,
      departmentId: req.body.department_id ?? '',
      functionalGroupId: req.body.functional_group_id || null,
      createdBy: user.user_id,
    });
    return reply.redirect(`/documents/${req.params.id}`);
  });

  app.post<{ Params: { id: string }; Body: Record<string, string> }>('/documents/:id/matrix/remove', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const matrixId = req.body.matrix_id ?? '';
    const row = (await sql<{ doc_id: string }[]>`
      SELECT doc_id FROM distribution_matrix WHERE matrix_id = ${matrixId}`)[0];
    const detail = row ? await loadDetail(sql, req.params.id) : null;
    const allowed = detail && row?.doc_id === detail.doc_id && await canRelease(sql, user.user_id, {
      scope_level: detail.scope_level as never,
      scope_bu_id: detail.scope_bu_id, scope_site_id: detail.scope_site_id, scope_dept_id: detail.scope_dept_id,
    });
    if (!allowed) { reply.code(403); return reply.send('Không đủ thẩm quyền sửa ma trận phân phối'); }
    await removeMatrix(sql, matrixId, user.user_id);
    return reply.redirect(`/documents/${req.params.id}`);
  });

  // Danh sách bộ phận + nhóm cho form thêm ma trận (dùng trên detail).
  app.get<{ Params: { id: string } }>('/documents/:id/matrix-options', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const detail = await loadDetail(sql, req.params.id);
    if (!detail) { reply.code(404); return reply.send('Không tìm thấy'); }
    const allowed = await canRelease(sql, user.user_id, {
      scope_level: detail.scope_level as never,
      scope_bu_id: detail.scope_bu_id, scope_site_id: detail.scope_site_id, scope_dept_id: detail.scope_dept_id,
    });
    if (!allowed) { reply.code(403); return reply.send('Không đủ thẩm quyền sửa ma trận phân phối'); }
    const [depts, groups] = await Promise.all([listDepartments(sql), listGroups(sql)]);
    return reply.view('matrix-options.eta', { id: req.params.id, depts, groups });
  });

  // Xử lý nội dung (bóc tách + phân đoạn) — chạy nền, không chặn. Người nộp
  // hoặc người release kích hoạt. Với tệp thật OCR chạy qua jobs/ocr-worker.
  app.post<{ Params: { id: string } }>('/documents/:id/process', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const detail = await loadDetail(sql, req.params.id);
    if (!detail) { reply.code(404); return reply.send('Không tìm thấy'); }
    const isReleaseAuthority = await canRelease(sql, user.user_id, {
      scope_level: detail.scope_level as never,
      scope_bu_id: detail.scope_bu_id, scope_site_id: detail.scope_site_id, scope_dept_id: detail.scope_dept_id,
    });
    if (detail.registrant_user_id !== user.user_id && !isReleaseAuthority) {
      reply.code(403);
      return reply.send('Chỉ người nộp hoặc người có thẩm quyền release được xử lý nội dung');
    }
    await processVersionContent(sql, req.params.id, { tesseractPath: config.tesseractPath });
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
