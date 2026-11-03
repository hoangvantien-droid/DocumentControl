/**
 * test/domain/future-effective.integration.test.ts — ĐIỂM 4 (CHẠM DB).
 *
 * Ngày hiệu lực còn ở TƯƠNG LAI:
 *  - Reader (readOnlyViewer) KHÔNG thấy tài liệu trong danh mục (listVisibleDocuments);
 *  - site KHÔNG chấp nhận được (acceptReceipt -> receipt.before_effective).
 * Khi ngày hiệu lực = hôm nay thì cả hai mở lại.
 *
 * Tự SKIP khi không có Postgres.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import { acceptReceipt, listReceiptsForVersion } from '../../src/domain/receipt.js';
import { listVisibleDocuments } from '../../src/domain/catalog.js';
import {
  resolveDbUrl, connectLifecycle, dcSiteUserFor, cleanupDoc, versionInput, shiftDays,
  type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('Điểm 4 — ngày hiệu lực tương lai chặn hiển thị & chấp nhận (tích hợp DB)', () => {
  let env: LifecycleEnv;
  let READER_ID = '';
  const created: string[] = [];

  before(async () => {
    env = await connectLifecycle(dbUrl);
    if (env.sql) {
      const r = await env.sql`SELECT user_id FROM users WHERE email = 'reader@mml.io' LIMIT 1`;
      READER_ID = r[0]?.user_id ?? '';
    }
  });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) await cleanupDoc(env.sql, d);
    await env.sql.end();
  });

  test('Reader KHÔNG thấy tài liệu group có ngày hiệu lực tương lai, THẤY khi = hôm nay', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || !READER_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const docId = `TEST-FUT-${Date.now()}`;
    created.push(docId);

    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID, {
        issuedDate: shiftDays(5), effectiveDate: shiftDays(5),
      }) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );

    // Tương lai -> Reader không thấy.
    let visible = await listVisibleDocuments(sql as never, READER_ID, null, true);
    assert.equal(visible.some((r) => r.version_id === versionId), false,
      'Reader không được thấy bản chưa tới ngày hiệu lực');

    // Đưa ngày hiệu lực về hôm nay -> Reader thấy.
    await sql`UPDATE document_versions SET effective_date = CURRENT_DATE WHERE version_id = ${versionId}`;
    visible = await listVisibleDocuments(sql as never, READER_ID, null, true);
    assert.equal(visible.some((r) => r.version_id === versionId), true,
      'Reader thấy khi đã tới ngày hiệu lực');
  });

  test('site KHÔNG chấp nhận trước ngày hiệu lực (receipt.before_effective)', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const DC_ID = await dcSiteUserFor(sql, env.SITE_IDS[0]);
    if (!DC_ID) return t.skip('Chưa seed DC Site cho site này');
    const docId = `TEST-FUT2-${Date.now()}`;
    created.push(docId);

    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID, {
        issuedDate: shiftDays(5), effectiveDate: shiftDays(5),
      }) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    const receipts = await listReceiptsForVersion(sql as never, versionId);
    const mine = receipts.find((r) => r.site_id === env.SITE_IDS[0])!;

    await assert.rejects(
      acceptReceipt(sql as never, { receiptId: mine.receipt_id, userId: DC_ID }),
      /hiệu lực/,
    );

    // Về hôm nay -> chấp nhận được.
    await sql`UPDATE document_versions SET effective_date = CURRENT_DATE WHERE version_id = ${versionId}`;
    await acceptReceipt(sql as never, { receiptId: mine.receipt_id, userId: DC_ID });
    const after = await listReceiptsForVersion(sql as never, versionId);
    assert.equal(after.find((r) => r.receipt_id === mine.receipt_id)!.status, 'chap_nhan');
  });
});
