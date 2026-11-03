/**
 * test/domain/apply-date.integration.test.ts — ĐIỂM 8 / HƯỚNG 2 (CHẠM DB).
 *
 * Mô hình per-site (HƯỚNG 2): apply_date = site_effective_date của chính site
 * đó. Mỗi site có ngày hiệu lực ĐỘC LẬP — có thể SỚM hơn ngày hiệu lực gốc của
 * version, chỉ cần >= issued_date và >= hôm nay (giờ VN) lúc khai. Guard cũ
 * (apply_date >= effective_date gốc, mã lỗi receipt.apply_before_effective) ĐÃ
 * BỊ GỠ vì làm receipt kẹt khi site_effective_date nằm trong
 * [issued_date, effective_date_gốc).
 *
 * Ca kiểm: version có effective_date gốc ở TƯƠNG LAI; thêm một site với
 * site_effective_date SỚM HƠN ngày gốc (nhưng >= issued_date, >= hôm nay) ->
 *   (a) publishAdditionalSites OK;
 *   (b) site chấp nhận OK, KHÔNG throw apply_before_effective;
 *   (c) apply_date ghi = site_effective_date.
 *
 * Tự SKIP khi không có Postgres.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import { acceptReceipt, listReceiptsForVersion, publishAdditionalSites } from '../../src/domain/receipt.js';
import {
  resolveDbUrl, connectLifecycle, dcSiteUserFor, cleanupDoc, versionInput, shiftDays,
  type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('HƯỚNG 2 — apply_date = site_effective_date độc lập (tích hợp DB)', () => {
  let env: LifecycleEnv;
  const created: string[] = [];

  before(async () => { env = await connectLifecycle(dbUrl); });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) await cleanupDoc(env.sql, d);
    await env.sql.end();
  });

  test('thêm site với ngày hiệu lực SỚM hơn ngày gốc -> validate OK; chấp nhận trước ngày site vẫn bị chặn (before_effective, KHÔNG phải apply_before_effective)', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 2) return t.skip('Seed cần >= 2 site');
    const sql = env.sql!;
    const siteB = env.SITE_IDS[1];
    const DC_B = await dcSiteUserFor(sql, siteB);
    if (!DC_B) return t.skip('Chưa seed DC Site cho site thứ hai');
    const docId = `TEST-APPLY-D2-${Date.now()}`;
    created.push(docId);

    // effective_date gốc = hôm nay + 10 (tương lai); issued = hôm nay.
    const effGoc = shiftDays(10);
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID, { effectiveDate: effGoc }) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );

    // (a) Thêm site B với ngày hiệu lực riêng = hôm nay + 2 (SỚM hơn ngày gốc
    // +10, nhưng >= issued = hôm nay và >= hôm nay). Phải qua validate.
    const siteEff = shiftDays(2);
    const res = await publishAdditionalSites(sql as never, {
      versionId, userId: env.AUTHOR_ID, siteIds: [siteB],
      siteEffectiveDates: { [siteB]: siteEff },
    });
    assert.equal(res.added, 1, 'thêm site B phải thành công');

    const receipts = await listReceiptsForVersion(sql as never, versionId);
    const rcB = receipts.find((r) => r.site_id === siteB)!;
    assert.ok(rcB, 'phải có receipt cho site B');

    // (b) Chấp nhận TRƯỚC ngày hiệu lực của chính site đó (hôm nay < hôm nay+2):
    // vẫn bị chặn bởi guard điểm 4 (before_effective) — guard này được GIỮ.
    // KHÔNG còn chặn bởi apply_before_effective (đã gỡ ở HƯỚNG 2).
    await assert.rejects(
      acceptReceipt(sql as never, { receiptId: rcB.receipt_id, userId: DC_B }),
      /Chưa tới ngày hiệu lực/,
    );
  });

  test('ngày hiệu lực site = hôm nay nhưng SỚM hơn ngày gốc -> chấp nhận OK, apply_date = hôm nay', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 2) return t.skip('Seed cần >= 2 site');
    const sql = env.sql!;
    const siteB = env.SITE_IDS[1];
    const DC_B = await dcSiteUserFor(sql, siteB);
    if (!DC_B) return t.skip('Chưa seed DC Site cho site thứ hai');
    const docId = `TEST-APPLY-D2B-${Date.now()}`;
    created.push(docId);

    const effGoc = shiftDays(10);
    const siteEff = shiftDays(0); // = hôm nay: < effGoc nhưng = hôm nay -> chấp nhận được NGAY
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID, { effectiveDate: effGoc }) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    const res = await publishAdditionalSites(sql as never, {
      versionId, userId: env.AUTHOR_ID, siteIds: [siteB],
      siteEffectiveDates: { [siteB]: siteEff },
    });
    assert.equal(res.added, 1);

    const receipts = await listReceiptsForVersion(sql as never, versionId);
    const rcB = receipts.find((r) => r.site_id === siteB)!;

    // Trọng tâm: chấp nhận KHÔNG còn bị chặn apply_before_effective dù siteEff < effGoc.
    await acceptReceipt(sql as never, { receiptId: rcB.receipt_id, userId: DC_B });
    const afterR = await listReceiptsForVersion(sql as never, versionId);
    const acc = afterR.find((r) => r.receipt_id === rcB.receipt_id)!;
    assert.equal(acc.status, 'chap_nhan');
    assert.equal(acc.apply_date, siteEff, 'apply_date phải = ngày hiệu lực đã khai cho site');
  });
});
