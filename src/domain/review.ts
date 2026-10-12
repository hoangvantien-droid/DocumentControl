/**
 * src/domain/review.ts — rà soát định kỳ (T-075, T-076, T-077).
 *
 * Rà soát là bản ghi có vòng đời riêng. Ghi kết luận qua fn_record_review_verdict
 * (đường DUY NHẤT đặt lại next_review_date). Ba kết luận:
 *   giu_nguyen -> da_dong, đặt lại đồng hồ chu kỳ
 *   can_sua    -> treo_cho_ban_moi (tự đóng khi bản mới hiệu lực — fn_activate)
 *   huy_bo     -> huy_bo
 */
import type { Sql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { canRelease } from './permissions.js';

export type Verdict = 'giu_nguyen' | 'can_sua' | 'huy_bo';

export interface ReviewRow {
  review_id: string;
  doc_id: string;
  version_no: string;
  title: string;
  due_date: string;
  status: string;
  verdict: string | null;
  verdict_note: string | null;
  department_name: string | null;
  scope_level: 'group' | 'bu' | 'site' | 'dept';
  scope_bu_id: string | null;
  scope_site_id: string | null;
  scope_dept_id: string | null;
  so_ngay_qua_han: number;
}

/** Tồn đọng rà soát — gồm cả nhánh can_sua đang treo (v_review_backlog). */
export async function reviewBacklog(sql: Sql): Promise<ReviewRow[]> {
  return sql<ReviewRow[]>`
    SELECT b.review_id, b.doc_id, b.version_no, b.title, b.due_date::text AS due_date,
           b.status, b.verdict, b.verdict_note, b.department_name, b.so_ngay_qua_han,
           d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
      FROM v_review_backlog b
      JOIN documents d ON d.doc_id = b.doc_id
     ORDER BY b.so_ngay_qua_han DESC`;
}

/** Ghi kết luận rà soát. giu_nguyen/huy_bo không cần note; can_sua/huy_bo cần giải trình. */
export async function recordVerdict(
  sql: Sql,
  input: { reviewId: string; verdict: Verdict; note: string; userId: string },
): Promise<void> {
  if (input.verdict !== 'giu_nguyen' && !input.note.trim()) {
    throw new BusinessError('review.note', 'Kết luận này bắt buộc ghi giải trình');
  }
  await sql.begin(async (tx) => {
    const review = (await tx<{
      scope_level: 'group' | 'bu' | 'site' | 'dept';
      scope_bu_id: string | null; scope_site_id: string | null; scope_dept_id: string | null;
    }[]>`
      SELECT d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
        FROM periodic_reviews p
        JOIN documents d ON d.doc_id = p.doc_id
       WHERE p.review_id = ${input.reviewId} FOR UPDATE OF p`)[0];
    if (!review) throw new BusinessError('review.not_found', 'Không tìm thấy bản ghi rà soát');
    const allowed = await canRelease(tx as unknown as Sql, input.userId, review);
    if (!allowed) throw new BusinessError('review.no_permission', 'Không đủ thẩm quyền kết luận rà soát này', { httpStatus: 403 });
    // fn_record_review_verdict ép quy tắc và là đường duy nhất sửa next_review_date.
    await tx`SELECT fn_record_review_verdict(${input.reviewId}, ${input.verdict}, ${input.note || null}, ${input.userId})`;
  });
}
