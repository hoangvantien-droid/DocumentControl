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
  so_ngay_qua_han: number;
}

/** Tồn đọng rà soát — gồm cả nhánh can_sua đang treo (v_review_backlog). */
export async function reviewBacklog(sql: Sql): Promise<ReviewRow[]> {
  return sql<ReviewRow[]>`
    SELECT review_id, doc_id, version_no, title, due_date::text AS due_date,
           status, verdict, verdict_note, department_name, so_ngay_qua_han
      FROM v_review_backlog
     ORDER BY so_ngay_qua_han DESC`;
}

/** Ghi kết luận rà soát. giu_nguyen/huy_bo không cần note; can_sua/huy_bo cần giải trình. */
export async function recordVerdict(
  sql: Sql,
  input: { reviewId: string; verdict: Verdict; note: string; userId: string },
): Promise<void> {
  if (input.verdict !== 'giu_nguyen' && !input.note.trim()) {
    throw new BusinessError('review.note', 'Kết luận này bắt buộc ghi giải trình');
  }
  // fn_record_review_verdict ép quy tắc và là đường duy nhất sửa next_review_date.
  await sql`SELECT fn_record_review_verdict(${input.reviewId}, ${input.verdict}, ${input.note || null}, ${input.userId})`;
}
