/**
 * test/domain/accepted-lock.integration.test.ts — ĐIỂM 6 (+7 phần khóa) (CHẠM DB).
 *
 * Khi đã có ≥1 site chấp nhận, KHÓA metadata dùng CHUNG một mã lỗi
 * ('issue.locked_accepted') cho CẢ:
 *  - editVersionMetadata (sửa đăng ký tại chỗ), và
 *  - publishAdditionalSites (phát hành lại) — không được phát hành lại metadata
 *    cũ sai, phải ra phiên bản mới.
 *
 * Tự SKIP khi không có Postgres.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import {
  acceptReceipt, editVersionMetadata, listReceiptsForVersion, publishAdditionalSites,
} from '../../src/domain/receipt.js';
import {
  resolveDbUrl, connectLifecycle, dcSiteUserFor, cleanupDoc, versionInput, type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('Điểm 6 — khóa metadata thống nhất sau khi chấp nhận (tích hợp DB)', () => {
  let env: LifecycleEnv;
  const created: string[] = [];

  before(async () => { env = await connectLifecycle(dbUrl); });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) await cleanupDoc(env.sql, d);
    await env.sql.end();
  });

  test('sau khi 1 site chấp nhận: editVersionMetadata VÀ publishAdditionalSites đều bị khóa cùng mã', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const DC_ID = await dcSiteUserFor(sql, env.SITE_IDS[0]);
    if (!DC_ID) return t.skip('Chưa seed DC Site cho site này');
    const docId = `TEST-LOCK-${Date.now()}`;
    created.push(docId);

    // Scope group để publishAdditionalSites có site ứng viên khác trong phạm vi.
    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    const receipts = await listReceiptsForVersion(sql as never, versionId);
    const mine = receipts.find((r) => r.site_id === env.SITE_IDS[0])!;
    await acceptReceipt(sql as never, { receiptId: mine.receipt_id, userId: DC_ID });

    // editVersionMetadata -> issue.locked_accepted.
    await assert.rejects(
      editVersionMetadata(sql as never, {
        versionId, userId: env.AUTHOR_ID, patch: { title: 'Sửa sau khi chấp nhận' },
      }),
      /phiên bản mới/,
    );

    // publishAdditionalSites -> cùng khóa, không phát hành lại metadata cũ.
    const otherSites = env.SITE_IDS.length > 1 ? [env.SITE_IDS[1]] : [env.SITE_IDS[0]];
    await assert.rejects(
      publishAdditionalSites(sql as never, {
        versionId, userId: env.AUTHOR_ID, siteIds: otherSites,
      }),
      /phiên bản mới/,
    );
  });
});
