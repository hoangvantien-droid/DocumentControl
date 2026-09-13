/**
 * src/domain/acknowledgement.ts — xác nhận đọc (T-069, T-070, T-071).
 *
 * Xác nhận đọc gắn với PHIÊN BẢN. Lưu bối cảnh (bộ phận, nhóm) TẠI THỜI ĐIỂM
 * xác nhận, không tra lại L1 sau (DCS-3 §F.2). Kế thừa khi lên phiên bản mới:
 *   thay đổi 'nho' -> sao chép bản ghi (do fn_activate_due_versions xử lý)
 *   thay đổi 'lon' -> đặt lại, mọi người xác nhận lại
 */
import type { Sql, TransactionSql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';

/** Người dùng có thuộc diện phải đọc phiên bản này không (qua phép giao). */
export async function mustAcknowledge(sql: Sql, versionId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM v_distribution_resolved dr
        JOIN document_versions v ON v.doc_id = dr.doc_id
       WHERE v.version_id = ${versionId} AND dr.user_id = ${userId} AND dr.require_ack
    ) AS ok`;
  return rows[0]?.ok ?? false;
}

export async function hasAcknowledged(sql: Sql, versionId: string, userId: string): Promise<
  { acknowledged: boolean; inherited: boolean }
> {
  const rows = await sql<{ inherited_from_version_id: string | null }[]>`
    SELECT inherited_from_version_id FROM read_acknowledgements
     WHERE version_id = ${versionId} AND user_id = ${userId}`;
  if (rows.length === 0) return { acknowledged: false, inherited: false };
  return { acknowledged: true, inherited: rows[0]!.inherited_from_version_id !== null };
}

/** Ghi nhận đã đọc — lưu bối cảnh tại thời điểm xác nhận. */
export async function acknowledge(sql: Sql, versionId: string, userId: string): Promise<void> {
  const eligible = await mustAcknowledge(sql, versionId, userId);
  if (!eligible) {
    throw new BusinessError('ack.not_required', 'Bạn không thuộc diện phải xác nhận đọc tài liệu này');
  }
  await sql.begin(async (tx) => {
    // Bối cảnh tại thời điểm xác nhận: lấy một bộ phận + nhóm dẫn tới phân phối.
    const ctx = (await tx<{ department_id: string; functional_group_id: string | null }[]>`
      SELECT dr.department_id, dr.functional_group_id
        FROM v_distribution_resolved dr
        JOIN document_versions v ON v.doc_id = dr.doc_id
       WHERE v.version_id = ${versionId} AND dr.user_id = ${userId}
       LIMIT 1`)[0];

    await tx`
      INSERT INTO read_acknowledgements (version_id, user_id, department_id, functional_group_id)
      VALUES (${versionId}, ${userId}, ${ctx?.department_id ?? null}, ${ctx?.functional_group_id ?? null})
      ON CONFLICT (version_id, user_id) DO NOTHING`;

    await writeAudit(tx as TransactionSql, {
      eventType: 'xac_nhan_doc', actorUserId: userId,
      objectType: 'document_versions', objectId: versionId,
    });
  });
}

/** Tồn đọng xác nhận đọc theo tài liệu (v_ack_pending). */
export async function ackPending(sql: Sql) {
  return sql<{
    version_id: string; doc_id: string; version_no: string; title: string;
    department_name: string; so_nguoi_phai_doc: number; so_nguoi_da_xac_nhan: number; con_lai: number;
  }[]>`
    SELECT version_id, doc_id, version_no, title, department_name,
           so_nguoi_phai_doc, so_nguoi_da_xac_nhan, con_lai
      FROM v_ack_pending
     WHERE con_lai > 0
     ORDER BY con_lai DESC`;
}
