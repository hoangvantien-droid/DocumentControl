/**
 * src/domain/migration-load.ts — nạp tài liệu cũ từ kho hiện có (T-094, DCS-6 §3.2).
 *
 * Xung đột: guard "effective_date >= ngày xác nhận" ngăn tài liệu hiệu lực khi
 * chưa ai được đào tạo. Nhưng tài liệu cũ ĐÃ hiệu lực từ lâu.
 * Giải pháp (KHÔNG tắt guard): effective_date = ngày nạp (thoả guard) +
 * original_effective_date = ngày hiệu lực thật. Chu kỳ rà soát tính theo ngày
 * GỐC (fn_review_anchor_date) để tài liệu quá hạn hiện ra ngay.
 *
 * Vẫn qua luồng xác nhận chuẩn — KHÔNG tạo đường tắt vào hiệu lực (DCS-9 bẫy #4).
 */
import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { ensureDocument, type DocumentInput } from './registration.js';

export interface MigratedVersionInput {
  docId: string;
  versionNo: string;
  title: string;
  issuedDate: string;
  approverName: string;
  approvalReference?: string | null;
  /** Ngày hiệu lực THẬT ngoài đời (quá khứ) — bắt buộc với bản nạp. */
  originalEffectiveDate: string;
  reviewCycleMonths: number;
  filePath: string;
  fileHash: string;
  registrantUserId: string;
  ownerDepartmentId: string;
}

/** Nạp một tài liệu cũ ở trạng thái cho_xac_nhan, migrated_record=TRUE. */
export async function loadMigratedVersion(
  sql: Sql,
  doc: DocumentInput,
  v: MigratedVersionInput,
): Promise<string> {
  if (!v.originalEffectiveDate) {
    throw new BusinessError('migrate.original', 'Bản nạp bắt buộc có ngày hiệu lực gốc');
  }
  const today = new Date().toISOString().slice(0, 10);
  return sql.begin(async (tx) => {
    await ensureDocument(tx as TransactionSql, doc);
    const versionId = randomUUID();
    // effective_date = hôm nay (thoả guard); original_effective_date = ngày gốc.
    await tx`
      INSERT INTO document_versions (
        version_id, doc_id, version_no, title,
        issued_date, approver_name, approval_reference, approval_method,
        effective_date, review_cycle_months,
        source_channel, file_path, file_hash,
        status, registrant_user_id, owner_department_id,
        migrated_record, original_effective_date, submitted_at
      ) VALUES (
        ${versionId}, ${v.docId}, ${v.versionNo}, ${v.title},
        ${v.issuedDate}, ${v.approverName}, ${v.approvalReference ?? null}, 'ky_tay_so_hoa',
        ${today}, ${v.reviewCycleMonths},
        'thu_cong', ${v.filePath}, ${v.fileHash},
        'cho_xac_nhan', ${v.registrantUserId}, ${v.ownerDepartmentId},
        TRUE, ${v.originalEffectiveDate}, now()
      )`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'nop_dang_ky', actorUserId: v.registrantUserId,
      objectType: 'document_versions', objectId: versionId,
      afterState: { migrated: true, original_effective_date: v.originalEffectiveDate },
    });
    return versionId;
  }) as Promise<string>;
}
