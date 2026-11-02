/**
 * src/domain/issue-report.ts — report bất thường của Reader + thẩm định DC Site.
 *
 * Luồng: Reader tạo report (moi) gắn version + site của mình → DC Site cùng
 * site thẩm định: chuyển thành từ chối receipt (chuyen_phan_hoi) hoặc bác bỏ
 * (bac_bo kèm lý do). Report KHÔNG trực tiếp đổi trạng thái tài liệu — chỉ là
 * tín hiệu nội bộ trong site. Kiểm quyền ở domain (DCS-8 §4.3).
 */
import type { Sql, TransactionSql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { siteIdsWithDocControl } from './permissions.js';
import { rejectReceipt, type RejectType } from './receipt.js';

export interface IssueReportRow {
  report_id: string;
  version_id: string;
  site_id: string;
  site_code: string | null;
  doc_id: string;
  version_no: string;
  title: string;
  reported_by: string;
  reporter_name: string | null;
  note: string;
  status: string;
  created_at: string;
}

/**
 * Reader gửi report bất thường. site_id lấy từ Dept chính của người báo (để DC
 * Site đúng site tiếp nhận). Nếu người báo chưa có site -> không báo được.
 */
export async function createIssueReport(
  sql: Sql,
  input: { versionId: string; userId: string; note: string },
): Promise<string> {
  if (!input.note.trim()) {
    throw new BusinessError('report.note', 'Vui lòng mô tả bất thường');
  }
  return sql.begin(async (tx) => {
    // Site của người báo suy từ Dept chính.
    const [u] = await tx<{ site_id: string | null }[]>`
      SELECT dp.site_id
        FROM users u LEFT JOIN org_department dp ON dp.dept_id = u.primary_dept_id
       WHERE u.user_id = ${input.userId}`;
    if (!u?.site_id) {
      throw new BusinessError('report.no_site', 'Tài khoản chưa gắn site (Dept chính) — không gửi report được');
    }
    const [ver] = await tx<{ version_id: string }[]>`
      SELECT version_id FROM document_versions WHERE version_id = ${input.versionId}`;
    if (!ver) throw new BusinessError('report.not_found', 'Không tìm thấy tài liệu');

    const [row] = await tx<{ report_id: string }[]>`
      INSERT INTO document_issue_report (version_id, site_id, reported_by, note, status)
      VALUES (${input.versionId}, ${u.site_id}, ${input.userId}, ${input.note.trim()}, 'moi')
      RETURNING report_id`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'bao_bat_thuong', actorUserId: input.userId,
      objectType: 'document_issue_report', objectId: row!.report_id,
      afterState: { version_id: input.versionId, site_id: u.site_id },
    });
    return row!.report_id;
  }) as Promise<string>;
}

/** Hộp report chờ thẩm định của các site DC Site phụ trách. */
export async function pendingReportsForSites(sql: Sql, siteIds: string[]): Promise<IssueReportRow[]> {
  if (siteIds.length === 0) return [];
  return sql<IssueReportRow[]>`
    SELECT ir.report_id, ir.version_id, ir.site_id, s.site_code,
           v.doc_id, v.version_no, v.title,
           ir.reported_by, u.full_name AS reporter_name,
           ir.note, ir.status, ir.created_at::text AS created_at
      FROM document_issue_report ir
      JOIN org_site s ON s.site_id = ir.site_id
      JOIN document_versions v ON v.version_id = ir.version_id
      LEFT JOIN users u ON u.user_id = ir.reported_by
     WHERE ir.status = 'moi' AND ir.site_id = ANY(${siteIds})
     ORDER BY ir.created_at DESC`;
}

async function loadReportForReview(
  tx: TransactionSql,
  reportId: string,
): Promise<{ report_id: string; version_id: string; site_id: string; status: string } | null> {
  const rows = await tx<{ report_id: string; version_id: string; site_id: string; status: string }[]>`
    SELECT report_id, version_id, site_id, status
      FROM document_issue_report WHERE report_id = ${reportId} FOR UPDATE`;
  return rows[0] ?? null;
}

async function assertSiteControl(tx: TransactionSql, userId: string, siteId: string): Promise<void> {
  const siteIds = await siteIdsWithDocControl(tx as unknown as Sql, userId);
  if (!siteIds.has(siteId)) {
    throw new BusinessError('report.no_permission', 'Không đủ thẩm quyền thẩm định report của site này', { httpStatus: 403 });
  }
}

/**
 * DC Site chuyển report thành TỪ CHỐI receipt của chính site đó (loại +
 * lý do). Nếu site chưa có receipt cho version (chưa phát hành tới) thì không
 * chuyển được — report chỉ áp cho tài liệu đã ban hành tới site.
 */
export async function convertReportToRejection(
  sql: Sql,
  input: { reportId: string; userId: string; rejectType: RejectType; note: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const r = await loadReportForReview(tx as TransactionSql, input.reportId);
    if (!r) throw new BusinessError('report.not_found', 'Không tìm thấy report');
    if (r.status !== 'moi') throw new BusinessError('report.bad_status', 'Report đã được thẩm định');
    await assertSiteControl(tx as TransactionSql, input.userId, r.site_id);

    const [receipt] = await tx<{ receipt_id: string; status: string }[]>`
      SELECT receipt_id, status FROM document_receipt
       WHERE version_id = ${r.version_id} AND site_id = ${r.site_id}`;
    if (!receipt) {
      throw new BusinessError('report.no_receipt', 'Site chưa nhận tài liệu này — không chuyển thành từ chối được');
    }

    const note = input.note.trim() || 'Chuyển từ report bất thường của người đọc';

    // Điểm 7: không được đóng report thành "từ chối" trong khi receipt vẫn
    // "chấp nhận" (trước đây UPDATE ... AND status='cho_phan_hoi' là no-op nên
    // report + nhật ký ghi từ chối còn receipt vẫn chap_nhan — lệch dữ liệu).
    if (receipt.status === 'chap_nhan') {
      if (input.rejectType === 'sai_dang_ky') {
        // Sai đăng ký sau khi đã chấp nhận: CHẶN — phải thu hồi + ra bản mới.
        throw new BusinessError(
          'report.already_accepted',
          'Site đã chấp nhận tài liệu — không thể chuyển report thành từ chối sai đăng ký; phải thu hồi và ban hành phiên bản mới',
        );
      }
      // sai_noi_dung sau khi đã chấp nhận: ĐƯỜNG BÁO SAI NỘI DUNG riêng —
      // giữ receipt ở chap_nhan (không đảo ngược), đánh dấu report đã xử lý và
      // ghi một sự kiện audit riêng để quản lý xử lý ở mức phiên bản.
      await tx`
        UPDATE document_issue_report
           SET status = 'bao_sai_noi_dung_sau_chap_nhan', reviewed_by = ${input.userId},
               reviewed_at = now(), review_note = ${note}
         WHERE report_id = ${input.reportId}`;
      await writeAudit(tx as TransactionSql, {
        eventType: 'bao_sai_noi_dung_sau_chap_nhan', actorUserId: input.userId,
        objectType: 'document_issue_report', objectId: input.reportId,
        afterState: { receipt_id: receipt.receipt_id, site_id: r.site_id, note, receipt_status: 'chap_nhan' },
      });
      return;
    }

    if (receipt.status !== 'cho_phan_hoi') {
      // Đã từ chối/khác — không chuyển lại được.
      throw new BusinessError('report.receipt_not_pending', 'Receipt của site không còn ở trạng thái chờ phản hồi — không chuyển thành từ chối được');
    }

    await tx`
      UPDATE document_issue_report
         SET status = 'chuyen_phan_hoi', reviewed_by = ${input.userId},
             reviewed_at = now(), review_note = ${input.note.trim() || null}
       WHERE report_id = ${input.reportId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'chuyen_report_phan_hoi', actorUserId: input.userId,
      objectType: 'document_issue_report', objectId: input.reportId,
      afterState: { receipt_id: receipt.receipt_id, reject_type: input.rejectType },
    });
    // Ghi từ chối lên receipt trong CÙNG giao dịch (dùng lại domain receipt).
    // Lưu ý: rejectReceipt tự mở giao dịch riêng của nó -> gọi ngoài để tránh
    // lồng giao dịch. Ở đây dùng tx trực tiếp để nguyên tử.
    await tx`
      UPDATE document_receipt
         SET status = 'tu_choi', response_type = ${input.rejectType},
             response_note = ${note}, apply_date = NULL,
             responded_by = ${input.userId}, responded_at = now()
       WHERE receipt_id = ${receipt.receipt_id} AND status = 'cho_phan_hoi'`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'tu_choi_nhan', actorUserId: input.userId,
      objectType: 'document_receipt', objectId: receipt.receipt_id,
      afterState: { site_id: r.site_id, response_type: input.rejectType, note, from_report: input.reportId },
    });
  });
  void rejectReceipt; // giữ tham chiếu để rõ quan hệ; logic nguyên tử ở trên.
}

/** DC Site bác bỏ report (kèm lý do). Không tác động receipt/tài liệu. */
export async function dismissReport(
  sql: Sql,
  input: { reportId: string; userId: string; reviewNote: string },
): Promise<void> {
  if (!input.reviewNote.trim()) {
    throw new BusinessError('report.dismiss_note', 'Bác bỏ report bắt buộc kèm lý do');
  }
  await sql.begin(async (tx) => {
    const r = await loadReportForReview(tx as TransactionSql, input.reportId);
    if (!r) throw new BusinessError('report.not_found', 'Không tìm thấy report');
    if (r.status !== 'moi') throw new BusinessError('report.bad_status', 'Report đã được thẩm định');
    await assertSiteControl(tx as TransactionSql, input.userId, r.site_id);
    await tx`
      UPDATE document_issue_report
         SET status = 'bac_bo', reviewed_by = ${input.userId},
             reviewed_at = now(), review_note = ${input.reviewNote.trim()}
       WHERE report_id = ${input.reportId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'bac_bo_report', actorUserId: input.userId,
      objectType: 'document_issue_report', objectId: input.reportId,
      afterState: { review_note: input.reviewNote.trim() },
    });
  });
}
