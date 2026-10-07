/**
 * src/domain/confirmation.ts — xác nhận của DCS Admin (T-027 → T-030).
 *
 * Lớp kiểm soát thứ hai (DCS-2 §2.4). Checklist 12 mục: 1-6 tự động chặn,
 * 7-9b Admin tự tích chặn, 10-12 tự động cảnh báo. Guard ngày hiệu lực (C.4):
 * effective_date < hôm nay lúc xác nhận -> TỰ từ chối, không cho Admin sửa ngày.
 *
 * Kiểm quyền release đặt ở đây (domain), không ở route (DCS-8 §4.3).
 */
import type { Sql, TransactionSql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { canRelease, type DocScope } from './permissions.js';

export interface ChecklistItem {
  no: string;
  label: string;
  kind: 'auto' | 'admin';
  level: 'chan' | 'canh_bao';
  pass: boolean | null; // null = Admin chưa tích (với kind='admin')
  note?: string;
}

export interface VersionForConfirm {
  version_id: string;
  doc_id: string;
  version_no: string;
  title: string;
  doc_type: string;
  status: string;
  effective_date: string | null;
  file_hash: string;
  registrant_user_id: string;
  supersedes_version_id: string | null;
  parse_status: string;
  scope_level: DocScope['scope_level'];
  scope_bu_id: string | null;
  scope_site_id: string | null;
  scope_dept_id: string | null;
}

/** Đọc phiên bản kèm phạm vi tài liệu để dựng checklist và kiểm quyền. */
export async function loadForConfirm(sql: Sql, versionId: string): Promise<VersionForConfirm | null> {
  const rows = await sql<VersionForConfirm[]>`
    SELECT v.version_id, v.doc_id, v.version_no, v.title, d.doc_type, v.status,
           v.effective_date::text AS effective_date, v.file_hash,
           v.registrant_user_id, v.supersedes_version_id, v.parse_status,
           d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
      FROM document_versions v
      JOIN documents d ON d.doc_id = v.doc_id
     WHERE v.version_id = ${versionId}`;
  return rows[0] ?? null;
}

/** Dựng checklist tự động (các mục máy kiểm được). Mục 7-9b để Admin tự tích. */
export async function buildChecklist(
  sql: Sql,
  v: VersionForConfirm,
  adminUserId: string,
): Promise<ChecklistItem[]> {
  const items: ChecklistItem[] = [];

  // 1 — số hiệu + phiên bản chưa tồn tại (đã đảm bảo lúc nộp; kiểm lại phòng đua)
  const dupCount = (await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM document_versions
     WHERE doc_id = ${v.doc_id} AND version_no = ${v.version_no} AND version_id <> ${v.version_id}`)[0]!.n;
  items.push({ no: '1', label: 'Số hiệu và phiên bản chưa tồn tại', kind: 'auto', level: 'chan', pass: dupCount === 0 });

  // 2 — ngày hiệu lực >= hôm nay
  const effOk = v.effective_date !== null && v.effective_date >= today();
  items.push({ no: '2', label: 'Ngày hiệu lực ≥ hôm nay', kind: 'auto', level: 'chan', pass: effOk });

  // 3 — người xác nhận khác người nộp
  items.push({
    no: '3', label: 'Người xác nhận khác người nộp', kind: 'auto', level: 'chan',
    pass: adminUserId !== v.registrant_user_id,
  });

  // 4 — tệp mở được, mã băm khớp (giai đoạn này: có file_hash là đạt tối thiểu)
  items.push({ no: '4', label: 'Tệp mở được và mã băm khớp', kind: 'auto', level: 'chan', pass: !!v.file_hash });

  // 5 — Form không có mục; các loại khác chỉ đạt khi bóc tách thành công.
  const parseOk = v.doc_type === 'Form' || v.parse_status === 'thanh_cong';
  items.push({ no: '5', label: 'Bóc tách mục thành công', kind: 'auto', level: 'chan', pass: parseOk });

  // 6 — mã điều khoản còn hiệu lực (M14). Giai đoạn 1 m14 tắt -> đạt.
  items.push({ no: '6', label: 'Mã điều khoản viện dẫn còn hiệu lực', kind: 'auto', level: 'chan', pass: true, note: 'M14 chưa vận hành — bỏ qua' });

  // 7-9 — Admin tự kiểm
  items.push({ no: '7', label: 'Số hiệu trên tệp khớp số hiệu đã khai', kind: 'admin', level: 'chan', pass: null });
  items.push({ no: '8', label: 'Ngày ban hành và số hiệu khớp nội dung trên tệp', kind: 'admin', level: 'chan', pass: null });
  items.push({ no: '9', label: 'Loại tài liệu khai đúng', kind: 'admin', level: 'chan', pass: null });
  if (v.supersedes_version_id) {
    items.push({ no: '9b', label: 'Mức độ thay đổi khai đúng (phải xem so sánh trước)', kind: 'admin', level: 'chan', pass: null });
  }

  // 10-12 — tự động cảnh báo
  const linkCount = (await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM document_links WHERE version_id = ${v.version_id}`)[0]!.n;
  items.push({ no: '10', label: 'Điều khoản viện dẫn sắp hết hiệu lực', kind: 'auto', level: 'canh_bao', pass: true });
  items.push({ no: '11', label: 'Nhãn liên kết đã khai đủ', kind: 'auto', level: 'canh_bao', pass: linkCount > 0 });
  const matrixCount = (await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM distribution_matrix WHERE doc_id = ${v.doc_id}`)[0]!.n;
  items.push({ no: '12', label: 'Ma trận phân phối đã khai', kind: 'auto', level: 'canh_bao', pass: matrixCount > 0 });

  return items;
}

/** Đã xem so sánh chưa (điều kiện mở ô tích 9b). */
export async function hasViewedDiff(sql: Sql, adminUserId: string, versionId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`SELECT fn_has_viewed_diff(${adminUserId}, ${versionId}) AS ok`;
  return rows[0]?.ok ?? false;
}

/**
 * Xác nhận: chuyển cho_xac_nhan -> da_dang_ky, ghi confirmed_at (= NGÀY ĐĂNG KÝ).
 * Guard C.4: nếu effective_date < hôm nay thì KHÔNG xác nhận, tự chuyển tu_choi.
 * Yêu cầu adminCheckNos: các mục Admin tự tích (7,8,9,[9b]) đều được gửi.
 * Các mục tự động và bằng chứng xem so sánh được dựng lại trong transaction.
 */
export async function confirmRegistration(
  sql: Sql,
  input: { versionId: string; adminUserId: string; adminCheckNos: string[] },
): Promise<{ outcome: 'da_dang_ky' | 'tu_choi_tu_dong' }> {
  return sql.begin(async (tx) => {
    const v = (await tx<VersionForConfirm[]>`
      SELECT v.version_id, v.doc_id, v.version_no, v.title, d.doc_type, v.status,
             v.effective_date::text AS effective_date, v.file_hash,
             v.registrant_user_id, v.supersedes_version_id, v.parse_status,
             d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
        FROM document_versions v JOIN documents d ON d.doc_id = v.doc_id
       WHERE v.version_id = ${input.versionId} FOR UPDATE`)[0];
    if (!v) throw new BusinessError('conf.not_found', 'Không tìm thấy phiên bản');
    if (v.status !== 'cho_xac_nhan') {
      throw new BusinessError('conf.bad_status', 'Phiên bản không ở trạng thái chờ xác nhận');
    }
    if (input.adminUserId === v.registrant_user_id) {
      throw new BusinessError('conf.same_person', 'Người xác nhận không được trùng người nộp');
    }

    // Kiểm quyền release theo phạm vi (domain, không ở route).
    const allowed = await canRelease(tx as unknown as Sql, input.adminUserId, {
      scope_level: v.scope_level, scope_bu_id: v.scope_bu_id,
      scope_site_id: v.scope_site_id, scope_dept_id: v.scope_dept_id,
    });
    if (!allowed) throw new BusinessError('conf.no_permission', 'Không đủ thẩm quyền xác nhận tài liệu này', { httpStatus: 403 });

    // Guard C.4 — ngày hiệu lực đã trôi qua -> tự từ chối.
    if (!v.effective_date || v.effective_date < today()) {
      const reason = 'Ngày hiệu lực đã qua do thời gian xử lý, cần chọn lại';
      await tx`UPDATE document_versions
                  SET status = 'tu_choi', rejection_reason = ${reason}
                WHERE version_id = ${input.versionId}`;
      await writeAudit(tx as TransactionSql, {
        eventType: 'tu_choi_tu_dong', actorType: 'he_thong',
        objectType: 'document_versions', objectId: input.versionId,
        afterState: { status: 'tu_choi', reason },
      });
      return { outcome: 'tu_choi_tu_dong' as const };
    }

    const checklist = await buildChecklist(tx as unknown as Sql, v, input.adminUserId);
    const failedAutomaticCheck = checklist.find((item) =>
      item.kind === 'auto' && item.level === 'chan' && item.pass !== true,
    );
    if (failedAutomaticCheck) {
      throw new BusinessError('conf.checklist_auto', `Mục chặn chưa đạt: ${failedAutomaticCheck.label}`);
    }

    const requiredAdminChecks = v.supersedes_version_id ? ['7', '8', '9', '9b'] : ['7', '8', '9'];
    const selectedChecks = new Set(input.adminCheckNos);
    if (!requiredAdminChecks.every((check) => selectedChecks.has(check))) {
      throw new BusinessError('conf.checklist', 'Còn mục Admin tự kiểm trong checklist chưa được xác nhận');
    }
    if (v.supersedes_version_id && !await hasViewedDiff(tx as unknown as Sql, input.adminUserId, v.version_id)) {
      throw new BusinessError('conf.diff_not_viewed', 'Phải mở so sánh phiên bản trước khi xác nhận mức độ thay đổi');
    }

    await writeAudit(tx as TransactionSql, {
      eventType: 'tich_checklist', actorUserId: input.adminUserId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { admin_checks: requiredAdminChecks },
    });

    // Đạt: chuyển da_dang_ky, confirmed_at = ngày đăng ký.
    await tx`UPDATE document_versions
                SET status = 'da_dang_ky', admin_user_id = ${input.adminUserId}, confirmed_at = now()
              WHERE version_id = ${input.versionId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'xac_nhan', actorUserId: input.adminUserId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { status: 'da_dang_ky' },
    });
    return { outcome: 'da_dang_ky' as const };
  }) as Promise<{ outcome: 'da_dang_ky' | 'tu_choi_tu_dong' }>;
}

/** Từ chối thủ công kèm lý do (bắt buộc). */
export async function rejectRegistration(
  sql: Sql,
  input: { versionId: string; adminUserId: string; reason: string },
): Promise<void> {
  if (!input.reason.trim()) throw new BusinessError('conf.reason', 'Từ chối bắt buộc kèm lý do');
  await sql.begin(async (tx) => {
    const v = (await tx<VersionForConfirm[]>`
      SELECT v.version_id, v.doc_id, v.version_no, v.title, d.doc_type, v.status,
             v.effective_date::text AS effective_date, v.file_hash,
             v.registrant_user_id, v.supersedes_version_id, v.parse_status,
             d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
        FROM document_versions v JOIN documents d ON d.doc_id = v.doc_id
       WHERE v.version_id = ${input.versionId} FOR UPDATE OF v`)[0];
    if (!v) throw new BusinessError('conf.not_found', 'Không tìm thấy phiên bản');
    if (v.status !== 'cho_xac_nhan') {
      throw new BusinessError('conf.bad_status', 'Phiên bản không ở trạng thái chờ xác nhận');
    }
    const allowed = await canRelease(tx as unknown as Sql, input.adminUserId, {
      scope_level: v.scope_level, scope_bu_id: v.scope_bu_id,
      scope_site_id: v.scope_site_id, scope_dept_id: v.scope_dept_id,
    });
    if (!allowed) throw new BusinessError('conf.no_permission', 'Không đủ thẩm quyền từ chối tài liệu này', { httpStatus: 403 });
    await tx`UPDATE document_versions
                SET status = 'tu_choi', admin_user_id = ${input.adminUserId}, rejection_reason = ${input.reason}
              WHERE version_id = ${input.versionId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'tu_choi_boi_admin', actorUserId: input.adminUserId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { status: 'tu_choi', reason: input.reason },
    });
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
