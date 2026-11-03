/**
 * test/domain/ind01-superseded-receipt.integration.test.ts — IND-01 (CHẠM DB).
 *
 * Phiếu (receipt) của một phiên bản đã bị bản mới THAY THẾ (status
 * 'het_hieu_luc') KHÔNG được:
 *   - còn nằm trong hàng chờ phản hồi của site (pendingReceiptsForSites);
 *   - được chấp nhận (assertCanRespond ném receipt.superseded).
 *
 * Kịch bản: ban hành v1.0 (tạo phiếu cho_phan_hoi tới một site) rồi ban hành
 * v2.0 thay thế (supersede) -> v1.0 sang 'het_hieu_luc'. Kiểm phiếu v1.0 biến
 * mất khỏi hàng chờ + chấp nhận bị chặn.
 *
 * Tự SKIP khi không có Postgres / seed chưa đủ. Theo khuôn _lifecycle-db.ts.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import {
  acceptReceipt, listReceiptsForVersion, pendingReceiptsForSites,
} from '../../src/domain/receipt.js';
import {
  resolveDbUrl, connectLifecycle, dcSiteUserFor, cleanupDoc, versionInput,
  type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('IND-01 — phiếu của bản het_hieu_luc bị loại (tích hợp DB)', () => {
  let env: LifecycleEnv;
  let SITE = '';
  let DC_ID = '';
  const created: string[] = [];

  before(async () => {
    env = await connectLifecycle(dbUrl);
    if (!env.sql) return;
    SITE = env.SITE_IDS[0] ?? '';
    if (SITE) DC_ID = await dcSiteUserFor(env.sql, SITE);
  });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) await cleanupDoc(env.sql, d);
    await env.sql.end();
  });

  test('ban hành bản thay thế -> phiếu bản cũ biến mất khỏi hàng chờ + chặn chấp nhận', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || !SITE || !DC_ID) return t.skip('Seed chưa đủ (AUTHOR + site + DC Site)');
    const sql = env.sql!;
    const docId = `TEST-IND01-${Date.now()}`;
    created.push(docId);

    // v1.0 ban hành tới site -> phiếu cho_phan_hoi.
    const v1 = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID, { versionNo: '1.0' }) as never,
      { m14Enabled: false, siteIds: [SITE] },
    );
    const rc1 = await listReceiptsForVersion(sql as never, v1);
    const receipt1 = rc1.find((r) => r.site_id === SITE)!;

    // Phiếu v1 đang trong hàng chờ của site.
    const before = await pendingReceiptsForSites(sql as never, [SITE]);
    assert.ok(before.some((r) => r.receipt_id === receipt1.receipt_id),
      'phiếu v1 phải nằm trong hàng chờ trước khi bị thay thế');

    // v2.0 thay thế v1 -> v1 sang het_hieu_luc.
    await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID, { versionNo: '2.0', supersedesVersionId: v1, changeSignificance: 'nho' }) as never,
      { m14Enabled: false, siteIds: [SITE] },
    );

    const v1row = await sql`SELECT status FROM document_versions WHERE version_id = ${v1}`;
    assert.equal(v1row[0].status, 'het_hieu_luc', 'v1 phải sang het_hieu_luc');

    // Phiếu v1 KHÔNG còn trong hàng chờ.
    const afterQueue = await pendingReceiptsForSites(sql as never, [SITE]);
    assert.ok(!afterQueue.some((r) => r.receipt_id === receipt1.receipt_id),
      'phiếu của bản het_hieu_luc phải biến mất khỏi hàng chờ');

    // Chấp nhận phiếu bản cũ bị chặn (receipt.superseded).
    await assert.rejects(
      acceptReceipt(sql as never, { receiptId: receipt1.receipt_id, userId: DC_ID }),
      /thay thế|superseded/i,
    );
  });
});
