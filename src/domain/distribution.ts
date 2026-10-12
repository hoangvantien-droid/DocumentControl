/**
 * src/domain/distribution.ts — ma trận phân phối, giải người nhận PHÉP GIAO (T-065, T-066).
 *
 * Ma trận gắn với SỐ HIỆU (ổn định qua phiên bản), bộ phận BẮT BUỘC, nhóm chức
 * năng tuỳ chọn. Giải người nhận = PHÉP GIAO (v_distribution_resolved):
 *   nhóm rỗng  -> mọi người thuộc bộ phận
 *   nhóm có    -> người thuộc bộ phận VÀ là thành viên nhóm
 * KHÔNG đổi thành phép hợp (DCS-9 bẫy #5): nhóm sinh ra để THU HẸP đúng người.
 */
import type { Sql, TransactionSql } from 'postgres';
import { writeAudit } from '../lib/audit.js';

export interface MatrixRow {
  matrix_id: string;
  doc_id: string;
  department_id: string;
  department_code: string | null;
  functional_group_id: string | null;
  functional_group_name: string | null;
  require_ack: boolean;
}

export async function listMatrix(sql: Sql, docId: string): Promise<MatrixRow[]> {
  return sql<MatrixRow[]>`
    SELECT m.matrix_id, m.doc_id, m.department_id, dep.dept_code AS department_code,
           m.functional_group_id, fg.name AS functional_group_name, m.require_ack
      FROM distribution_matrix m
      JOIN org_department dep ON dep.dept_id = m.department_id
      LEFT JOIN functional_groups fg ON fg.group_id = m.functional_group_id
     WHERE m.doc_id = ${docId}
     ORDER BY dep.dept_code`;
}

export async function addMatrix(
  sql: Sql,
  input: { docId: string; departmentId: string; functionalGroupId?: string | null; requireAck?: boolean; createdBy: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO distribution_matrix (doc_id, department_id, functional_group_id, require_ack, created_by)
      VALUES (${input.docId}, ${input.departmentId}, ${input.functionalGroupId ?? null},
              ${input.requireAck ?? true}, ${input.createdBy})
      ON CONFLICT (doc_id, department_id, functional_group_id) DO NOTHING`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'sua_ma_tran', actorUserId: input.createdBy,
      objectType: 'documents', objectId: input.docId,
      afterState: { department_id: input.departmentId, functional_group_id: input.functionalGroupId ?? null },
    });
  });
}

export async function removeMatrix(sql: Sql, matrixId: string, userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const [row] = await tx<{ doc_id: string }[]>`
      DELETE FROM distribution_matrix WHERE matrix_id = ${matrixId} RETURNING doc_id`;
    if (row) {
      await writeAudit(tx as TransactionSql, {
        eventType: 'sua_ma_tran', actorUserId: userId,
        objectType: 'documents', objectId: row.doc_id, afterState: { removed_matrix: matrixId },
      });
    }
  });
}

/**
 * Giải danh sách người nhận cho một tài liệu — PHÉP GIAO qua v_distribution_resolved.
 * Trả về số người phải đọc (dùng cho "số người sẽ nhận" trên form đăng ký).
 */
export async function resolveRecipients(sql: Sql, docId: string): Promise<string[]> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT user_id FROM v_distribution_resolved WHERE doc_id = ${docId}`;
  return rows.map((r) => r.user_id);
}

/** Đếm số người sẽ nhận nếu thêm một dòng ma trận (bộ phận [+ nhóm]) — phép giao. */
export async function countRecipientsFor(
  sql: Sql,
  departmentId: string,
  functionalGroupId: string | null,
): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(DISTINCT ud.user_id)::int AS n
      FROM user_departments ud
     WHERE ud.dept_id = ${departmentId} AND ud.is_active
       AND (${functionalGroupId}::uuid IS NULL
            OR EXISTS (SELECT 1 FROM functional_group_members fm
                        WHERE fm.group_id = ${functionalGroupId} AND fm.user_id = ud.user_id))`;
  return rows[0]?.n ?? 0;
}
