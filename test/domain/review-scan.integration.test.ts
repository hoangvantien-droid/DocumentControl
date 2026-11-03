/**
 * test/domain/review-scan.integration.test.ts — ĐIỂM 2 + ĐIỂM 9 (CHẠM DB).
 *
 * Điểm 2: fn_generate_due_reviews (migration 026) quét CẢ tài liệu 'da_ban_hanh'
 *   (mô hình mới), không chỉ 'hieu_luc' — nếu không, nút "Quá hạn xem xét" và
 *   theo dõi rà soát của DC Site luôn rỗng.
 * Điểm 9: fn_activate_due_versions KHÔNG còn tự chuyển tài liệu quá ngày hết hạn
 *   sang 'het_hieu_luc' — hết hạn chỉ cảnh báo, không tự đổi trạng thái.
 *
 * Cả hai kiểm hàm SQL -> DB phải đã áp dụng migration 026. Tự SKIP khi không có
 * Postgres.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import {
  resolveDbUrl, connectLifecycle, cleanupDoc, versionInput, shiftDays, type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('Điểm 2 + 9 — quét rà soát & bỏ tự-hết-hiệu-lực (tích hợp DB)', () => {
  let env: LifecycleEnv;
  const created: string[] = [];

  before(async () => { env = await connectLifecycle(dbUrl); });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) {
      await env.sql`DELETE FROM periodic_reviews WHERE doc_id = ${d}`;
      await cleanupDoc(env.sql, d);
    }
    await env.sql.end();
  });

  test('điểm 2: fn_generate_due_reviews sinh rà soát cho tài liệu da_ban_hanh quá hạn', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const docId = `TEST-REV-${Date.now()}`;
    created.push(docId);

    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    // Ép ngày rà soát về quá khứ (trigger đặt theo chu kỳ ở tương lai).
    await sql`UPDATE document_versions SET next_review_date = ${shiftDays(-1)} WHERE version_id = ${versionId}`;

    const before = await sql`SELECT count(*)::int AS n FROM periodic_reviews WHERE version_id = ${versionId}`;
    assert.equal(before[0].n, 0);

    await sql`SELECT fn_generate_due_reviews()`;

    const after = await sql`SELECT status FROM periodic_reviews WHERE version_id = ${versionId}`;
    assert.equal(after.length, 1, 'tài liệu da_ban_hanh quá hạn phải sinh một bản ghi rà soát');
  });

  test('điểm 9: fn_activate_due_versions KHÔNG tự chuyển bản quá hết hạn sang het_hieu_luc', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const docId = `TEST-EXP-${Date.now()}`;
    created.push(docId);

    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    // Đẩy hiệu lực + hết hạn về quá khứ, GIỮ expiry > effective (chk_expiry_after_effective).
    // Doc giờ ĐÃ quá ngày hết hạn — logic cũ sẽ tự chuyển sang het_hieu_luc.
    await sql`UPDATE document_versions
                 SET effective_date = ${shiftDays(-10)}, expiry_date = ${shiftDays(-1)}
               WHERE version_id = ${versionId}`;

    await sql`SELECT fn_activate_due_versions()`;

    const v = await sql`SELECT status FROM document_versions WHERE version_id = ${versionId}`;
    assert.equal(v[0].status, 'da_ban_hanh', 'hết hạn chỉ cảnh báo — không tự đổi trạng thái');
  });
});
