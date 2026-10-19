/**
 * src/routes/catalog.ts — danh mục, chi tiết, thu hồi (T-037, T-038, T-036).
 */
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import type { Sql } from 'postgres';
import { requireUser, requireDocFlow } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import { sendBusinessError } from '../lib/http-errors.js';
import {
  listVisibleDocuments, loadDetail, loadSections, loadLinks, currentVersionOf, canViewVersion,
  isCurrentStatus,
} from '../domain/catalog.js';
import { listRollout, addSiteRollout, setSiteRolloutStatus, isDraftingDept } from '../domain/rollout.js';
import { listSites } from '../domain/org.js';
import { canViewVersion as canViewDoc } from '../domain/catalog.js';
import { processVersionContent } from '../domain/content.js';
import { listPrintedCopies } from '../domain/printing.js';
import { acknowledge, mustAcknowledge, hasAcknowledged } from '../domain/acknowledgement.js';
import { listDepartments } from '../domain/org.js';
import { listGroups } from '../domain/functional-groups.js';
import type { Config } from '../config.js';

export function registerCatalogRoutes(app: FastifyInstance, sql: Sql, config: Config): void {
  app.get<{ Querystring: { status?: string; q?: string; doc_type?: string; origin?: string; eff_from?: string; eff_to?: string; preset?: string; sort?: string; site_id?: string; rollout_status?: string } }>('/documents', async (req, reply) => {
    const user = await requireDocFlow(sql, req, reply);
    if (!user) return reply;
    const f = {
      status: (req.query.status ?? '').trim() || null,
      q: (req.query.q ?? '').trim() || null,
      doc_type: (req.query.doc_type ?? '').trim() || null,
      origin: (req.query.origin ?? '').trim() || null,
      eff_from: (req.query.eff_from ?? '').trim() || null,
      eff_to: (req.query.eff_to ?? '').trim() || null,
      preset: (req.query.preset ?? '').trim() || null,
      site_id: (req.query.site_id ?? '').trim() || null,
      rollout_status: (req.query.rollout_status ?? '').trim() || null,
      sort: (req.query.sort ?? '').trim() || 'hieu_luc_moi',
    };
    const [docs, sites] = await Promise.all([
      listVisibleDocuments(sql, user.user_id, f, req.nav.isReadOnly),
      listSites(sql),
    ]);
    const escS = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const siteOptions = sites.map((s) => `<option value="${escS(s.site_id)}"${f.site_id === s.site_id ? ' selected' : ''}>${escS(s.site_code)} — ${escS(s.name)}</option>`).join('');
    return reply.view('catalog.eta', { docs, statusFilter: f.status ?? '', filters: f, sites, siteOptions });
  });

  // Xem trước PDF (inline) — cho người duyệt đọc trước khi duyệt.
  // Cho phép bản cho_xac_nhan nếu là người nộp hoặc có quyền release;
  // bản đã duyệt thì theo canViewVersion thông thường.
  app.get<{ Params: { id: string } }>('/documents/:id/preview', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const row = (await sql<{ file_path: string; doc_id: string; version_no: string; status: string; registrant_user_id: string; scope_level: string; scope_bu_id: string | null; scope_site_id: string | null; scope_dept_id: string | null }[]>`
      SELECT v.file_path, v.doc_id, v.version_no, v.status, v.registrant_user_id,
             d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
        FROM document_versions v JOIN documents d ON d.doc_id = v.doc_id
       WHERE v.version_id = ${req.params.id}`)[0];
    if (!row) { reply.code(404); return reply.send('Không tìm thấy tài liệu'); }
    const isPending = row.status === 'cho_xac_nhan' || row.status === 'cho_hoan_thien';
    let ok = false;
    if (isPending) {
      // Mô hình mới: chỉ người đăng ký xem bản nháp/chưa phát hành của mình.
      ok = row.registrant_user_id === user.user_id;
    } else {
      ok = await canViewDoc(sql, user.user_id, req.params.id);
    }
    if (!ok) { reply.code(403); return reply.send('Không có quyền xem tài liệu này'); }
    const absPath = row.file_path;
    if (!absPath || !existsSync(absPath)) { reply.code(404); return reply.send('Tệp không còn tồn tại'); }
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${row.doc_id}_v${row.version_no}.pdf"`);
    return reply.send(readFileSync(absPath));
  });

  // Lỗi #7: tải tệp PDF gốc của phiên bản đã được duyệt (da_dang_ky / hieu_luc).
  // QAKSTL (và mọi người có quyền xem) được tải — không yêu cầu release.
  app.get<{ Params: { id: string } }>('/documents/:id/download', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const row = (await sql<{ file_path: string; doc_id: string; version_no: string; status: string }[]>`
      SELECT file_path, doc_id, version_no, status FROM document_versions
       WHERE version_id = ${req.params.id}`)[0];
    if (!row) { reply.code(404); return reply.send('Không tìm thấy tài liệu'); }
    if (!isCurrentStatus(row.status)) {
      reply.code(403); return reply.send('Chỉ tải được tệp của tài liệu hiện hành');
    }
    if (!(await canViewDoc(sql, user.user_id, req.params.id))) {
      reply.code(403); return reply.send('Không có quyền tải tài liệu này');
    }
    const absPath = row.file_path;
    if (!absPath || !existsSync(absPath)) { reply.code(404); return reply.send('Tệp không còn tồn tại'); }
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${row.doc_id}_v${row.version_no}.pdf"`);
    return reply.send(readFileSync(absPath));
  });


  // Xem PDF nhung truc tiep (inline) - khac /download (attachment ep tai ve).
  app.get<{ Params: { id: string } }>('/documents/:id/view', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const row = (await sql<{ file_path: string; doc_id: string; version_no: string; status: string }[]>`
      SELECT file_path, doc_id, version_no, status FROM document_versions
       WHERE version_id = ${req.params.id}`)[0];
    if (!row) { reply.code(404); return reply.send('Không tìm thấy tài liệu'); }
    if (!isCurrentStatus(row.status)) {
      reply.code(403); return reply.send('Chỉ xem được tệp của tài liệu hiện hành');
    }
    if (!(await canViewDoc(sql, user.user_id, req.params.id))) {
      reply.code(403); return reply.send('Không có quyền xem tài liệu này');
    }
    const absPath = row.file_path;
    if (!absPath || !existsSync(absPath)) { reply.code(404); return reply.send('Tệp không còn tồn tại'); }
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${row.doc_id}_v${row.version_no}.pdf"`);
    return reply.send(readFileSync(absPath));
  });


  app.get<{ Params: { id: string } }>('/documents/:id', async (req, reply) => {
    const user = await requireDocFlow(sql, req, reply);
    if (!user) return reply;
    let detail;
    try {
      detail = await loadDetail(sql, req.params.id);
    } catch { detail = null; }
    if (!detail) { reply.code(404); return reply.send('Không tìm thấy tài liệu'); }
    // Người chỉ-xem (Reader): nếu mở trực tiếp bản KHÔNG hiện hành (lỗi thời/thu
    // hồi/nháp...), chuyển hướng về bản đang áp dụng của cùng doc_id; không có
    // bản hiện hành thì 404 (không lộ bản lỗi thời).
    if (req.nav.isReadOnly && !isCurrentStatus(detail.status)) {
      const current = await currentVersionOf(sql, detail.doc_id);
      if (current) return reply.redirect(`/documents/${current.version_id}`);
      reply.code(404);
      return reply.send('Không tìm thấy tài liệu');
    }
    if (!(await canViewVersion(sql, user.user_id, req.params.id, req.nav.isReadOnly))) {
      reply.code(404);
      return reply.send('Không tìm thấy tài liệu');
    }
    const [sections, links] = await Promise.all([
      loadSections(sql, req.params.id), loadLinks(sql, req.params.id),
    ]);
    // Nếu đang xem bản hết hiệu lực, trỏ tới bản đang áp dụng.
    const current = detail.status !== 'hieu_luc' ? await currentVersionOf(sql, detail.doc_id) : null;
    // Xác nhận đọc: chỉ hiện nút khi tài liệu hiệu lực + người xem thuộc diện phải đọc + chưa xác nhận.
    let ackState: { show: boolean; done: boolean; inherited: boolean } = { show: false, done: false, inherited: false };
    if (detail.status === 'hieu_luc') {
      const must = await mustAcknowledge(sql, detail.version_id, user.user_id);
      if (must) {
        const h = await hasAcknowledged(sql, detail.version_id, user.user_id);
        ackState = { show: !h.acknowledged, done: h.acknowledged, inherited: h.inherited };
      }
    }
    const [rollout, sites] = await Promise.all([
      listRollout(sql, req.params.id),
      listSites(sql),
    ]);
    const canManageRollout = await isDraftingDept(sql, user.user_id, req.params.id);
    const escD = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const siteOptions = sites.map((s) => `<option value="${escD(s.site_id)}">${escD(s.site_code)} — ${escD(s.name)}</option>`).join('');
    const isRegistrant = detail.registrant_user_id === user.user_id;
    return reply.view('detail.eta', { d: detail, sections, links, current, ackState, rollout, sites, siteOptions, canManageRollout, isRegistrant });
  });

  // Rollout theo site: thêm site + ngày áp dụng dự kiến (bộ phận soạn thảo).
  app.post<{ Params: { id: string }; Body: Record<string, string> }>('/documents/:id/rollout/add', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    try {
      await addSiteRollout(sql, {
        versionId: req.params.id,
        siteId: ((req.body ?? {}).site_id ?? '').trim(),
        plannedDate: ((req.body ?? {}).planned_date ?? '').trim() || null,
        actorUserId: user.user_id,
      });
      return reply.redirect(`/documents/${req.params.id}`);
    } catch (err) {
      if (isBusinessError(err)) return sendBusinessError(req, reply, err);
      throw err;
    }
  });

  // Rollout theo site: cập nhật đã áp dụng / tạm hoãn (bộ phận soạn thảo).
  app.post<{ Params: { id: string }; Body: Record<string, string> }>('/documents/:id/rollout/status', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    try {
      await setSiteRolloutStatus(sql, {
        versionId: req.params.id,
        siteId: ((req.body ?? {}).site_id ?? '').trim(),
        status: ((req.body ?? {}).status ?? '').trim() as 'chua_ap_dung' | 'da_ap_dung' | 'tam_hoan',
        appliedDate: ((req.body ?? {}).applied_date ?? '').trim() || null,
        pauseReason: ((req.body ?? {}).pause_reason ?? '').trim() || null,
        actorUserId: user.user_id,
      });
      return reply.redirect(`/documents/${req.params.id}`);
    } catch (err) {
      if (isBusinessError(err)) return sendBusinessError(req, reply, err);
      throw err;
    }
  });

  // Thu hồi: hiện tác động trước, rồi xác nhận.
  app.post<{ Params: { id: string } }>('/documents/:id/acknowledge', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    try {
      await acknowledge(sql, req.params.id, user.user_id);
      return reply.redirect(`/documents/${req.params.id}`);
    } catch (err) {
      if (isBusinessError(err)) return sendBusinessError(req, reply, err);
      throw err;
    }
  });

  // Ma trận phân phối (T-065). Thêm/xoá dòng — người release quản lý.
  app.post<{ Params: { id: string } }>('/documents/:id/process', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const detail = await loadDetail(sql, req.params.id);
    if (!detail) { reply.code(404); return reply.send('Không tìm thấy'); }
    if (detail.registrant_user_id !== user.user_id) {
      reply.code(403);
      return reply.send('Chỉ người đăng ký được xử lý nội dung tài liệu này');
    }
    await processVersionContent(sql, req.params.id, { tesseractPath: config.tesseractPath });
    return reply.redirect(`/documents/${req.params.id}`);
  });

}
