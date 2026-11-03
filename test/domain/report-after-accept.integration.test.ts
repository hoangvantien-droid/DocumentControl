/**
 * test/domain/report-after-accept.integration.test.ts — ĐIỂM 7 (CHẠM DB).
 *
 * Sau khi site đã CHẤP NHẬN, chuyển report của Reader thành "từ chối" không được
 * làm lệch dữ liệu (trước đây report đóng + nhật ký từ chối nhưng receipt vẫn
 * chap_nhan). Nay convertReportToRejection:
 *  - sai_dang_ky sau khi chấp nhận -> CHẶN (report.already_accepted);
 *  - sai_noi_dung sau khi chấp nhận -> ĐƯỜNG báo sai nội dung riêng: receipt GIỮ
 *    chap_nhan, report chuyển 'bao_sai_noi_dung_sau_chap_nhan' (không lệch).
 *
 * Tự SKIP khi không có Postgres / seed chưa đủ (cần Reader cùng site với DC Site).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import { acceptReceipt, listReceiptsForVersion } from '../../src/domain/receipt.js';
import { createIssueReport, convertReportToRejection } from '../../src/domain/issue-report.js';
import {
  resolveDbUrl, connectLifecycle, cleanupDoc, versionInput, type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('Điểm 7 — report sau khi chấp nhận không gây lệch (tích hợp DB)', () => {
  let env: LifecycleEnv;
  let READER_ID = '';
  let READER_SITE = '';
  let DC_ID = '';
  const created: string[] = [];

  before(async () => {
    env = await connectLifecycle(dbUrl);
    if (!env.sql) return;
    const sql = env.sql;
    // Reader + site của Reader (suy từ Dept chính) + một DC Site cùng site đó.
    const r = await sql`
      SELECT u.user_id, dp.site_id
        FROM users u JOIN org_department dp ON dp.dept_id = u.primary_dept_id
       WHERE u.email = 'reader@mml.io' LIMIT 1`;
    READER_ID = r[0]?.user_id ?? '';
    READER_SITE = r[0]?.site_id ?? '';
    if (READER_SITE) {
      const dc = await sql`
        SELECT user_id FROM user_roles
         WHERE role_code = 'DC_SITE_DOC_CONTROL' AND is_active AND scope_site_id = ${READER_SITE}
         LIMIT 1`;
      DC_ID = dc[0]?.user_id ?? '';
    }
  });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) await cleanupDoc(env.sql, d);
    await env.sql.end();
  });

  async function setup(docId: string): Promise<{ versionId: string; reportId: string }> {
    const sql = env.sql!;
    created.push(docId);
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [READER_SITE] },
    );
    // Site chấp nhận TRƯỚC.
    const receipts = await listReceiptsForVersion(sql as never, versionId);
    const mine = receipts.find((r) => r.site_id === READER_SITE)!;
    await acceptReceipt(sql as never, { receiptId: mine.receipt_id, userId: DC_ID });
    // Reader báo bất thường SAU khi đã chấp nhận.
    const reportId = await createIssueReport(sql as never, {
      versionId, userId: READER_ID, note: 'Phát hiện bất thường sau khi áp dụng',
    });
    return { versionId, reportId };
  }

  test('sai_dang_ky sau khi chấp nhận -> CHẶN (report.already_accepted), receipt giữ chap_nhan', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || !READER_ID || !READER_SITE || !DC_ID) return t.skip('Seed chưa đủ (Reader + DC cùng site)');
    const sql = env.sql!;
    const { versionId, reportId } = await setup(`TEST-REP1-${Date.now()}`);

    await assert.rejects(
      convertReportToRejection(sql as never, {
        reportId, userId: DC_ID, rejectType: 'sai_dang_ky', note: 'Sai số hiệu',
      }),
      /phiên bản mới|chấp nhận/,
    );
    const rc = await listReceiptsForVersion(sql as never, versionId);
    assert.equal(rc.find((r) => r.site_id === READER_SITE)!.status, 'chap_nhan',
      'receipt phải giữ chap_nhan, không lệch');
  });

  test('sai_noi_dung sau khi chấp nhận -> đường riêng: receipt giữ chap_nhan, report đổi trạng thái', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || !READER_ID || !READER_SITE || !DC_ID) return t.skip('Seed chưa đủ (Reader + DC cùng site)');
    const sql = env.sql!;
    const { versionId, reportId } = await setup(`TEST-REP2-${Date.now()}`);

    await convertReportToRejection(sql as never, {
      reportId, userId: DC_ID, rejectType: 'sai_noi_dung', note: 'Nội dung sai thực tế',
    });

    const rc = await listReceiptsForVersion(sql as never, versionId);
    assert.equal(rc.find((r) => r.site_id === READER_SITE)!.status, 'chap_nhan',
      'receipt KHÔNG đảo ngược về từ chối (giữ chap_nhan)');
    const rep = await sql`SELECT status FROM document_issue_report WHERE report_id = ${reportId}`;
    assert.equal(rep[0].status, 'bao_sai_noi_dung_sau_chap_nhan',
      'report đi đường báo sai nội dung sau chấp nhận');
  });
});
