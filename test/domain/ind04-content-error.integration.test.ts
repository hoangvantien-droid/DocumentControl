/**
 * test/domain/ind04-content-error.integration.test.ts — IND-04 (CHẠM DB).
 *
 * Sau khi site ĐÃ CHẤP NHẬN (toan_bo) rồi Reader báo SAI NỘI DUNG (report đi
 * đường 'bao_sai_noi_dung_sau_chap_nhan'):
 *   - assembleMyDocuments trả hasPostAcceptContentError=true cho version đó
 *     (IND-04a: aggregate hiển thị cảnh báo thay vì "toàn bộ đã áp dụng");
 *   - trang chủ (home) liệt kê version qua truy vấn contentErrorMine (IND-04b);
 *   - Author vẫn THU HỒI được dù 100% site đã chấp nhận (IND-04c: canRecall).
 *
 * Tự SKIP khi không có Postgres / seed chưa đủ. Theo khuôn _lifecycle-db.ts.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import { acceptReceipt, listReceiptsForVersion, recallByAuthor } from '../../src/domain/receipt.js';
import { createIssueReport, convertReportToRejection } from '../../src/domain/issue-report.js';
import { assembleMyDocuments } from '../../src/routes/documents.js';
import {
  resolveDbUrl, connectLifecycle, cleanupDoc, versionInput, type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('IND-04 — báo sai nội dung sau chấp nhận (tích hợp DB)', () => {
  let env: LifecycleEnv;
  let READER_ID = '';
  let READER_SITE = '';
  let DC_ID = '';
  const created: string[] = [];

  before(async () => {
    env = await connectLifecycle(dbUrl);
    if (!env.sql) return;
    const sql = env.sql;
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

  test('toan_bo + post-accept -> cảnh báo; home liệt kê; recall khi 100% chấp nhận', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || !READER_ID || !READER_SITE || !DC_ID) return t.skip('Seed chưa đủ (Reader + DC cùng site)');
    const sql = env.sql!;
    const docId = `TEST-IND04-${Date.now()}`;
    created.push(docId);

    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [READER_SITE] },
    );
    // Site chấp nhận (toan_bo).
    const receipts = await listReceiptsForVersion(sql as never, versionId);
    const mine = receipts.find((r) => r.site_id === READER_SITE)!;
    await acceptReceipt(sql as never, { receiptId: mine.receipt_id, userId: DC_ID });

    // Reader báo bất thường -> DC chuyển thành báo sai nội dung sau chấp nhận.
    const reportId = await createIssueReport(sql as never, {
      versionId, userId: READER_ID, note: 'Nội dung sai sau khi áp dụng',
    });
    await convertReportToRejection(sql as never, {
      reportId, userId: DC_ID, rejectType: 'sai_noi_dung', note: 'Sai thực tế',
    });

    // IND-04a: assembleMyDocuments đánh dấu hasPostAcceptContentError.
    const docs = await assembleMyDocuments(sql as never, env.AUTHOR_ID);
    const row = docs.find((d) => d.version_id === versionId);
    assert.ok(row, 'version phải xuất hiện trong tài liệu của tôi');
    assert.equal(row!.hasPostAcceptContentError, true,
      'phải có cờ báo sai nội dung sau chấp nhận');

    // IND-04b: truy vấn home contentErrorMine liệt kê version này.
    const home = await sql`
      SELECT DISTINCT v.version_id
        FROM document_versions v
        JOIN document_issue_report ir ON ir.version_id = v.version_id
       WHERE v.registrant_user_id = ${env.AUTHOR_ID}
         AND ir.status = 'bao_sai_noi_dung_sau_chap_nhan'`;
    assert.ok(home.some((h: { version_id: string }) => h.version_id === versionId),
      'home phải liệt kê version bị báo sai nội dung sau chấp nhận');

    // IND-04c: Author thu hồi được dù mọi site đã chấp nhận.
    await recallByAuthor(sql as never, {
      versionId, userId: env.AUTHOR_ID, reason: 'Thu hồi do sai nội dung',
    });
    const after = await sql`SELECT status FROM document_versions WHERE version_id = ${versionId}`;
    assert.equal(after[0].status, 'thu_hoi', 'version phải sang thu_hoi sau recall');
  });
});
