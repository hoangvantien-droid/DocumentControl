/**
 * test/domain/recall-pending.integration.test.ts — ĐIỂM 5 (CHẠM DB).
 *
 * Sau khi Author thu hồi (recallByAuthor), phiếu "chờ phản hồi" của bản bị thu
 * hồi phải:
 *  - bị LOẠI khỏi số đếm chờ trên menu (pendingReceiptCountForSites);
 *  - không chấp nhận được nữa (acceptReceipt -> receipt.recalled).
 *
 * Tự SKIP khi không có Postgres.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import {
  acceptReceipt, listReceiptsForVersion, pendingReceiptCountForSites, recallByAuthor,
} from '../../src/domain/receipt.js';
import {
  resolveDbUrl, connectLifecycle, dcSiteUserFor, cleanupDoc, versionInput, type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('Điểm 5 — thu hồi vô hiệu phiếu chờ (tích hợp DB)', () => {
  let env: LifecycleEnv;
  const created: string[] = [];

  before(async () => { env = await connectLifecycle(dbUrl); });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) await cleanupDoc(env.sql, d);
    await env.sql.end();
  });

  test('thu hồi: loại khỏi số đếm chờ + chặn chấp nhận (receipt.recalled)', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const DC_ID = await dcSiteUserFor(sql, env.SITE_IDS[0]);
    if (!DC_ID) return t.skip('Chưa seed DC Site cho site này');
    const docId = `TEST-RECPEND-${Date.now()}`;
    created.push(docId);

    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    const receipts = await listReceiptsForVersion(sql as never, versionId);
    const mine = receipts.find((r) => r.site_id === env.SITE_IDS[0])!;

    const beforeCount = await pendingReceiptCountForSites(sql as never, [env.SITE_IDS[0]]);
    assert.ok(beforeCount >= 1, 'phiếu chờ phải được đếm trước khi thu hồi');

    await recallByAuthor(sql as never, { versionId, userId: env.AUTHOR_ID, reason: 'Thu hồi kiểm thử số đếm' });

    const afterCount = await pendingReceiptCountForSites(sql as never, [env.SITE_IDS[0]]);
    assert.equal(afterCount, beforeCount - 1, 'phiếu của bản thu hồi phải bị loại khỏi số đếm chờ');

    await assert.rejects(
      acceptReceipt(sql as never, { receiptId: mine.receipt_id, userId: DC_ID }),
      /thu hồi/,
    );
  });
});
