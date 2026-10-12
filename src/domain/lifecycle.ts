/**
 * src/domain/lifecycle.ts — vòng đời tài liệu (T-035, T-036).
 *
 * Chuyển hiệu lực theo lịch giao cho hàm CSDL fn_activate_due_versions: bản cũ
 * hết hiệu lực VÀ bản mới lên hiệu lực trong CÙNG một giao dịch (REQ-C02/C03).
 * Không tái hiện logic đó ở tầng ứng dụng — DCS-4 là nguồn sự thật.
 *
 * Thu hồi (REQ-C05): thủ công, bắt buộc lý do; liệt kê đối tượng đang tham
 * chiếu trước khi thu hồi để cảnh báo tài liệu mồ côi.
 */
import type { Sql, TransactionSql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { canRelease } from './permissions.js';

/** Chạy chuyển hiệu lực theo ngày. Trả về số phiên bản đã kích hoạt. */
export async function activateDueVersions(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT fn_activate_due_versions() AS n`;
  return rows[0]?.n ?? 0;
}

/** Sinh bản ghi rà soát cho tài liệu tới hạn. Trả về số bản ghi sinh mới. */
export async function generateDueReviews(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT fn_generate_due_reviews() AS n`;
  return rows[0]?.n ?? 0;
}

/** Đối tượng đang tham chiếu tới tài liệu — hiện trước khi thu hồi (REQ-C06). */
export interface RecallImpact {
  distribution_count: number;
  printed_copies_active: number;
  referencing_links: number;
}

export async function recallImpact(sql: Sql, docId: string, versionId: string): Promise<RecallImpact> {
  const [dist] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM distribution_matrix WHERE doc_id = ${docId}`;
  const [prints] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM printed_copies
     WHERE version_id = ${versionId} AND recall_status = 'dang_luu_hanh'`;
  const [links] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM document_links WHERE version_id = ${versionId}`;
  return {
    distribution_count: dist!.n,
    printed_copies_active: prints!.n,
    referencing_links: links!.n,
  };
}

/** Thu hồi thủ công có lý do. Chỉ áp cho da_dang_ky hoặc hieu_luc. */
export async function recallVersion(
  sql: Sql,
  input: { versionId: string; adminUserId: string; reason: string },
): Promise<void> {
  if (!input.reason.trim()) throw new BusinessError('recall.reason', 'Thu hồi bắt buộc kèm lý do');
  await sql.begin(async (tx) => {
    const v = (await tx<{
      status: string; scope_level: 'group' | 'bu' | 'site' | 'dept';
      scope_bu_id: string | null; scope_site_id: string | null; scope_dept_id: string | null;
    }[]>`
      SELECT ver.status, d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
        FROM document_versions ver JOIN documents d ON d.doc_id = ver.doc_id
       WHERE ver.version_id = ${input.versionId} FOR UPDATE OF ver`)[0];
    if (!v) throw new BusinessError('recall.not_found', 'Không tìm thấy phiên bản');
    if (!['da_dang_ky', 'hieu_luc'].includes(v.status)) {
      throw new BusinessError('recall.bad_status', `Không thu hồi được từ trạng thái ${v.status}`);
    }
    // Thu hồi là hành động nhạy cảm — kiểm quyền ở domain, không tin route (DCS-8 §4.3).
    const allowed = await canRelease(tx as unknown as Sql, input.adminUserId, {
      scope_level: v.scope_level, scope_bu_id: v.scope_bu_id,
      scope_site_id: v.scope_site_id, scope_dept_id: v.scope_dept_id,
    });
    if (!allowed) throw new BusinessError('recall.no_permission', 'Không đủ thẩm quyền thu hồi tài liệu này', { httpStatus: 403 });
    await tx`UPDATE document_versions
                SET status = 'thu_hoi', recall_reason = ${input.reason}
              WHERE version_id = ${input.versionId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'thu_hoi', actorUserId: input.adminUserId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { status: 'thu_hoi', reason: input.reason },
    });
  });
}
