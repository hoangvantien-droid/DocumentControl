/**
 * test/domain/apply-date.integration.test.ts — ĐIỂM 8 (CHẠM DB).
 *
 * Ngày site áp dụng (apply_date) không được SỚM hơn ngày có hiệu lực của tài
 * liệu. acceptReceipt với applyDate < effective_date -> receipt.apply_before_effective.
 * applyDate == effective_date thì hợp lệ.
 *
 * Tự SKIP khi không có Postgres.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import { acceptReceipt, listReceiptsForVersion } from '../../src/domain/receipt.js';
import {
  resolveDbUrl, connectLifecycle, dcSiteUserFor, cleanupDoc, versionInput, today, shiftDays,
  type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('Điểm 8 — apply_date không sớm hơn ngày hiệu lực (tích hợp DB)', () => {
  let env: LifecycleEnv;
  const created: string[] = [];

  before(async () => { env = await connectLifecycle(dbUrl); });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) await cleanupDoc(env.sql, d);
    await env.sql.end();
  });

  test('applyDate < effective_date -> chặn; applyDate = effective_date -> OK', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const DC_ID = await dcSiteUserFor(sql, env.SITE_IDS[0]);
    if (!DC_ID) return t.skip('Chưa seed DC Site cho site này');
    const docId = `TEST-APPLY-${Date.now()}`;
    created.push(docId);

    // effective = hôm nay (hợp lệ khi đăng ký).
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    const receipts = await listReceiptsForVersion(sql as never, versionId);
    const mine = receipts.find((r) => r.site_id === env.SITE_IDS[0])!;

    // applyDate hôm qua (< effective = hôm nay) -> chặn.
    await assert.rejects(
      acceptReceipt(sql as never, { receiptId: mine.receipt_id, userId: DC_ID, applyDate: shiftDays(-1) }),
      /sớm hơn ngày có hiệu lực/,
    );

    // applyDate = hôm nay (= effective) -> OK.
    await acceptReceipt(sql as never, { receiptId: mine.receipt_id, userId: DC_ID, applyDate: today() });
    const after = await listReceiptsForVersion(sql as never, versionId);
    const acc = after.find((r) => r.receipt_id === mine.receipt_id)!;
    assert.equal(acc.status, 'chap_nhan');
    assert.equal(acc.apply_date, today());
  });
});
