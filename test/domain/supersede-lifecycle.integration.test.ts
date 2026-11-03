/**
 * test/domain/supersede-lifecycle.integration.test.ts — ĐIỂM 1 (CHẠM DB).
 *
 * Phiên bản thay thế theo mô hình mới ('da_ban_hanh'):
 *  - đăng ký bản thay thế cho một bản gốc 'da_ban_hanh' được chấp nhận;
 *  - bản gốc tự chuyển sang 'het_hieu_luc', giữ liên kết supersedes_version_id;
 *  - ràng buộc uq_one_current_per_doc: không thể có 2 bản 'da_ban_hanh' / doc_id;
 *  - kế thừa xác nhận đọc khi thay đổi 'nho' (sao chép bản ghi sang bản mới).
 *
 * Tự SKIP khi không có Postgres (giống receipt-model.integration.test.ts).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import {
  resolveDbUrl, connectLifecycle, cleanupDoc, versionInput, type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('Điểm 1 — supersede mô hình mới (tích hợp DB)', () => {
  let env: LifecycleEnv;
  const created: string[] = [];

  before(async () => { env = await connectLifecycle(dbUrl); });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) await cleanupDoc(env.sql, d);
    await env.sql.end();
  });

  test('bản thay thế cho bản gốc da_ban_hanh: gốc -> het_hieu_luc + giữ liên kết', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const docId = `TEST-SUP-${Date.now()}`;
    created.push(docId);

    // Bản gốc 1.0 (da_ban_hanh).
    const origId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );

    // Bản thay thế 2.0 trỏ bản gốc, thay đổi nhỏ.
    const newId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID, {
        versionNo: '2.0', fileHash: 'hash-sup-2',
        supersedesVersionId: origId, changeSignificance: 'nho',
      }) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );

    const orig = await sql`SELECT status FROM document_versions WHERE version_id = ${origId}`;
    const neu = await sql`SELECT status, supersedes_version_id FROM document_versions WHERE version_id = ${newId}`;
    assert.equal(orig[0].status, 'het_hieu_luc', 'bản gốc phải Hết hiệu lực');
    assert.equal(neu[0].status, 'da_ban_hanh', 'bản mới là Đã ban hành');
    assert.equal(neu[0].supersedes_version_id, origId, 'giữ liên kết phiên bản');
  });

  test('uq_one_current_per_doc: 2 bản da_ban_hanh cùng doc_id bị chặn ở DB', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const docId = `TEST-SUP2-${Date.now()}`;
    created.push(docId);

    const v1 = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    // Cố ép bản thứ hai cùng doc_id sang da_ban_hanh TRỰC TIẾP -> vi phạm index.
    const v2 = (await sql`
      INSERT INTO document_versions (doc_id, version_no, title, issued_date, effective_date,
        review_cycle_months, source_channel, file_path, file_hash, status, registrant_user_id)
      VALUES (${docId}, '2.0', 'dup current', CURRENT_DATE, CURRENT_DATE, 12, 'thu_cong',
              '/tmp/x.pdf', 'hash-dup', 'cho_hoan_thien', ${env.AUTHOR_ID})
      RETURNING version_id`)[0];
    void v1;
    await assert.rejects(
      sql`UPDATE document_versions SET status = 'da_ban_hanh' WHERE version_id = ${v2.version_id}`,
      /uq_one_current_per_doc/,
    );
  });

  test('thay đổi nhỏ: kế thừa (sao chép) read_acknowledgements sang bản mới', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const docId = `TEST-SUP3-${Date.now()}`;
    created.push(docId);

    const origId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    // Giả lập một xác nhận đọc trên bản gốc.
    await sql`
      INSERT INTO read_acknowledgements (version_id, user_id, acknowledged_at)
      VALUES (${origId}, ${env.AUTHOR_ID}, now())
      ON CONFLICT (version_id, user_id) DO NOTHING`;

    const newId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID, {
        versionNo: '2.0', fileHash: 'hash-sup3-2',
        supersedesVersionId: origId, changeSignificance: 'nho',
      }) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    const copied = await sql`
      SELECT user_id, inherited_from_version_id FROM read_acknowledgements
       WHERE version_id = ${newId} AND user_id = ${env.AUTHOR_ID}`;
    assert.equal(copied.length, 1, 'xác nhận đọc phải được kế thừa sang bản mới');
    assert.equal(copied[0].inherited_from_version_id, origId);
  });

  test('thay đổi lớn: KHÔNG kế thừa xác nhận đọc (đặt lại)', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const docId = `TEST-SUP4-${Date.now()}`;
    created.push(docId);

    const origId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    await sql`
      INSERT INTO read_acknowledgements (version_id, user_id, acknowledged_at)
      VALUES (${origId}, ${env.AUTHOR_ID}, now())
      ON CONFLICT (version_id, user_id) DO NOTHING`;

    const newId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID, {
        versionNo: '2.0', fileHash: 'hash-sup4-2',
        supersedesVersionId: origId, changeSignificance: 'lon',
        changeSummary: 'Đổi quy trình đáng kể',
      }) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    const copied = await sql`
      SELECT 1 FROM read_acknowledgements WHERE version_id = ${newId}`;
    assert.equal(copied.length, 0, 'thay đổi lớn: mọi người phải xác nhận lại');
  });
});
