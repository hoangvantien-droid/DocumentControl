/**
 * src/domain/rollout.ts — áp dụng lệch pha theo site.
 * 1 version hieu_luc dùng chung, mỗi site có planned/applied riêng.
 * Status: chua_ap_dung | da_ap_dung | tam_hoan.
 * Quyền thêm site: thuộc bộ phận soạn thảo (owner_department_id).
 */
import type { Sql, TransactionSql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';

export type RolloutStatus = 'chua_ap_dung' | 'da_ap_dung' | 'tam_hoan';

export interface SiteRollout {
  version_id: string;
  site_id: string;
  site_code: string;
  site_name: string;
  planned_date: string | null;
  applied_date: string | null;
  status: RolloutStatus;
  pause_reason: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export async function listRollout(sql: Sql, versionId: string): Promise<SiteRollout[]> {
  return sql<SiteRollout[]>`
    SELECT r.version_id, r.site_id, s.site_code, s.name AS site_name,
           r.planned_date::text AS planned_date,
           r.applied_date::text AS applied_date,
           r.status, r.pause_reason,
           r.confirmed_by::text AS confirmed_by,
           r.confirmed_at::text AS confirmed_at
      FROM document_site_rollout r
      JOIN org_site s ON s.site_id = r.site_id
     WHERE r.version_id = ${versionId}
     ORDER BY s.site_code`;
}

/** Kiểm tra user thuộc bộ phận soạn thảo của version. */
export async function isDraftingDept(sql: Sql, userId: string, versionId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM document_versions v
      JOIN user_departments ud ON ud.dept_id = v.owner_department_id
     WHERE v.version_id = ${versionId}
       AND ud.user_id = ${userId}
       AND ud.is_active
       AND v.owner_department_id IS NOT NULL
    ) AS ok`;
  return rows[0]?.ok ?? false;
}

/** Thêm site + ngày áp dụng dự kiến cho bản đã ban hành. */
export async function addSiteRollout(
  sql: Sql,
  input: { versionId: string; siteId: string; plannedDate?: string | null; actorUserId: string },
): Promise<void> {
  if (!input.siteId) throw new BusinessError('rollout.site', 'Thiếu site áp dụng');
  const can = await isDraftingDept(sql, input.actorUserId, input.versionId);
  if (!can) throw new BusinessError('rollout.no_permission', 'Chỉ bộ phận soạn thảo được thêm site áp dụng', { httpStatus: 403 });
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO document_site_rollout (version_id, site_id, planned_date, status)
      VALUES (${input.versionId}, ${input.siteId}, ${input.plannedDate || null}, 'chua_ap_dung')
      ON CONFLICT (version_id, site_id) DO UPDATE SET
        planned_date = COALESCE(${input.plannedDate || null}, document_site_rollout.planned_date),
        updated_at = now()`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'sua_ma_tran', actorUserId: input.actorUserId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { site_id: input.siteId, planned_date: input.plannedDate || null },
    });
  });
}

/** Cập nhật trạng thái áp dụng của 1 site. */
export async function setSiteRolloutStatus(
  sql: Sql,
  input: { versionId: string; siteId: string; status: RolloutStatus; appliedDate?: string | null; pauseReason?: string | null; actorUserId: string },
): Promise<void> {
  const can = await isDraftingDept(sql, input.actorUserId, input.versionId);
  if (!can) throw new BusinessError('rollout.no_permission', 'Chỉ bộ phận soạn thảo được cập nhật áp dụng', { httpStatus: 403 });
  if (input.status === 'da_ap_dung' && !input.appliedDate) {
    throw new BusinessError('rollout.applied_date', 'Đánh dấu đã áp dụng bắt buộc có ngày áp dụng');
  }
  if (input.status === 'tam_hoan' && !(input.pauseReason || '').trim()) {
    throw new BusinessError('rollout.pause_reason', 'Tạm hoãn bắt buộc ghi lý do');
  }
  await sql.begin(async (tx) => {
    await tx`
      UPDATE document_site_rollout
         SET status = ${input.status},
             applied_date = ${input.status === 'da_ap_dung' ? (input.appliedDate || null) : null},
             pause_reason = ${input.status === 'tam_hoan' ? (input.pauseReason || null) : null},
             confirmed_by = ${input.actorUserId},
             confirmed_at = now(),
             updated_at = now()
       WHERE version_id = ${input.versionId} AND site_id = ${input.siteId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'sua_ma_tran', actorUserId: input.actorUserId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { site_id: input.siteId, status: input.status },
    });
  });
}
