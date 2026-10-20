/**
 * src/domain/catalog.ts — danh mục và chi tiết tài liệu (T-037, T-038).
 *
 * Danh mục lọc theo quyền: người dùng thấy tài liệu trong phạm vi mình (qua
 * user_departments + cây tổ chức), tài liệu mình nộp, và tài liệu mình release
 * được. Lọc TRƯỚC bằng điều kiện truy vấn, không lọc sau (DCS-2 mục 7.1).
 */
import type { Sql } from 'postgres';

export interface CatalogRow {
  doc_id: string;
  version_id: string;
  version_no: string;
  title: string;
  status: string;
  doc_type: string;
  scope_level: string;
  effective_date: string | null;
  next_review_date: string | null;
  owner_department_id: string | null;
}

export interface CatalogFilters {
  status?: string | null;
  q?: string | null;
  doc_type?: string | null;
  origin?: string | null;
  eff_from?: string | null;
  eff_to?: string | null;
  preset?: string | null;
  sort?: string | null;
  site_id?: string | null;
  rollout_status?: string | null;
}

/**
 * Danh mục tài liệu người dùng được thấy. Filters giữ trên URL để share/bookmark.
 * readOnlyViewer=true (người chỉ-xem/Reader): CHỈ hiện tài liệu hiện hành
 * (hieu_luc / da_dang_ky), ẩn bản lỗi thời/thu hồi/nháp/chờ — lọc TRƯỚC trong
 * truy vấn (DCS-2 §7.1), không lọc sau.
 */
export async function listVisibleDocuments(
  sql: Sql,
  userId: string,
  statusOrFilters: string | CatalogFilters | null = null,
  readOnlyViewer = false,
): Promise<CatalogRow[]> {
  const f: CatalogFilters = typeof statusOrFilters === 'string' || statusOrFilters == null
    ? { status: (statusOrFilters as string | null) ?? null }
    : statusOrFilters;
  const status = (f.status ?? '').trim() || null;
  const q = (f.q ?? '').trim() || null;
  const docType = (f.doc_type ?? '').trim() || null;
  const origin = (f.origin ?? '').trim() || null;
  const effFrom = (f.eff_from ?? '').trim() || null;
  const effTo = (f.eff_to ?? '').trim() || null;
  const preset = (f.preset ?? '').trim() || null;
  const siteId = (f.site_id ?? '').trim() || null;
  const rolloutStatus = (f.rollout_status ?? '').trim() || null;
  const sort = (f.sort ?? '').trim() || 'hieu_luc_moi';
  const orderBy = sort === 'ban_hanh_moi' ? 'v.issued_date DESC NULLS LAST, v.doc_id'
    : sort === 'sap_het_han' ? 'v.expiry_date ASC NULLS LAST, v.doc_id'
    : sort === 'so_hieu' ? 'v.doc_id ASC, v.version_no DESC'
    : 'v.effective_date DESC NULLS LAST, v.doc_id';
  // preset chuẩn: hieu_luc | new30 | expiring30 | overdue
  const presetStatus = preset === 'hieu_luc' ? 'hieu_luc' : null;
  const effStatus = status ?? presetStatus;
  return sql<CatalogRow[]>`
    SELECT v.doc_id, v.version_id, v.version_no, v.title, v.status,
           d.doc_type, d.scope_level,
           v.effective_date::text AS effective_date,
           v.next_review_date::text AS next_review_date,
           v.owner_department_id,
           v.issued_date::text AS issued_date,
           v.expiry_date::text AS expiry_date
      FROM document_versions v
      JOIN documents d ON d.doc_id = v.doc_id
     WHERE (
       -- Tài liệu mình nộp (mọi trạng thái)
       v.registrant_user_id = ${userId}
       -- Hoặc tài liệu trong phạm vi mình được xem (group, hoặc thuộc cây tổ chức)
       OR d.scope_level = 'group'
       OR EXISTS (
         SELECT 1 FROM user_departments ud
           JOIN org_department dp ON dp.dept_id = ud.dept_id
           JOIN org_site st ON st.site_id = dp.site_id
          WHERE ud.user_id = ${userId} AND ud.is_active
            AND ( (d.scope_level='bu'   AND EXISTS (
                  SELECT 1 FROM org_site_bu sb
                   WHERE sb.site_id = st.site_id AND sb.bu_id = d.scope_bu_id))
               OR (d.scope_level='site' AND st.site_id = d.scope_site_id)
               OR (d.scope_level='dept' AND dp.dept_id = d.scope_dept_id)))
       -- Hoặc là Admin (quản trị) — thấy để tra cứu.
       OR EXISTS (
         SELECT 1 FROM user_roles r
          WHERE r.user_id = ${userId} AND r.is_active
            AND r.role_code = 'DC_ADMIN'
       )
     )
       -- Người chỉ-xem (Reader): chỉ tài liệu hiện hành (hieu_luc / da_dang_ky).
       AND (${!readOnlyViewer} OR v.status IN ('da_ban_hanh', 'hieu_luc', 'da_dang_ky'))
       -- Lọc theo trạng thái
       AND (${effStatus}::varchar IS NULL OR v.status = ${effStatus})
       AND (${docType}::varchar IS NULL OR d.doc_type = ${docType})
       AND (${origin}::varchar IS NULL OR d.origin = ${origin})
       AND (${effFrom}::date IS NULL OR v.effective_date >= ${effFrom}::date)
       AND (${effTo}::date IS NULL OR v.effective_date <= ${effTo}::date)
       AND (${q}::text IS NULL OR v.doc_id ILIKE '%' || ${q} || '%' OR v.title ILIKE '%' || ${q} || '%' OR COALESCE(array_to_string(v.keywords, ' '), '') ILIKE '%' || ${q} || '%')
       AND ((${preset}::varchar IS NULL OR ${preset} = 'hieu_luc')
         OR (${preset} = 'new30' AND v.effective_date >= CURRENT_DATE - INTERVAL '30 days')
         OR (${preset} = 'expiring30' AND v.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')
         OR (${preset} = 'overdue' AND v.next_review_date IS NOT NULL AND v.next_review_date < CURRENT_DATE)
         OR (${preset} = 'expired' AND v.expiry_date IS NOT NULL AND v.expiry_date < CURRENT_DATE))
       AND (${siteId}::uuid IS NULL OR EXISTS (SELECT 1 FROM document_receipt rc WHERE rc.version_id = v.version_id AND rc.site_id = ${siteId}::uuid))
       AND (${rolloutStatus}::varchar IS NULL OR EXISTS (SELECT 1 FROM document_receipt rc WHERE rc.version_id = v.version_id AND (${siteId}::uuid IS NULL OR rc.site_id = ${siteId}::uuid) AND rc.status = CASE ${rolloutStatus} WHEN 'chua_ap_dung' THEN 'cho_phan_hoi' WHEN 'da_ap_dung' THEN 'chap_nhan' WHEN 'tam_hoan' THEN 'tu_choi' ELSE ${rolloutStatus} END))
     ORDER BY
       CASE WHEN ${sort} = 'ban_hanh_moi' THEN v.issued_date END DESC NULLS LAST,
       CASE WHEN ${sort} = 'sap_het_han' THEN v.expiry_date END ASC NULLS LAST,
       CASE WHEN ${sort} = 'so_hieu' THEN v.doc_id END ASC,
       v.effective_date DESC NULLS LAST, v.doc_id`;
}

/** Trạng thái tài liệu được coi là "hiện hành" (người chỉ-xem được phép xem).
 * Dùng chung nguồn duy nhất lifecycle-status (điểm 9). */
export { CURRENT_VIEW_STATUSES as CURRENT_DOC_STATUSES } from './lifecycle-status.js';

/** Người chỉ-xem có bị chặn/điều hướng khỏi version này không (vì không hiện hành). */
export { isCurrentlyEffective as isCurrentStatus } from './lifecycle-status.js';

export interface DocumentDetail extends CatalogRow {
  registrant_user_id: string;
  origin: string;
  scope_bu_id: string | null;
  scope_site_id: string | null;
  scope_dept_id: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  rejection_reason: string | null;
  recall_reason: string | null;
  qua_han_xem_xet: boolean;
  qua_han_su_dung: boolean;
}

/** Chi tiết một phiên bản. */
export async function loadDetail(sql: Sql, versionId: string): Promise<DocumentDetail | null> {
  const rows = await sql<DocumentDetail[]>`
    SELECT v.doc_id, v.version_id, v.version_no, v.title, v.status,
           v.registrant_user_id,
           d.doc_type, d.scope_level, d.origin,
           d.scope_bu_id, d.scope_site_id, d.scope_dept_id,
           v.effective_date::text AS effective_date,
           v.next_review_date::text AS next_review_date,
           v.owner_department_id,
           v.issued_date::text AS issued_date,
           v.expiry_date::text AS expiry_date,
           v.rejection_reason, v.recall_reason,
           (v.next_review_date IS NOT NULL AND v.next_review_date < CURRENT_DATE) AS qua_han_xem_xet,
           (v.expiry_date IS NOT NULL AND v.expiry_date < CURRENT_DATE) AS qua_han_su_dung
      FROM document_versions v
      JOIN documents d ON d.doc_id = v.doc_id
     WHERE v.version_id = ${versionId}`;
  return rows[0] ?? null;
}

export async function canViewVersion(
  sql: Sql,
  userId: string,
  versionId: string,
  readOnlyViewer = false,
): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
        FROM document_versions v
        JOIN documents d ON d.doc_id = v.doc_id
       WHERE v.version_id = ${versionId}
         -- Người chỉ-xem (Reader): chỉ bản hiện hành (hieu_luc / da_dang_ky).
         AND (${!readOnlyViewer} OR v.status IN ('da_ban_hanh', 'hieu_luc', 'da_dang_ky'))
         AND (
           v.registrant_user_id = ${userId}
           OR d.scope_level = 'group'
           OR EXISTS (
             SELECT 1
               FROM user_departments ud
               JOIN org_department dp ON dp.dept_id = ud.dept_id
               JOIN org_site st ON st.site_id = dp.site_id
              WHERE ud.user_id = ${userId} AND ud.is_active
                AND (
                  (d.scope_level = 'bu' AND EXISTS (
                    SELECT 1 FROM org_site_bu sb
                     WHERE sb.site_id = st.site_id AND sb.bu_id = d.scope_bu_id
                  ))
                  OR (d.scope_level = 'site' AND st.site_id = d.scope_site_id)
                  OR (d.scope_level = 'dept' AND dp.dept_id = d.scope_dept_id)
                )
           )
           OR EXISTS (
             SELECT 1
               FROM user_roles r
              WHERE r.user_id = ${userId} AND r.is_active
                AND r.role_code = 'DC_ADMIN'
           )
         )
    ) AS ok`;
  return rows[0]?.ok ?? false;
}

/** Các mục đã bóc tách của phiên bản (giai đoạn 4 mới có nội dung; giờ trả rỗng an toàn). */
export async function loadSections(sql: Sql, versionId: string) {
  return sql<{ section_code: string; section_title: string; raw_text: string | null }[]>`
    SELECT section_code, section_title, raw_text
      FROM document_sections WHERE version_id = ${versionId} ORDER BY order_no`;
}

/** Nhãn liên kết của phiên bản. */
export async function loadLinks(sql: Sql, versionId: string) {
  return sql<{ link_type: string; link_code: string; section_id: string | null }[]>`
    SELECT link_type, link_code, section_id
      FROM document_links WHERE version_id = ${versionId} ORDER BY link_type, link_code`;
}

/** Phiên bản đang hiệu lực của cùng doc_id (để trỏ khi xem bản hết hiệu lực). */
export async function currentVersionOf(sql: Sql, docId: string): Promise<{ version_id: string; version_no: string } | null> {
  const rows = await sql<{ version_id: string; version_no: string }[]>`
    SELECT version_id, version_no FROM document_versions
     WHERE doc_id = ${docId} AND status = 'hieu_luc' LIMIT 1`;
  return rows[0] ?? null;
}
