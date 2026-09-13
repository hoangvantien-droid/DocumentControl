/**
 * src/domain/diff.ts — so sánh phiên bản (T-059, T-060).
 *
 * Gọi fn_diff_versions (đối chiếu mục theo mã mục) và fn_diff_reliability (ba
 * trường hợp không đáng tin). KHÔNG lưu kết quả — suy ra từ document_sections.
 * Việc Admin đã xem được ghi vết bằng sự kiện xem_so_sanh (mở khoá ô 9b).
 */
import type { Sql, TransactionSql } from 'postgres';
import { writeAudit } from '../lib/audit.js';

export interface DiffRow {
  section_code: string;
  change_type: 'them' | 'xoa' | 'doi_noi_dung' | 'doi_tieu_de' | 'khong_doi';
  old_title: string | null;
  new_title: string | null;
  old_text: string | null;
  new_text: string | null;
}

export type DiffReliability =
  | 'dang_tin'
  | 'boc_tach_kem_tin_cay'
  | 'khong_co_muc_de_so'
  | 'la_phien_ban_dau_tien';

/** Độ tin cậy của so sánh — quyết định có hiện cảnh báo không (T-060). */
export async function diffReliability(
  sql: Sql,
  fromVersionId: string | null,
  toVersionId: string,
): Promise<DiffReliability> {
  const rows = await sql<{ r: DiffReliability }[]>`
    SELECT fn_diff_reliability(${fromVersionId}, ${toVersionId}) AS r`;
  return rows[0]!.r;
}

/** Danh sách khác biệt giữa hai phiên bản (mục thêm/xoá/đổi). */
export async function diffVersions(
  sql: Sql,
  fromVersionId: string,
  toVersionId: string,
): Promise<DiffRow[]> {
  return sql<DiffRow[]>`
    SELECT section_code, change_type, old_title, new_title, old_text, new_text
      FROM fn_diff_versions(${fromVersionId}, ${toVersionId})
     ORDER BY section_code`;
}

/** Ghi vết Admin đã mở so sánh (điều kiện mở ô tích 9b). */
export async function recordViewedDiff(
  sql: Sql,
  userId: string,
  versionId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await writeAudit(tx as TransactionSql, {
      eventType: 'xem_so_sanh', actorUserId: userId,
      objectType: 'document_versions', objectId: versionId,
    });
  });
}
