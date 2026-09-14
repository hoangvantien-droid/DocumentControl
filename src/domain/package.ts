/**
 * src/domain/package.ts — gói ban hành (T-078→T-081).
 *
 * Người đăng ký tạo gói, Admin KHÔNG tạo. Tối đa 10 thành viên (trigger DB ép).
 * Ngày hiệu lực nằm TRÊN gói, thành viên thừa kế. Kích hoạt nguyên tử do
 * fn_activate_due_versions xử lý. Dời ngày chỉ ra xa (fn_guard_package_date).
 * Tháo thành viên bắt buộc lý do; thành viên nhận lại effective_date = ngày gói.
 */
import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';

export interface PackageRow {
  package_id: string;
  package_code: string;
  title: string;
  effective_date: string;
  status: string;
  member_count: number;
  confirmed_count: number;
}

export async function listPackages(sql: Sql): Promise<PackageRow[]> {
  return sql<PackageRow[]>`
    SELECT p.package_id, p.package_code, p.title, p.effective_date::text AS effective_date, p.status,
           (SELECT count(*)::int FROM document_versions m WHERE m.package_id = p.package_id) AS member_count,
           (SELECT count(*)::int FROM document_versions m WHERE m.package_id = p.package_id AND m.confirmed_at IS NOT NULL) AS confirmed_count
      FROM release_packages p
     ORDER BY p.created_at DESC`;
}

export async function packageMembers(sql: Sql, packageId: string) {
  return sql<{ version_id: string; doc_id: string; version_no: string; title: string; status: string }[]>`
    SELECT version_id, doc_id, version_no, title, status
      FROM document_versions WHERE package_id = ${packageId} ORDER BY doc_id`;
}

/** Tạo gói. createdBy là NGƯỜI ĐĂNG KÝ (Admin không tạo gói — nghiệp vụ, không ép ở DB). */
export async function createPackage(
  sql: Sql,
  input: { code: string; title: string; effectiveDate: string; createdBy: string },
): Promise<string> {
  const id = randomUUID();
  await sql.begin(async (tx) => {
    const isAuthor = (await tx<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM user_roles
         WHERE user_id = ${input.createdBy} AND role_code = 'DC_AUTHOR' AND is_active
      ) AS ok`)[0]?.ok ?? false;
    if (!isAuthor) {
      throw new BusinessError('pkg.no_permission', 'Chỉ người đăng ký ban hành được tạo gói', { httpStatus: 403 });
    }
    await tx`
      INSERT INTO release_packages (package_id, package_code, title, effective_date, created_by)
      VALUES (${id}, ${input.code}, ${input.title}, ${input.effectiveDate}, ${input.createdBy})`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'tao_goi', actorUserId: input.createdBy,
      objectType: 'release_packages', objectId: id,
      afterState: { code: input.code, effective_date: input.effectiveDate },
    });
  });
  return id;
}

/**
 * Gắn một phiên bản vào gói: chuyển effective_date -> NULL, đặt package_id.
 * Ràng buộc chk_effective_or_package ép "một trong hai". Trigger đếm 10 thành viên.
 */
export async function attachToPackage(
  sql: Sql,
  input: { versionId: string; packageId: string; userId: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const v = (await tx<{ status: string; registrant_user_id: string }[]>`
      SELECT status, registrant_user_id FROM document_versions WHERE version_id = ${input.versionId} FOR UPDATE`)[0];
    if (!v) throw new BusinessError('pkg.no_version', 'Không tìm thấy phiên bản');
    const pkg = (await tx<{ package_id: string }[]>`
      SELECT package_id FROM release_packages WHERE package_id = ${input.packageId} FOR UPDATE`)[0];
    if (!pkg) throw new BusinessError('pkg.not_found', 'Không tìm thấy gói ban hành');
    if (v.registrant_user_id !== input.userId) {
      throw new BusinessError('pkg.no_permission', 'Chỉ người đăng ký được gắn phiên bản của mình vào gói', { httpStatus: 403 });
    }
    if (!['cho_xac_nhan', 'da_dang_ky'].includes(v.status)) {
      throw new BusinessError('pkg.bad_status', 'Chỉ gắn được đăng ký đang chờ xác nhận hoặc đã đăng ký');
    }
    await tx`
      UPDATE document_versions
         SET package_id = ${input.packageId}, effective_date = NULL
       WHERE version_id = ${input.versionId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'gan_vao_goi', actorUserId: input.userId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { package_id: input.packageId },
    });
  });
}

/** Dời ngày gói — trigger fn_guard_package_date chỉ cho dời ra xa khi đã có thành viên xác nhận. */
export async function movePackageDate(
  sql: Sql,
  input: { packageId: string; newDate: string; userId: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const pkg = (await tx<{ created_by: string }[]>`
      SELECT created_by FROM release_packages WHERE package_id = ${input.packageId} FOR UPDATE`)[0];
    if (!pkg) throw new BusinessError('pkg.not_found', 'Không tìm thấy gói ban hành');
    if (pkg.created_by !== input.userId) {
      throw new BusinessError('pkg.no_permission', 'Chỉ người tạo gói được dời ngày hiệu lực', { httpStatus: 403 });
    }
    await tx`UPDATE release_packages SET effective_date = ${input.newDate} WHERE package_id = ${input.packageId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'doi_ngay_goi', actorUserId: input.userId,
      objectType: 'release_packages', objectId: input.packageId,
      afterState: { effective_date: input.newDate },
    });
  });
}

/**
 * Tháo một thành viên khỏi gói (bắt buộc lý do). Thành viên nhận lại
 * effective_date = ngày gói tại thời điểm tháo, giữ nguyên trạng thái.
 */
export async function detachMember(
  sql: Sql,
  input: { versionId: string; reason: string; userId: string },
): Promise<void> {
  if (!input.reason.trim()) throw new BusinessError('pkg.reason', 'Tháo thành viên bắt buộc ghi lý do');
  await sql.begin(async (tx) => {
    const row = (await tx<{ package_id: string | null; effective_date: string | null; created_by: string | null }[]>`
      SELECT dv.package_id, rp.effective_date::text AS effective_date, rp.created_by
        FROM document_versions dv
        LEFT JOIN release_packages rp ON rp.package_id = dv.package_id
       WHERE dv.version_id = ${input.versionId} FOR UPDATE OF dv`)[0];
    if (!row || !row.package_id) throw new BusinessError('pkg.not_member', 'Phiên bản không thuộc gói nào');
    if (row.created_by !== input.userId) {
      throw new BusinessError('pkg.no_permission', 'Chỉ người tạo gói được tháo thành viên', { httpStatus: 403 });
    }
    await tx`
      UPDATE document_versions
         SET package_id = NULL, effective_date = ${row.effective_date}
       WHERE version_id = ${input.versionId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'thao_thanh_vien', actorUserId: input.userId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { reason: input.reason, restored_effective_date: row.effective_date },
    });
  });
}
