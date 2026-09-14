/**
 * src/domain/registration.ts — đăng ký tài liệu (T-020 → T-026).
 *
 * Form đăng ký là cổng vào DUY NHẤT đưa tài liệu vào trạng thái Đã đăng ký
 * (REQ-A01). Lớp này: tạo/đọc documents + document_versions, kiểm tra khi nộp
 * (DCS-3 §C.2), chuyển sang cho_xac_nhan.
 *
 * KHÔNG bọc try-catch nuốt lỗi ràng buộc DB (DCS-9 bẫy số 1). Ràng buộc là lớp
 * phòng thủ cuối; tầng này kiểm tra TRƯỚC.
 */
import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import type { ScopeLevel } from './roles.js';
import { canRegisterDocuments } from './permissions.js';

export type DocType = 'SOP' | 'WI' | 'Form' | 'Policy' | 'External';
export type Origin = 'noi_bo' | 'ngoai_bo';
export type ApprovalMethod = 'ky_so' | 'ky_tay_so_hoa' | 'thu_dien_tu_luu_vet';
export type ChangeSignificance = 'lon' | 'nho';

export interface DocumentInput {
  docId: string;
  docType: DocType;
  origin: Origin;
  scopeLevel: ScopeLevel;
  scopeBuId?: string | null;
  scopeSiteId?: string | null;
  scopeDeptId?: string | null;
}

export interface VersionInput {
  docId: string;
  versionNo: string;
  title: string;
  issuedDate: string;
  approverName: string;
  approvalReference?: string | null;
  approvalUrl?: string | null;
  approvalMethod: ApprovalMethod;
  externalEffectiveDate?: string | null;
  effectiveDate: string;
  reviewCycleMonths: number;
  expiryDate?: string | null;
  sourceChannel: 'api' | 'thu_cong';
  filePath: string;
  fileHash: string;
  registrantUserId: string;
  ownerDepartmentId: string;
  supersedesVersionId?: string | null;
  changeSignificance?: ChangeSignificance | null;
  changeSummary?: string | null;
  requiredReaderDeptIds?: string[];
}

/** Tạo bản ghi documents nếu chưa có (doc_id do người nhập, không tự sinh). */
export async function ensureDocument(tx: TransactionSql, doc: DocumentInput): Promise<void> {
  const existing = await tx`SELECT doc_id FROM documents WHERE doc_id = ${doc.docId}`;
  if (existing.length > 0) return;
  await tx`
    INSERT INTO documents (doc_id, doc_type, origin, scope_level, scope_bu_id, scope_site_id, scope_dept_id)
    VALUES (${doc.docId}, ${doc.docType}, ${doc.origin}, ${doc.scopeLevel},
            ${doc.scopeBuId ?? null}, ${doc.scopeSiteId ?? null}, ${doc.scopeDeptId ?? null})`;
}

/** Kiểm tra khi nộp (DCS-3 §C.2, mức Chặn). Ném BusinessError nếu vi phạm. */
export async function validateForSubmit(
  tx: TransactionSql,
  v: VersionInput,
  opts: { m14Enabled: boolean },
): Promise<void> {
  // C.2.1 — đủ trường bắt buộc theo origin
  const doc = (await tx<{ origin: Origin }[]>`SELECT origin FROM documents WHERE doc_id = ${v.docId}`)[0];
  if (!doc) throw new BusinessError('reg.no_doc', 'Chưa có bản ghi tài liệu cho số hiệu này');
  if (doc.origin === 'noi_bo' && !v.approvalReference) {
    throw new BusinessError('reg.approval_ref', 'Tài liệu nội bộ bắt buộc có số hồ sơ phê duyệt');
  }
  if (doc.origin === 'ngoai_bo' && !v.externalEffectiveDate) {
    throw new BusinessError('reg.ext_date', 'Tài liệu ngoại bộ bắt buộc có ngày hiệu lực pháp lý');
  }

  // C.2.2 — cặp doc_id + version_no chưa tồn tại
  const dup = await tx`
    SELECT 1 FROM document_versions WHERE doc_id = ${v.docId} AND version_no = ${v.versionNo}`;
  if (dup.length > 0) {
    throw new BusinessError('reg.duplicate', `Số hiệu ${v.docId} phiên bản ${v.versionNo} đã tồn tại`);
  }

  // C.2.3 — effective_date không nhỏ hơn hôm nay
  if (v.effectiveDate < today()) {
    throw new BusinessError('reg.effective_past', `Ngày hiệu lực phải từ ${today()} trở đi`);
  }

  // C.2.4 — expiry > effective nếu có
  if (v.expiryDate && v.expiryDate <= v.effectiveDate) {
    throw new BusinessError('reg.expiry', 'Ngày hết hạn phải sau ngày hiệu lực');
  }

  // C.2.6 — phiên bản mới thì supersedes phải trỏ bản hieu_luc/da_dang_ky
  if (v.supersedesVersionId) {
    const sup = (await tx<{ status: string }[]>`
      SELECT status FROM document_versions WHERE version_id = ${v.supersedesVersionId}`)[0];
    if (!sup || !['hieu_luc', 'da_dang_ky'].includes(sup.status)) {
      throw new BusinessError('reg.supersedes', 'Phiên bản gốc phải đang Hiệu lực hoặc Đã đăng ký');
    }
    // C.2.9b — mức độ thay đổi bắt buộc, tóm tắt bắt buộc nếu lớn
    if (!v.changeSignificance) {
      throw new BusinessError('reg.change_sig', 'Phiên bản mới bắt buộc khai mức độ thay đổi');
    }
    if (v.changeSignificance === 'lon' && !v.changeSummary) {
      throw new BusinessError('reg.change_summary', 'Thay đổi lớn bắt buộc có tóm tắt');
    }
  }
  // Kiểm tra số 7 (M14) — chỉ khi m14Enabled; giai đoạn 1 cờ này false nên bỏ qua.
  // Kiểm tra số 9 (nhãn liên kết) do trigger DB ép khi rời cho_xac_nhan.
  void opts;
}

/**
 * Nộp đăng ký: tạo document (nếu cần) + document_versions ở cho_xac_nhan.
 * Nhãn liên kết phải được thêm để trigger cho rời cho_xac_nhan sau này (khi
 * xác nhận) — ở đây chỉ tạo bản ghi phiên bản; nhãn thêm qua addLink.
 */
export async function submitRegistration(
  sql: Sql,
  doc: DocumentInput,
  v: VersionInput,
  opts: { m14Enabled: boolean },
): Promise<string> {
  return sql.begin(async (tx) => {
    if (!await canRegisterDocuments(tx as unknown as Sql, v.registrantUserId)) {
      throw new BusinessError('reg.no_permission', 'Không có quyền đăng ký ban hành tài liệu', { httpStatus: 403 });
    }
    await ensureDocument(tx as TransactionSql, doc);
    await validateForSubmit(tx as TransactionSql, v, opts);

    const versionId = randomUUID();
    await tx`
      INSERT INTO document_versions (
        version_id, doc_id, version_no, title,
        issued_date, approver_name, approval_reference, approval_url, approval_method,
        external_effective_date, effective_date, review_cycle_months, expiry_date,
        source_channel, file_path, file_hash,
        status, registrant_user_id, owner_department_id,
        supersedes_version_id, change_significance, change_summary,
        required_reader_dept_ids, submitted_at
      ) VALUES (
        ${versionId}, ${v.docId}, ${v.versionNo}, ${v.title},
        ${v.issuedDate}, ${v.approverName}, ${v.approvalReference ?? null}, ${v.approvalUrl ?? null}, ${v.approvalMethod},
        ${v.externalEffectiveDate ?? null}, ${v.effectiveDate}, ${v.reviewCycleMonths}, ${v.expiryDate ?? null},
        ${v.sourceChannel}, ${v.filePath}, ${v.fileHash},
        'cho_xac_nhan', ${v.registrantUserId}, ${v.ownerDepartmentId},
        ${v.supersedesVersionId ?? null}, ${v.changeSignificance ?? null}, ${v.changeSummary ?? null},
        ${v.requiredReaderDeptIds ?? null}, now()
      )`;

    await writeAudit(tx as TransactionSql, {
      eventType: 'nop_dang_ky',
      objectType: 'document_versions',
      objectId: versionId,
      actorUserId: v.registrantUserId,
      afterState: { doc_id: v.docId, version_no: v.versionNo, status: 'cho_xac_nhan' },
    });
    return versionId;
  }) as Promise<string>;
}

/** Thêm một nhãn liên kết (REQ-D04: created_by luôn là người thật). */
export async function addLink(
  sql: Sql,
  input: {
    versionId: string; sectionId?: string | null;
    linkType: 'dieu_khoan' | 'cong_doan' | 'diem_kiem_soat' | 'moi_nguy' | 'tai_lieu';
    linkCode: string; createdBy: string;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO document_links (version_id, section_id, link_type, link_code, created_by)
      VALUES (${input.versionId}, ${input.sectionId ?? null}, ${input.linkType}, ${input.linkCode}, ${input.createdBy})
      ON CONFLICT (version_id, section_id, link_type, link_code) DO NOTHING`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'khai_nhan',
      objectType: 'document_versions',
      objectId: input.versionId,
      actorUserId: input.createdBy,
      afterState: { link_type: input.linkType, link_code: input.linkCode },
    });
  });
}

/**
 * Lưu nháp: tạo/cập nhật bản ghi ở trạng thái cho_hoan_thien, KHÔNG chạy kiểm
 * tra nộp đầy đủ (T-024). Người nộp thường phải đi hỏi phạm vi/điều khoản —
 * không có lưu nháp thì mất hết khi đóng trình duyệt.
 */
export async function saveDraft(
  sql: Sql,
  doc: DocumentInput,
  v: Partial<VersionInput> & { versionNo: string; title: string; registrantUserId: string; ownerDepartmentId: string; filePath: string; fileHash: string },
): Promise<string> {
  return sql.begin(async (tx) => {
    if (!await canRegisterDocuments(tx as unknown as Sql, v.registrantUserId)) {
      throw new BusinessError('reg.no_permission', 'Không có quyền lưu nháp đăng ký tài liệu', { httpStatus: 403 });
    }
    await ensureDocument(tx as TransactionSql, doc);
    const versionId = randomUUID();
    await tx`
      INSERT INTO document_versions (
        version_id, doc_id, version_no, title,
        issued_date, approver_name, approval_reference, approval_method,
        effective_date, review_cycle_months,
        source_channel, file_path, file_hash,
        status, registrant_user_id, owner_department_id
      ) VALUES (
        ${versionId}, ${v.docId ?? doc.docId}, ${v.versionNo}, ${v.title},
        ${v.issuedDate ?? today()}, ${v.approverName ?? '(chưa điền)'}, ${v.approvalReference ?? null}, ${v.approvalMethod ?? 'ky_so'},
        ${v.effectiveDate ?? today()}, ${v.reviewCycleMonths ?? 12},
        'thu_cong', ${v.filePath}, ${v.fileHash},
        'cho_hoan_thien', ${v.registrantUserId}, ${v.ownerDepartmentId}
      )`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'sua_truoc_khi_nop', actorUserId: v.registrantUserId,
      objectType: 'document_versions', objectId: versionId,
      afterState: { status: 'cho_hoan_thien' },
    });
    return versionId;
  }) as Promise<string>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
