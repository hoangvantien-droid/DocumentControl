/**
 * src/domain/labeling.ts — nhãn cấp tài liệu, chép từ phiên bản trước (T-048).
 *
 * Khi đăng ký phiên bản mới, chép nhãn cấp tài liệu từ bản gốc để tiết kiệm
 * công. Nhãn chép PHẢI hiển thị khác màu cho tới khi người xác nhận lại (REQ
 * -D04 quy tắc 4) — cờ copied_from_previous + confirmed_by_user trên
 * document_links đảm nhận việc đó cho nhãn LIÊN KẾT.
 *
 * Ở đây xử lý nhãn cấp tài liệu (các cột scope/keywords/... trên document_versions)
 * và chép nhãn liên kết từ bản trước với cờ copied_from_previous=TRUE.
 */
import type { Sql, TransactionSql } from 'postgres';
import { writeAudit } from '../lib/audit.js';

/** Chép nhãn cấp tài liệu từ bản trước sang bản mới. */
export async function copyDocumentLabels(
  sql: Sql,
  fromVersionId: string,
  toVersionId: string,
): Promise<void> {
  await sql`
    UPDATE document_versions t
       SET scope = f.scope,
           keywords = f.keywords,
           applicable_site_ids = f.applicable_site_ids,
           applicable_product_groups = f.applicable_product_groups,
           required_reader_dept_ids = f.required_reader_dept_ids
      FROM document_versions f
     WHERE t.version_id = ${toVersionId} AND f.version_id = ${fromVersionId}`;
}

/**
 * Chép nhãn LIÊN KẾT từ bản trước, đánh dấu copied_from_previous=TRUE và
 * confirmed_by_user=FALSE (hiện khác màu tới khi người xác nhận lại).
 */
export async function copyLinks(
  sql: Sql,
  input: { fromVersionId: string; toVersionId: string; createdBy: string },
): Promise<number> {
  return sql.begin(async (tx) => {
    const rows = await tx`
      INSERT INTO document_links
        (version_id, section_id, link_type, link_code, copied_from_previous, confirmed_by_user, created_by)
      SELECT ${input.toVersionId}, NULL, link_type, link_code, TRUE, FALSE, ${input.createdBy}
        FROM document_links
       WHERE version_id = ${input.fromVersionId} AND section_id IS NULL
      ON CONFLICT (version_id, section_id, link_type, link_code) DO NOTHING
      RETURNING link_id`;
    if (rows.length > 0) {
      await writeAudit(tx as TransactionSql, {
        eventType: 'khai_nhan', actorUserId: input.createdBy,
        objectType: 'document_versions', objectId: input.toVersionId,
        afterState: { copied_links: rows.length, from: input.fromVersionId },
      });
    }
    return rows.length;
  }) as Promise<number>;
}

/** Người xác nhận lại một nhãn đã chép (bỏ trạng thái "cần xác nhận"). */
export async function confirmCopiedLink(sql: Sql, linkId: string, userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`UPDATE document_links SET confirmed_by_user = TRUE WHERE link_id = ${linkId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'xac_nhan_nhan_chep', actorUserId: userId,
      objectType: 'document_links', objectId: linkId,
    });
  });
}
