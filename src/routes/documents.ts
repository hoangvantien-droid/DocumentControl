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
import {
  submitRegistration, addLink, saveDraft,
  type DocType, type Origin, type ApprovalMethod, type ChangeSignificance,
} from '../domain/registration.js';
import type { ScopeLevel } from '../domain/roles.js';
import { listBu, listSites, listDepartments } from '../domain/org.js';
import { storeFile } from '../domain/file-store.js';
import { countRecipientsFor } from '../domain/distribution.js';
import type { Config } from '../config.js';

interface RegBody {
  doc_id?: string; doc_type?: string; origin?: string;
  scope_level?: string; scope_bu_id?: string; scope_site_id?: string; scope_dept_id?: string;
  version_no?: string; title?: string; issued_date?: string;
  approver_name?: string; approval_reference?: string; approval_url?: string; approval_method?: string;
  external_effective_date?: string; effective_date?: string; review_cycle_months?: string; expiry_date?: string;
  file_path?: string; file_hash?: string; owner_department_id?: string;
  supersedes_version_id?: string; change_significance?: string; change_summary?: string;
  link_type?: string; link_code?: string;
  /** Nội dung tệp PDF (Buffer) khi upload multipart. */
  file?: Buffer;
}

export function registerDocumentRoutes(app: FastifyInstance, sql: Sql, config: Config): void {
  // Form đăng ký
  app.get('/register', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const [bus, sites, depts] = await Promise.all([listBu(sql), listSites(sql), listDepartments(sql)]);
    return reply.view('register.eta', { bus, sites, depts, error: null, values: {} });
  });

  app.post<{ Body: RegBody }>('/register', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const b = req.body;
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
          approverName: (b.approver_name ?? '').trim(),
          approvalReference: b.approval_reference || null,
          approvalUrl: b.approval_url || null,
          approvalMethod: (b.approval_method ?? 'ky_so') as ApprovalMethod,
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
        { m14Enabled: false },
      );
      // Nhãn liên kết tối thiểu (REQ số 9 = Chặn khi rời cho_xac_nhan).
      if (b.link_type && b.link_code) {
        await addLink(sql, {
          versionId,
          linkType: b.link_type as 'dieu_khoan' | 'cong_doan' | 'diem_kiem_soat' | 'moi_nguy' | 'tai_lieu',
          linkCode: b.link_code.trim(),
          createdBy: user.user_id,
        });
      }
      return reply.redirect('/my-documents');
    } catch (err) {
      if (isBusinessError(err)) {
        const [bus, sites, depts] = await Promise.all([listBu(sql), listSites(sql), listDepartments(sql)]);
        reply.code(err.httpStatus);
        return reply.view('register.eta', { bus, sites, depts, error: err.message, values: b });
      }
      throw err;
    }
  });

  // Lưu nháp (T-024): tạo bản ghi cho_hoan_thien, không validate đầy đủ.
  app.post<{ Body: RegBody }>('/register/draft', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const b = req.body;
    let filePath = b.file_path || '';
    let fileHash = b.file_hash || '';
    if (b.file && Buffer.isBuffer(b.file) && b.file.length > 0) {
      const stored = await storeFile(config.fileStoragePath, b.file, `${b.doc_id ?? 'doc'}.pdf`);
      filePath = stored.filePath;
      fileHash = stored.fileHash;
    }
    await saveDraft(
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
        versionNo: (b.version_no ?? 'nhap').trim() || 'nhap',
        title: (b.title ?? '(nháp)').trim() || '(nháp)',
        registrantUserId: user.user_id,
        ownerDepartmentId: b.owner_department_id ?? '',
        filePath: filePath || '(chưa có tệp)',
        fileHash: fileHash || 'draft',
      },
    );
    return reply.redirect('/my-documents');
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

  // Tài liệu của tôi
  app.get('/my-documents', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const docs = await sql`
      SELECT version_id, doc_id, version_no, title, status,
             effective_date::text AS effective_date, rejection_reason
        FROM document_versions
       WHERE registrant_user_id = ${user.user_id}
       ORDER BY submitted_at DESC NULLS LAST, updated_at DESC`;
    return reply.view('my-documents.eta', { docs });
  });
}
