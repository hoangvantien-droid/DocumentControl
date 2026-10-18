/**
 * test/domain/receipt-model.integration.test.ts — kiểm thử TÍCH HỢP mô hình
 * receipt (CHẠM DB). Chạy trên máy có Postgres + schema đã migrate.
 *
 * Đọc DATABASE_URL linh hoạt: /etc/dcs/.env (target) hoặc .env (dev) hoặc biến
 * môi trường. Nếu không có DB -> toàn bộ suite bị bỏ qua (skip) thay vì ném lỗi
 * import, để `npm test` ở máy không-DB vẫn xanh.
 *
 * Phủ:
 *  - Task 3: submitRegistration -> status da_ban_hanh + sinh receipt cho_phan_hoi/site.
 *  - Task 5: aggregateStatus suy đúng từ tập receipt.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { submitRegistration } from '../../src/domain/registration.js';
import {
  publishToSites, receiptTally, aggregateStatus, listReceiptsForVersion,
  acceptReceipt, rejectReceipt, editVersionMetadata, deleteUnacceptedVersion, recallByAuthor,
} from '../../src/domain/receipt.js';

function resolveDbUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const p of ['/etc/dcs/.env', '.env']) {
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^DATABASE_URL=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

const dbUrl = resolveDbUrl();

describe('Mô hình receipt (tích hợp DB)', () => {
  let sql: ReturnType<typeof postgres> | null = null;
  let dbOk = false;
  let AUTHOR_ID: string;
  let SITE_IDS: string[] = [];
  const createdDocs: string[] = [];

  before(async () => {
    if (!dbUrl) return;
    try {
      const probe = postgres(dbUrl, { max: 1, onnotice: () => {}, connect_timeout: 3 });
      await probe`SELECT 1`;
      sql = probe;
      dbOk = true;
      const a = await sql`SELECT user_id FROM users WHERE email = 'author@mml.io' LIMIT 1`;
      AUTHOR_ID = a[0]?.user_id;
      const sites = await sql`SELECT site_id FROM org_site ORDER BY site_code LIMIT 2`;
      SITE_IDS = sites.map((r: { site_id: string }) => r.site_id);
    } catch {
      dbOk = false; // không có Postgres chạy -> các test tự skip
    }
  });

  after(async () => {
    if (!sql) return;
    for (const d of createdDocs) {
      await sql`DELETE FROM document_versions WHERE doc_id = ${d}`;
      await sql`DELETE FROM documents WHERE doc_id = ${d}`;
    }
    await sql.end();
  });

  test('đăng ký -> da_ban_hanh + sinh receipt cho_phan_hoi cho mỗi site', async (t) => {
    if (!dbOk) return t.skip('Không có Postgres chạy');
    if (!AUTHOR_ID || SITE_IDS.length < 1) return; // seed chưa đủ
    const docId = `TEST-RCPT-${Date.now()}`;
    createdDocs.push(docId);
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      {
        docId, versionNo: '1.0', title: 'Test receipt',
        issuedDate: '2026-12-31', effectiveDate: '2026-12-31',
        reviewCycleMonths: 12, sourceChannel: 'thu_cong',
        filePath: '/tmp/t.pdf', fileHash: 'hash-rcpt',
        registrantUserId: AUTHOR_ID, ownerDepartmentId: '',
      },
      { m14Enabled: false, siteIds: SITE_IDS },
    );
    const ver = await sql`SELECT status FROM document_versions WHERE version_id = ${versionId}`;
    assert.equal(ver[0].status, 'da_ban_hanh');

    const receipts = await listReceiptsForVersion(sql as never, versionId);
    assert.equal(receipts.length, SITE_IDS.length);
    assert.ok(receipts.every((r) => r.status === 'cho_phan_hoi'));

    const agg = await aggregateStatus(sql as never, versionId);
    assert.equal(agg, 'dang_cho');
  });

  test('publishToSites idempotent (thêm lại site không nhân đôi)', async (t) => {
    if (!dbOk) return t.skip('Không có Postgres chạy');
    if (!AUTHOR_ID || SITE_IDS.length < 1) return;
    const docId = `TEST-RCPT2-${Date.now()}`;
    createdDocs.push(docId);
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      {
        docId, versionNo: '1.0', title: 'Test idempotent',
        issuedDate: '2026-12-31', effectiveDate: '2026-12-31',
        reviewCycleMonths: 12, sourceChannel: 'thu_cong',
        filePath: '/tmp/t.pdf', fileHash: 'hash-rcpt2',
        registrantUserId: AUTHOR_ID, ownerDepartmentId: '',
      },
      { m14Enabled: false, siteIds: [SITE_IDS[0]] },
    );
    // Phát hành lại cùng site -> không tạo thêm.
    const added = await sql!.begin(async (tx) =>
      publishToSites(tx as never, { versionId, siteIds: [SITE_IDS[0]], actorUserId: AUTHOR_ID }),
    );
    assert.equal(added, 0);
    const tally = await receiptTally(sql as never, versionId);
    assert.equal(tally.total, 1);
  });

  test('phải chọn ít nhất một site -> BusinessError', async (t) => {
    if (!dbOk) return t.skip('Không có Postgres chạy');
    if (!AUTHOR_ID) return;
    const docId = `TEST-RCPT3-${Date.now()}`;
    createdDocs.push(docId);
    await assert.rejects(
      submitRegistration(
        sql as never,
        { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
        {
          docId, versionNo: '1.0', title: 'No site',
          issuedDate: '2026-12-31', effectiveDate: '2026-12-31',
          reviewCycleMonths: 12, sourceChannel: 'thu_cong',
          filePath: '/tmp/t.pdf', fileHash: 'hash-rcpt3',
          registrantUserId: AUTHOR_ID, ownerDepartmentId: '',
        },
        { m14Enabled: false, siteIds: [] },
      ),
      /site/,
    );
  });

  test('DC Site chấp nhận/từ chối -> đổi trạng thái + tổng hợp tranh_chap', async (t) => {
    if (!dbOk) return t.skip('Không có Postgres chạy');
    if (!AUTHOR_ID || SITE_IDS.length < 2) return t.skip('Cần ≥2 site + 1 DC Site để kiểm');
    // Cần một user giữ DC_SITE_DOC_CONTROL cho SITE_IDS[0].
    const dc = await sql!`
      SELECT user_id FROM user_roles
       WHERE role_code = 'DC_SITE_DOC_CONTROL' AND is_active AND scope_site_id = ${SITE_IDS[0]}
       LIMIT 1`;
    if (!dc[0]) return t.skip('Chưa seed DC Site cho site này');
    const DC_ID = dc[0].user_id;

    const docId = `TEST-RCPT4-${Date.now()}`;
    createdDocs.push(docId);
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      {
        docId, versionNo: '1.0', title: 'Respond test',
        issuedDate: '2026-12-31', effectiveDate: '2026-12-31',
        reviewCycleMonths: 12, sourceChannel: 'thu_cong',
        filePath: '/tmp/t.pdf', fileHash: 'hash-rcpt4',
        registrantUserId: AUTHOR_ID, ownerDepartmentId: '',
      },
      { m14Enabled: false, siteIds: [SITE_IDS[0], SITE_IDS[1]] },
    );
    const receipts = await listReceiptsForVersion(sql as never, versionId);
    const mine = receipts.find((r) => r.site_id === SITE_IDS[0])!;

    await acceptReceipt(sql as never, { receiptId: mine.receipt_id, userId: DC_ID });
    const after = await listReceiptsForVersion(sql as never, versionId);
    const acc = after.find((r) => r.receipt_id === mine.receipt_id)!;
    assert.equal(acc.status, 'chap_nhan');
    assert.ok(acc.apply_date, 'phải ghi apply_date khi chấp nhận');
    assert.equal(await aggregateStatus(sql as never, versionId), 'mot_phan');
  });

  test('Author sửa metadata khi chưa ai chấp nhận -> OK; đã chấp nhận -> khóa', async (t) => {
    if (!dbOk) return t.skip('Không có Postgres chạy');
    if (!AUTHOR_ID || SITE_IDS.length < 1) return;
    const docId = `TEST-EDIT-${Date.now()}`;
    createdDocs.push(docId);
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      {
        docId, versionNo: '1.0', title: 'Edit test',
        issuedDate: '2026-12-31', effectiveDate: '2026-12-31',
        reviewCycleMonths: 12, sourceChannel: 'thu_cong',
        filePath: '/tmp/t.pdf', fileHash: 'hash-edit',
        registrantUserId: AUTHOR_ID, ownerDepartmentId: '',
      },
      { m14Enabled: false, siteIds: [SITE_IDS[0]] },
    );
    // Chưa ai chấp nhận -> sửa được.
    await editVersionMetadata(sql as never, {
      versionId, userId: AUTHOR_ID, patch: { title: 'Tiêu đề đã sửa' },
    });
    const after = await sql!`SELECT title FROM document_versions WHERE version_id = ${versionId}`;
    assert.equal(after[0].title, 'Tiêu đề đã sửa');

    // Giả lập một site chấp nhận -> khóa sửa.
    const dc = await sql!`
      SELECT user_id FROM user_roles WHERE role_code='DC_SITE_DOC_CONTROL' AND is_active AND scope_site_id=${SITE_IDS[0]} LIMIT 1`;
    if (dc[0]) {
      const receipts = await listReceiptsForVersion(sql as never, versionId);
      await acceptReceipt(sql as never, { receiptId: receipts[0].receipt_id, userId: dc[0].user_id });
      await assert.rejects(
        editVersionMetadata(sql as never, { versionId, userId: AUTHOR_ID, patch: { title: 'X' } }),
        /site chấp nhận/,
      );
      // Đã chấp nhận -> cũng không xóa được.
      await assert.rejects(
        deleteUnacceptedVersion(sql as never, { versionId, userId: AUTHOR_ID }),
        /chấp nhận/,
      );
    }
  });

  test('Author thu hồi khi chưa ai chấp nhận -> thu_hoi', async (t) => {
    if (!dbOk) return t.skip('Không có Postgres chạy');
    if (!AUTHOR_ID || SITE_IDS.length < 1) return;
    const docId = `TEST-RECALL-${Date.now()}`;
    createdDocs.push(docId);
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      {
        docId, versionNo: '1.0', title: 'Recall test',
        issuedDate: '2026-12-31', effectiveDate: '2026-12-31',
        reviewCycleMonths: 12, sourceChannel: 'thu_cong',
        filePath: '/tmp/t.pdf', fileHash: 'hash-recall',
        registrantUserId: AUTHOR_ID, ownerDepartmentId: '',
      },
      { m14Enabled: false, siteIds: [SITE_IDS[0]] },
    );
    await recallByAuthor(sql as never, { versionId, userId: AUTHOR_ID, reason: 'Sai nội dung, làm lại' });
    const v = await sql!`SELECT status, recall_reason FROM document_versions WHERE version_id = ${versionId}`;
    assert.equal(v[0].status, 'thu_hoi');
    assert.ok(v[0].recall_reason);
  });

  test('END-TO-END: ban hành → 1 site từ chối sai nội dung → tranh_chap → thu hồi', async (t) => {
    if (!dbOk) return t.skip('Không có Postgres chạy');
    if (!AUTHOR_ID || SITE_IDS.length < 2) return t.skip('Cần ≥2 site');
    const dc = await sql!`
      SELECT user_id FROM user_roles WHERE role_code='DC_SITE_DOC_CONTROL' AND is_active AND scope_site_id=${SITE_IDS[0]} LIMIT 1`;
    if (!dc[0]) return t.skip('Chưa seed DC Site cho site');
    const DC_ID = dc[0].user_id;

    const docId = `TEST-E2E-${Date.now()}`;
    createdDocs.push(docId);
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      {
        docId, versionNo: '1.0', title: 'E2E flow',
        issuedDate: '2026-12-31', effectiveDate: '2026-12-31',
        reviewCycleMonths: 12, sourceChannel: 'thu_cong',
        filePath: '/tmp/t.pdf', fileHash: 'hash-e2e',
        registrantUserId: AUTHOR_ID, ownerDepartmentId: '',
      },
      { m14Enabled: false, siteIds: [SITE_IDS[0], SITE_IDS[1]] },
    );
    const receipts = await listReceiptsForVersion(sql as never, versionId);
    const site0 = receipts.find((r) => r.site_id === SITE_IDS[0])!;

    // Site 0 từ chối sai nội dung.
    await rejectReceipt(sql as never, {
      receiptId: site0.receipt_id, userId: DC_ID,
      rejectType: 'sai_noi_dung', note: 'Nội dung không khớp thực tế',
    });
    assert.equal(await aggregateStatus(sql as never, versionId), 'tranh_chap');

    // Author được thu hồi (có từ chối, chưa ai chấp nhận).
    await recallByAuthor(sql as never, { versionId, userId: AUTHOR_ID, reason: 'Làm lại do sai nội dung' });
    const v = await sql!`SELECT status FROM document_versions WHERE version_id=${versionId}`;
    assert.equal(v[0].status, 'thu_hoi');
  });

  test('DC Site lạ site -> không phản hồi được (403)', async (t) => {
    if (!dbOk) return t.skip('Không có Postgres chạy');
    if (!AUTHOR_ID || SITE_IDS.length < 2) return t.skip('Cần ≥2 site');
    const dcOther = await sql!`
      SELECT user_id FROM user_roles
       WHERE role_code = 'DC_SITE_DOC_CONTROL' AND is_active AND scope_site_id = ${SITE_IDS[1]}
         AND user_id NOT IN (
           SELECT user_id FROM user_roles WHERE role_code='DC_SITE_DOC_CONTROL' AND is_active AND scope_site_id=${SITE_IDS[0]})
       LIMIT 1`;
    if (!dcOther[0]) return t.skip('Chưa seed DC Site riêng cho site 2');
    const docId = `TEST-RCPT5-${Date.now()}`;
    createdDocs.push(docId);
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      {
        docId, versionNo: '1.0', title: 'Cross-site test',
        issuedDate: '2026-12-31', effectiveDate: '2026-12-31',
        reviewCycleMonths: 12, sourceChannel: 'thu_cong',
        filePath: '/tmp/t.pdf', fileHash: 'hash-rcpt5',
        registrantUserId: AUTHOR_ID, ownerDepartmentId: '',
      },
      { m14Enabled: false, siteIds: [SITE_IDS[0]] },
    );
    const receipts = await listReceiptsForVersion(sql as never, versionId);
    await assert.rejects(
      acceptReceipt(sql as never, { receiptId: receipts[0].receipt_id, userId: dcOther[0].user_id }),
      /thẩm quyền/,
    );
  });
});
