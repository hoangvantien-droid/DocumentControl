/**
 * src/routes/catalog.ts — danh mục, chi tiết, thu hồi (T-037, T-038, T-036).
 */
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import type { Sql } from 'postgres';
import { requireUser, requireDocFlow } from '../middleware/auth.js';
import { roleCodesOf, canExportCatalog } from '../domain/permissions.js';
import { buildWorkbook, streamXlsx, exportFileName, type ColumnDef } from '../lib/xlsx.js';
import { scopeLabel, docStatusLabel, originLabel } from '../views/labels.js';
import { isBusinessError } from '../lib/errors.js';
import { sendBusinessError } from '../lib/http-errors.js';
import {
  listVisibleDocuments, loadDetail, loadSections, loadLinks, currentVersionOf, canViewVersion,
  isCurrentStatus,
} from '../domain/catalog.js';
import type { CatalogFilters, CatalogRow } from '../domain/catalog.js';
import { listSites } from '../domain/org.js';
import { DOC_TYPES } from '../domain/doc-types.js';
import { canViewVersion as canViewDoc } from '../domain/catalog.js';
import { processVersionContent } from '../domain/content.js';
import { listPrintedCopies } from '../domain/printing.js';
import { acknowledge, mustAcknowledge, hasAcknowledged } from '../domain/acknowledgement.js';
import { listReceiptsForVersion } from '../domain/receipt.js';
import { listDepartments } from '../domain/org.js';
import { listGroups } from '../domain/functional-groups.js';
import type { Config } from '../config.js';

/** Hình dạng querystring của bộ lọc danh mục (trang /documents + export). */
type CatalogQuery = {
  status?: string; q?: string; doc_type?: string; origin?: string;
  eff_from?: string; eff_to?: string; preset?: string; sort?: string;
  site_id?: string; rollout_status?: string;
};

/**
 * Parse querystring của /documents thành CatalogFilters dùng chung cho cả
 * trang danh mục và route export (bảo đảm Applied_Filters giống hệt).
 */
function parseCatalogFilters(query: CatalogQuery): CatalogFilters {
  return {
    status: (query.status ?? '').trim() || null,
    q: (query.q ?? '').trim() || null,
    doc_type: (query.doc_type ?? '').trim() || null,
    origin: (query.origin ?? '').trim() || null,
    eff_from: (query.eff_from ?? '').trim() || null,
    eff_to: (query.eff_to ?? '').trim() || null,
    preset: (query.preset ?? '').trim() || null,
    site_id: (query.site_id ?? '').trim() || null,
    rollout_status: (query.rollout_status ?? '').trim() || null,
    sort: (query.sort ?? '').trim() || 'hieu_luc_moi',
  };
}

/**
 * Cột xuất Excel danh mục (Catalog_Export) — thứ tự cố định, KHÔNG có cột
 * File PDF (Yêu cầu 1.4, 1.5). Nhãn tiếng Việt dùng chung nguồn với view layer.
 */
const CATALOG_COLUMNS: ColumnDef<CatalogRow>[] = [
  { header: 'Số hiệu',              value: (r) => r.doc_id },
  { header: 'Phiên bản',            value: (r) => r.version_no },
  { header: 'Tiêu đề',              value: (r) => r.title },
  { header: 'Loại',                 value: (r) => r.doc_type },
  { header: 'Phạm vi',              value: (r) => scopeLabel(r.scope_level) },
  { header: 'Trạng thái',           value: (r) => docStatusLabel(r.status) },
  { header: 'Nguồn',                value: (r) => originLabel(r.origin) },
  { header: 'Ngày ban hành',        value: (r) => r.issued_date ?? '' },
  { header: 'Ngày hiệu lực',        value: (r) => r.effective_date ?? '' },
  { header: 'Ngày rà soát kế tiếp', value: (r) => r.next_review_date ?? '' },
  { header: 'Ngày hết hạn',         value: (r) => r.expiry_date ?? '' },
];

export function registerCatalogRoutes(app: FastifyInstance, sql: Sql, config: Config): void {
  app.get<{ Querystring: CatalogQuery }>('/documents', async (req, reply) => {
    const user = await requireDocFlow(sql, req, reply);
    if (!user) return reply;
    const f = parseCatalogFilters(req.query);
    const [docs, sites] = await Promise.all([
      listVisibleDocuments(sql, user.user_id, f, req.nav.isReadOnly),
      listSites(sql),
    ]);
    const escS = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const siteOptions = sites.map((s) => `<option value="${escS(s.site_id)}"${f.site_id === s.site_id ? ' selected' : ''}>${escS(s.site_code)} — ${escS(s.name)}</option>`).join('');
    // Querystring lọc hiện tại để nút export khớp đúng tập đang hiển thị. Dựng
    // từ CatalogFilters đã parse (chỉ gồm trường có giá trị); keys khớp tên mà
    // route export.xlsx parse lại. Template chỉ chèn chuỗi, không dựng URL thủ công.
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) { if (v) params.set(k, String(v)); }
    const exportQuery = params.toString() ? `?${params.toString()}` : '';
    return reply.view('catalog.eta', { docs, statusFilter: f.status ?? '', filters: f, sites, siteOptions, docTypes: DOC_TYPES, exportQuery });
  });

  // Xuất danh mục Excel (Catalog_Export). Route TĨNH — Fastify ưu tiên route
  // tĩnh hơn route tham số nên /documents/export.xlsx không rơi vào /documents/:id.
  // Kiểm quyền phía máy chủ (Yêu cầu 1.7, 4.1); tập dữ liệu giới hạn trong
  // Visible_Scope theo cùng Applied_Filters với trang /documents (Yêu cầu 1.8, 4.2, 4.4).
  app.get<{ Querystring: CatalogQuery }>('/documents/export.xlsx', async (req, reply) => {
    const user = await requireDocFlow(sql, req, reply);
    if (!user) return reply;
    const roles = await roleCodesOf(sql, user.user_id);
    if (!canExportCatalog(roles)) {
      reply.code(403);
      return reply.send('Chỉ Biên soạn hoặc Kiểm soát tài liệu site được xuất danh mục');
    }
    const filters = parseCatalogFilters(req.query);
    const rows = await listVisibleDocuments(sql, user.user_id, filters, req.nav.isReadOnly);
    const wb = buildWorkbook(CATALOG_COLUMNS, rows, 'Danh mục');
    await streamXlsx(reply, wb, exportFileName('catalog', new Date()));
    return reply;
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
    const [sections, links, receipts] = await Promise.all([
      loadSections(sql, req.params.id), loadLinks(sql, req.params.id),
      listReceiptsForVersion(sql, req.params.id),
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
    const isRegistrant = detail.registrant_user_id === user.user_id;
    return reply.view('detail.eta', { d: detail, sections, links, current, ackState, isRegistrant, receipts });
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
