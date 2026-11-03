/**
 * test/domain/edit-metadata-guards.integration.test.ts — ĐIỂM 10 (CHẠM DB).
 *
 * Sửa metadata (editVersionMetadata) khi chưa site nào chấp nhận:
 *  - expiry_date được GIỮ khi không nhập lại (expiryDate === undefined);
 *  - chỉ XÓA khi gửi sentinel rỗng ('' -> NULL);
 *  - giá trị mới thì ghi đè;
 *  - chặn đặt ngày hiệu lực về QUÁ KHỨ (edit.effective_past).
 *
 * Tự SKIP khi không có Postgres.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import { editVersionMetadata } from '../../src/domain/receipt.js';
import {
  resolveDbUrl, connectLifecycle, cleanupDoc, versionInput, shiftDays, type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('Điểm 10 — sửa metadata giữ hết hạn & chặn hiệu lực quá khứ (tích hợp DB)', () => {
  let env: LifecycleEnv;
  const created: string[] = [];

  before(async () => { env = await connectLifecycle(dbUrl); });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) await cleanupDoc(env.sql, d);
    await env.sql.end();
  });

  async function newVersion(docId: string): Promise<string> {
    const sql = env.sql!;
    created.push(docId);
    return submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID, { expiryDate: shiftDays(365) }) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
  }

  test('expiry GIỮ khi không nhập lại (undefined)', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const versionId = await newVersion(`TEST-EXPKEEP-${Date.now()}`);
    const expiry = shiftDays(365);

    await editVersionMetadata(sql as never, {
      versionId, userId: env.AUTHOR_ID, patch: { title: 'Đổi tiêu đề, giữ hết hạn' },
    });
    const v = await sql`SELECT title, expiry_date::text AS expiry_date FROM document_versions WHERE version_id = ${versionId}`;
    assert.equal(v[0].title, 'Đổi tiêu đề, giữ hết hạn');
    assert.equal(v[0].expiry_date, expiry, 'không nhập lại thì GIỮ ngày hết hạn');
  });

  test('expiry XÓA khi gửi sentinel rỗng (""), ghi đè khi có giá trị mới', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const versionId = await newVersion(`TEST-EXPCLR-${Date.now()}`);

    // Ghi đè bằng giá trị mới.
    const newExpiry = shiftDays(30);
    await editVersionMetadata(sql as never, {
      versionId, userId: env.AUTHOR_ID, patch: { expiryDate: newExpiry },
    });
    let v = await sql`SELECT expiry_date::text AS expiry_date FROM document_versions WHERE version_id = ${versionId}`;
    assert.equal(v[0].expiry_date, newExpiry, 'giá trị mới phải ghi đè');

    // Sentinel '' -> NULL.
    await editVersionMetadata(sql as never, {
      versionId, userId: env.AUTHOR_ID, patch: { expiryDate: '' },
    });
    v = await sql`SELECT expiry_date FROM document_versions WHERE version_id = ${versionId}`;
    assert.equal(v[0].expiry_date, null, 'sentinel rỗng phải xóa ngày hết hạn');
  });

  test('chặn đặt ngày hiệu lực về quá khứ (edit.effective_past)', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const versionId = await newVersion(`TEST-EFFPAST-${Date.now()}`);

    await assert.rejects(
      editVersionMetadata(sql as never, {
        versionId, userId: env.AUTHOR_ID, patch: { effectiveDate: shiftDays(-1) },
      }),
      /quá khứ/,
    );
  });
});
