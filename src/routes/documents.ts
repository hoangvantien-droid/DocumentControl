/**
 * src/routes/documents.ts — form đăng ký + tài liệu của tôi (T-021→T-026).
 *
 * Giản lược có chủ ý so với DCS-7 §5.1: form một trang gộp 3 khối thay vì 3
 * bước wizard. Lõi nghiệp vụ (kiểm tra nộp, tạo bản ghi, nhãn liên kết) đầy đủ;
 * chia bước và lưu nháp tự động là cải tiến UX để lại cho vòng sau.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { isBusinessError, BusinessError } from '../lib/errors.js';
import { sendBusinessError } from '../lib/http-errors.js';
import {
  submitRegistration, saveDraft,
  type DocType, type Origin, type ChangeSignificance,
} from '../domain/registration.js';
import { processVersionContent } from '../domain/content.js';
import {
  normalizeSiteIds, listReceiptsForVersion, receiptTally, hasAnyAcceptance,
  editVersionMetadata, deleteUnacceptedVersion, recallByAuthor,
  candidateSitesForScope, publishAdditionalSites,
} from '../domain/receipt.js';
import { aggregateStatusOf } from '../domain/lifecycle-status.js';
import { canRegisterDocuments } from '../domain/permissions.js';
import type { ScopeLevel } from '../domain/roles.js';
import { listBu, listSites, listDepartments } from '../domain/org.js';
import { storeFile } from '../domain/file-store.js';
import { countRecipientsFor } from '../domain/distribution.js';
import type { Config } from '../config.js';

interface RegBody {
  doc_id?: string; doc_type?: string; origin?: string;
  scope_level?: string; scope_bu_id?: string; scope_site_id?: string; scope_dept_id?: string;
  version_no?: string; title?: string; issued_date?: string;
  external_effective_date?: string; effective_date?: string; review_cycle_months?: string; expiry_date?: string;
  file_path?: string; file_hash?: string; owner_department_id?: string;
  supersedes_version_id?: string; change_significance?: string; change_summary?: string;
  /** Site nhận (ban hành thẳng). Multipart gửi nhiều cùng tên -> string[]. */
  site_ids?: string | string[];
  /** Nội dung tệp PDF (Buffer) khi upload multipart. */
  file?: Buffer;
}

export function registerDocumentRoutes(app: FastifyInstance, sql: Sql, config: Config): void {
  // Form đăng ký — 3 vai: chỉ Biên soạn (có DC_AUTHOR) được mở.
  app.get('/register', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const { canRegisterDocuments } = await import('../domain/permissions.js');
    if (!await canRegisterDocuments(sql, user.user_id)) { reply.code(403); return reply.send('Không có quyền đăng ký ban hành tài liệu'); }
    const [bus, sites, depts, supersedeable] = await Promise.all([
      listBu(sql), listSites(sql), listDepartments(sql), listSupersedeableVersions(),
    ]);
    // Lỗi #4: dựng sẵn options HTML (tránh Eta quirk với (expr||[]).forEach).
    const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const supersedeOptions = supersedeable.map((vv) =>
      `<option value="${esc(vv.version_id)}">${esc(vv.doc_id)} v${esc(vv.version_no)} (${esc(vv.status)})</option>`).join('');
    return reply.view('register.eta', { bus, sites, depts, error: null, values: {}, supersedeOptions, selectedSiteIds: [] });
  });

  /** Bản đang hiệu lực / đã đăng ký có thể làm bản gốc cho update (C.2.6). */
  async function listSupersedeableVersions() {
    return sql<{ version_id: string; doc_id: string; version_no: string; status: string }[]>`
      SELECT version_id, doc_id, version_no, status FROM document_versions
       WHERE status IN ('hieu_luc', 'da_dang_ky')
       ORDER BY doc_id, version_no DESC`;
  }

  app.post<{ Body: RegBody }>('/register', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as typeof req.body;
    try {
      // Lưu tệp PDF thật nếu có upload; tính file_path + file_hash SHA-256.
      let filePath = b.file_path || '';
      let fileHash = b.file_hash || '';
      if (b.file && Buffer.isBuffer(b.file) && b.file.length > 0) {
        const stored = await storeFile(config.fileStoragePath, b.file, `${b.doc_id ?? 'doc'}.pdf`);
        filePath = stored.filePath;
        fileHash = stored.fileHash;
      }
      if (!filePath) {
        throw new BusinessError('reg.file', 'Bắt buộc tải lên tệp PDF của tài liệu');
      }
      const versionId = await submitRegistration(
        sql,
        {
          docId: (b.doc_id ?? '').trim(),
          docType: (b.doc_type ?? 'SOP') as DocType,
          origin: (b.origin ?? 'noi_bo') as Origin,
          scopeLevel: (b.scope_level ?? 'site') as ScopeLevel,
          scopeBuId: b.scope_bu_id || null,
          scopeSiteId: b.scope_site_id || null,
          scopeDeptId: b.scope_dept_id || null,
        },
        {
          docId: (b.doc_id ?? '').trim(),
          versionNo: (b.version_no ?? '').trim(),
          title: (b.title ?? '').trim(),
          issuedDate: b.issued_date ?? '',
          externalEffectiveDate: b.external_effective_date || null,
          effectiveDate: b.effective_date ?? '',
          reviewCycleMonths: Number(b.review_cycle_months ?? '12'),
          expiryDate: b.expiry_date || null,
          sourceChannel: 'thu_cong',
          filePath,
          fileHash,
          registrantUserId: user.user_id,
          ownerDepartmentId: b.owner_department_id ?? '',
          supersedesVersionId: b.supersedes_version_id || null,
          changeSignificance: (b.change_significance || null) as ChangeSignificance | null,
          changeSummary: b.change_summary || null,
        },
        { m14Enabled: false, siteIds: normalizeSiteIds(b.site_ids) },
      );
      // Mô hình mới ban hành thẳng: không ép nhãn liên kết lúc đăng ký (đã bỏ
      // mục này khỏi form). Nhãn liên kết quản lý riêng ở màn chi tiết nếu cần.
      // Tự động bóc tách ngay khi đăng ký.
      // Chạy best-effort: lỗi bóc tách không chặn nộp, parse_status giữ nguyên
      // để author thấy ở /my-documents.
      try {
        await processVersionContent(sql, versionId, { tesseractPath: config.tesseractPath });
      } catch (e) {
        req.log.error({ err: e, versionId }, 'auto-extract after register failed');
      }
      return reply.redirect('/my-documents');
    } catch (err) {
      if (isBusinessError(err)) {
        const [bus, sites, depts, supersedeable] = await Promise.all([
          listBu(sql), listSites(sql), listDepartments(sql), listSupersedeableVersions(),
        ]);
        const esc2 = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const supersedeOptions = supersedeable.map((vv) =>
          `<option value="${esc2(vv.version_id)}">${esc2(vv.doc_id)} v${esc2(vv.version_no)} (${esc2(vv.status)})</option>`).join('');
        reply.code(err.httpStatus);
        return reply.view('register.eta', {
          bus, sites, depts, error: err.message, values: b, supersedeOptions,
          selectedSiteIds: normalizeSiteIds(b.site_ids),
        });
      }
      throw err;
    }
  });

  // Lưu nháp (T-024): tạo bản ghi cho_hoan_thien, không validate đầy đủ.
  app.post<{ Body: RegBody }>('/register/draft', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as typeof req.body;
    let filePath = b.file_path || '';
    let fileHash = b.file_hash || '';
    if (b.file && Buffer.isBuffer(b.file) && b.file.length > 0) {
      const stored = await storeFile(config.fileStoragePath, b.file, `${b.doc_id ?? 'doc'}.pdf`);
      filePath = stored.filePath;
      fileHash = stored.fileHash;
    }
    // BUG-003: lưu nháp là bản CHƯA hoàn thiện, không ép người dùng chọn đủ
    // phạm vi. Nếu chưa chọn cấp phạm vi (hoặc chọn cấp cần con trỏ mà chưa có
    // con trỏ), lùi về 'group' — cấp duy nhất không cần con trỏ, hợp lệ với
    // chk_scope_ref. Khi nộp thật ở /register mới validate phạm vi đầy đủ.
    const rawLevel = (b.scope_level ?? '').trim();
    const hasPointer =
      (rawLevel === 'bu' && !!(b.scope_bu_id || '').trim()) ||
      (rawLevel === 'site' && !!(b.scope_site_id || '').trim()) ||
      (rawLevel === 'dept' && !!(b.scope_dept_id || '').trim());
    const draftScopeLevel = (rawLevel === 'group' || hasPointer ? rawLevel : 'group') as ScopeLevel;
    try {
      await saveDraft(
        sql,
        {
          docId: (b.doc_id ?? '').trim(),
          docType: (b.doc_type ?? 'SOP') as DocType,
          origin: (b.origin ?? 'noi_bo') as Origin,
          scopeLevel: draftScopeLevel,
          scopeBuId: b.scope_bu_id || null,
          scopeSiteId: b.scope_site_id || null,
          scopeDeptId: b.scope_dept_id || null,
        },
        {
          docId: (b.doc_id ?? '').trim(),
          versionNo: (b.version_no ?? 'nhap').trim() || 'nhap',
          title: (b.title ?? '(nháp)').trim() || '(nháp)',
          registrantUserId: user.user_id,
          ownerDepartmentId: b.owner_department_id ?? '',
          filePath: filePath || '(chưa có tệp)',
          fileHash: fileHash || 'draft',
        },
      );
      return reply.redirect('/my-documents');
    } catch (err) {
      if (isBusinessError(err)) {
        const [bus, sites, depts, supersedeable] = await Promise.all([
          listBu(sql), listSites(sql), listDepartments(sql), listSupersedeableVersions(),
        ]);
        const esc2 = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const supersedeOptions = supersedeable.map((vv) =>
          `<option value="${esc2(vv.version_id)}">${esc2(vv.doc_id)} v${esc2(vv.version_no)} (${esc2(vv.status)})</option>`).join('');
        reply.code(err.httpStatus);
        return reply.view('register.eta', { bus, sites, depts, error: err.message, values: b, supersedeOptions });
      }
      throw err;
    }
  });

  // Đếm số người sẽ nhận theo bộ phận (T-023) — htmx cập nhật realtime.
  app.get<{ Querystring: { owner_department_id?: string; fg?: string } }>('/register/recipient-count', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const dept = req.query.owner_department_id;
    let count = 0;
    if (dept) count = await countRecipientsFor(sql, dept, req.query.fg || null);
    reply.type('text/html; charset=utf-8');
    return reply.send(`<span>Số người sẽ nhận nếu phân phối tới bộ phận này: <b>${count}</b></span>`);
  });

  // Tài liệu của tôi — lỗi #13: mở cho mọi user đã đăng nhập (không chặn DC_SITE_QA_MANAGER).
  // Lọc theo registrant_user_id nên user chỉ thấy tài liệu của chính mình.
  app.get('/my-documents', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    if (!await canRegisterDocuments(sql, user.user_id)) {
      reply.code(403); return reply.send('Chỉ người biên soạn có mục Tài liệu của tôi');
    }
    // Kèm số liệu receipt theo site để hiển thị trạng thái tổng hợp (Task 5).
    const rows = await sql<{
      version_id: string; doc_id: string; version_no: string; title: string;
      status: string; effective_date: string | null; rejection_reason: string | null;
      parse_status: string | null; parse_note: string | null;
      total: number; accepted: number; rejected: number; pending: number;
      content_rejected: number;
    }[]>`
      SELECT v.version_id, v.doc_id, v.version_no, v.title, v.status,
             v.effective_date::text AS effective_date, v.rejection_reason,
             v.parse_status, v.parse_note,
             count(r.*)::int AS total,
             count(r.*) FILTER (WHERE r.status = 'chap_nhan')::int AS accepted,
             count(r.*) FILTER (WHERE r.status = 'tu_choi')::int AS rejected,
             count(r.*) FILTER (WHERE r.status = 'cho_phan_hoi')::int AS pending
             , count(r.*) FILTER (WHERE r.status = 'tu_choi' AND r.response_type = 'sai_noi_dung')::int AS content_rejected
        FROM document_versions v
        LEFT JOIN document_receipt r ON r.version_id = v.version_id
       WHERE v.registrant_user_id = ${user.user_id}
       GROUP BY v.version_id, v.doc_id, v.version_no, v.title, v.status,
                v.effective_date, v.rejection_reason, v.parse_status, v.parse_note,
                v.submitted_at, v.updated_at
       ORDER BY v.submitted_at DESC NULLS LAST, v.updated_at DESC`;
    const docs = rows.map((d) => ({
      ...d,
      aggregate: aggregateStatusOf({
        total: d.total, accepted: d.accepted, rejected: d.rejected, pending: d.pending,
      }),
      hasContentReject: d.content_rejected > 0,
    }));
    return reply.view('my-documents.eta', { docs });
  });

  // Tình trạng ban hành theo site (Task 5): ma trận phản hồi + hành động Author.
  app.get<{ Params: { id: string } }>('/my-documents/:id/issuance', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const ver = await sql<{ version_id: string; doc_id: string; version_no: string; title: string; status: string; registrant_user_id: string; scope_level: 'group'|'bu'|'site'|'dept'; scope_bu_id: string|null; scope_site_id: string|null; scope_dept_id: string|null }[]>`
      SELECT v.version_id, v.doc_id, v.version_no, v.title, v.status, v.registrant_user_id,
             d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
        FROM document_versions v JOIN documents d ON d.doc_id = v.doc_id
       WHERE v.version_id = ${req.params.id}`;
    const v = ver[0];
    if (!v) { reply.code(404); return reply.send('Không tìm thấy tài liệu'); }
    if (v.registrant_user_id !== user.user_id) {
      reply.code(403); return reply.send('Chỉ người đăng ký xem được tình trạng ban hành tài liệu này');
    }
    const [receipts, tally] = await Promise.all([
      listReceiptsForVersion(sql, v.version_id),
      receiptTally(sql, v.version_id),
    ]);
    const aggregate = aggregateStatusOf(tally);
    const anyAccepted = tally.accepted > 0;
    // Điều kiện mở sửa/thu hồi/xóa (xem Task 6): chưa ai chấp nhận HOẶC có từ chối.
    const canEditOrRecall = tally.accepted === 0 || tally.rejected > 0;
    const canDelete = tally.accepted === 0;
    const hasContentReject = receipts.some((r) => r.status === 'tu_choi' && r.response_type === 'sai_noi_dung');
    const hasMetaReject = receipts.some((r) => r.status === 'tu_choi' && r.response_type === 'sai_dang_ky');
    // Phát hành thêm site (trong scope, chưa có receipt) + phát hành lại (từ chối sai đăng ký).
    const candidates = await candidateSitesForScope(sql, {
      scope_level: v.scope_level, scope_bu_id: v.scope_bu_id,
      scope_site_id: v.scope_site_id, scope_dept_id: v.scope_dept_id,
    });
    const existingSiteIds = new Set(receipts.map((r) => r.site_id));
    const addableNew = candidates.filter((siteOpt) => !existingSiteIds.has(siteOpt.site_id));
    const republishable = receipts.filter((r) => r.status === 'tu_choi' && r.response_type === 'sai_dang_ky');
    const blockedByContentReject = hasContentReject;
    return reply.view('issuance-status.eta', {
      v, receipts, tally, aggregate, anyAccepted,
      canEditOrRecall, canDelete, hasContentReject, hasMetaReject,
      addableNew, republishable, blockedByContentReject,
    });
  });

  // Sửa metadata tại chỗ (Loại 1 — sai đăng ký). Khóa doc_id + file.
  app.get<{ Params: { id: string } }>('/my-documents/:id/edit-metadata', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const rows = await sql<{
      version_id: string; doc_id: string; version_no: string; title: string;
      issued_date: string | null; effective_date: string | null;
      review_cycle_months: number | null; expiry_date: string | null;
      owner_department_id: string | null; status: string; registrant_user_id: string;
    }[]>`
      SELECT version_id, doc_id, version_no, title,
             issued_date::text AS issued_date, effective_date::text AS effective_date,
             review_cycle_months, expiry_date::text AS expiry_date,
             owner_department_id, status, registrant_user_id
        FROM document_versions WHERE version_id = ${req.params.id}`;
    const v = rows[0];
    if (!v) { reply.code(404); return reply.send('Không tìm thấy tài liệu'); }
    if (v.registrant_user_id !== user.user_id) { reply.code(403); return reply.send('Chỉ người đăng ký được sửa'); }
    const accepted = await hasAnyAcceptance(sql, v.version_id);
    const depts = await listDepartments(sql);
    return reply.view('edit-metadata.eta', { v, depts, locked: accepted, error: null });
  });

  app.post<{ Params: { id: string }; Body: Record<string, string> }>('/my-documents/:id/edit-metadata', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as typeof req.body;
    try {
      await editVersionMetadata(sql, {
        versionId: req.params.id, userId: user.user_id,
        patch: {
          title: (b.title ?? '').trim() || undefined,
          issuedDate: b.issued_date || undefined,
          effectiveDate: b.effective_date || undefined,
          reviewCycleMonths: b.review_cycle_months ? Number(b.review_cycle_months) : undefined,
          expiryDate: b.expiry_date || null,
          ownerDepartmentId: b.owner_department_id || undefined,
        },
      });
      return reply.redirect(`/my-documents/${req.params.id}/issuance`);
    } catch (err) {
      if (isBusinessError(err)) return sendBusinessError(req, reply, err);
      throw err;
    }
  });

  // Thu hồi bởi Author (điều kiện mở trong domain).
  app.get<{ Params: { id: string } }>('/my-documents/:id/recall', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const rows = await sql<{ version_id: string; doc_id: string; version_no: string; title: string; registrant_user_id: string }[]>`
      SELECT version_id, doc_id, version_no, title, registrant_user_id
        FROM document_versions WHERE version_id = ${req.params.id}`;
    const v = rows[0];
    if (!v) { reply.code(404); return reply.send('Không tìm thấy tài liệu'); }
    if (v.registrant_user_id !== user.user_id) { reply.code(403); return reply.send('Chỉ người đăng ký được thu hồi'); }
    const tally = await receiptTally(sql, v.version_id);
    return reply.view('author-recall.eta', { v, tally, error: null });
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>('/my-documents/:id/recall', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    try {
      await recallByAuthor(sql, { versionId: req.params.id, userId: user.user_id, reason: (req.body ?? {}).reason ?? '' });
      return reply.redirect('/my-documents');
    } catch (err) {
      if (isBusinessError(err)) return sendBusinessError(req, reply, err);
      throw err;
    }
  });

  // Phát hành thêm site (trong scope) + phát hành lại site từ chối sai đăng ký.
  app.post<{ Params: { id: string }; Body: { site_ids?: string | string[] } }>('/my-documents/:id/publish-sites', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    try {
      await publishAdditionalSites(sql, {
        versionId: req.params.id, userId: user.user_id,
        siteIds: normalizeSiteIds((req.body ?? {}).site_ids),
      });
      return reply.redirect(`/my-documents/${req.params.id}/issuance`);
    } catch (err) {
      if (isBusinessError(err)) return sendBusinessError(req, reply, err);
      throw err;
    }
  });

  // Xóa bản ban hành (chỉ khi chưa có chấp nhận).
  app.post<{ Params: { id: string } }>('/my-documents/:id/delete', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    try {
      await deleteUnacceptedVersion(sql, { versionId: req.params.id, userId: user.user_id });
      return reply.redirect('/my-documents');
    } catch (err) {
      if (isBusinessError(err)) return sendBusinessError(req, reply, err);
      throw err;
    }
  });

  // Sửa nháp (lỗi #3): mở lại bản cho_hoan_thien đã lưu, điền sẵn vào form.
  app.get<{ Params: { id: string } }>('/my-documents/:id/edit', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const rows = await sql`
      SELECT v.version_id, v.doc_id, v.version_no, v.title,
             v.issued_date::text AS issued_date,
             v.external_effective_date::text AS external_effective_date,
             v.effective_date::text AS effective_date, v.review_cycle_months,
             v.expiry_date::text AS expiry_date, v.file_path, v.file_hash,
             v.owner_department_id, v.supersedes_version_id,
             v.change_significance, v.change_summary,
             d.doc_type, d.origin, d.scope_level,
             d.scope_bu_id, d.scope_site_id, d.scope_dept_id
        FROM document_versions v
        JOIN documents d ON d.doc_id = v.doc_id
       WHERE v.version_id = ${req.params.id}
         AND v.registrant_user_id = ${user.user_id}
         AND v.status = 'cho_hoan_thien'`;
    const draft = rows[0];
    if (!draft) { reply.code(404); return reply.send('Không tìm thấy nháp để sửa'); }
    const [bus, sites, depts, supersedeable] = await Promise.all([
      listBu(sql), listSites(sql), listDepartments(sql), listSupersedeableVersions(),
    ]);
    const esc3 = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const supersedeOptions = supersedeable.map((vv) =>
      `<option value="${esc3(vv.version_id)}"${draft.supersedes_version_id === vv.version_id ? ' selected' : ''}>${esc3(vv.doc_id)} v${esc3(vv.version_no)} (${esc3(vv.status)})</option>`).join('');
    return reply.view('register.eta', {
      bus, sites, depts, error: null,
      values: draft,
      editVersionId: draft.version_id,
      supersedeOptions,
    });
  });

  // Cập nhật nháp đã sửa (lỗi #3): ghi đè bản cho_hoan_thien cũ.
  app.post<{ Params: { id: string }; Body: RegBody }>('/my-documents/:id/edit', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as typeof req.body;
    const existing = await sql`
      SELECT version_id, status FROM document_versions
       WHERE version_id = ${req.params.id}
         AND registrant_user_id = ${user.user_id}
         AND status = 'cho_hoan_thien'`;
    if (!existing[0]) { reply.code(404); return reply.send('Không tìm thấy nháp để sửa'); }
    let filePath = b.file_path || '';
    let fileHash = b.file_hash || '';
    if (b.file && Buffer.isBuffer(b.file) && b.file.length > 0) {
      const stored = await storeFile(config.fileStoragePath, b.file, `${b.doc_id ?? 'doc'}.pdf`);
      filePath = stored.filePath;
      fileHash = stored.fileHash;
    }
    const rawLevel = (b.scope_level ?? '').trim();
    const hasPointer =
      (rawLevel === 'bu' && !!(b.scope_bu_id || '').trim()) ||
      (rawLevel === 'site' && !!(b.scope_site_id || '').trim()) ||
      (rawLevel === 'dept' && !!(b.scope_dept_id || '').trim());
    const draftScopeLevel = (rawLevel === 'group' || hasPointer ? rawLevel : 'group') as ScopeLevel;
    try {
      await saveDraft(
        sql,
        {
          docId: (b.doc_id ?? '').trim(),
          docType: (b.doc_type ?? 'SOP') as DocType,
          origin: (b.origin ?? 'noi_bo') as Origin,
          scopeLevel: draftScopeLevel,
          scopeBuId: b.scope_bu_id || null,
          scopeSiteId: b.scope_site_id || null,
          scopeDeptId: b.scope_dept_id || null,
        },
        {
          docId: (b.doc_id ?? '').trim(),
          versionNo: (b.version_no ?? 'nhap').trim() || 'nhap',
          title: (b.title ?? '(nháp)').trim() || '(nháp)',
          registrantUserId: user.user_id,
          ownerDepartmentId: b.owner_department_id ?? '',
          filePath: filePath || '(chưa có tệp)',
          fileHash: fileHash || 'draft',
        },
      );
      // Xoá bản nháp cũ sau khi lưu bản mới (giữ nguyên lịch sử audit của bản cũ).
      await sql`DELETE FROM document_versions WHERE version_id = ${req.params.id}`;
      return reply.redirect('/my-documents');
    } catch (err) {
      if (isBusinessError(err)) {
        const [bus, sites, depts, supersedeable] = await Promise.all([
          listBu(sql), listSites(sql), listDepartments(sql), listSupersedeableVersions(),
        ]);
        const esc4 = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const supersedeOptions = supersedeable.map((vv) =>
          `<option value="${esc4(vv.version_id)}">${esc4(vv.doc_id)} v${esc4(vv.version_no)} (${esc4(vv.status)})</option>`).join('');
        reply.code(err.httpStatus);
        return reply.view('register.eta', {
          bus, sites, depts, error: err.message, values: b, editVersionId: req.params.id,
          supersedeOptions,
        });
      }
      throw err;
    }
  });
}
