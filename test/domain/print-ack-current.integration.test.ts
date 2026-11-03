/**
 * test/domain/print-ack-current.integration.test.ts — ĐIỂM 3 (CHẠM DB).
 *
 * In bản sao kiểm soát (registerPrint) chạy cho trạng thái ban hành MỚI
 * ('da_ban_hanh'), không chỉ 'hieu_luc' của mô hình cũ. registerPrint dùng
 * isCurrentlyEffective(v.status) nên bản 'da_ban_hanh' in được; bản đã thu hồi
 * thì bị chặn (print.not_effective).
 *
 * Tự SKIP khi không có Postgres.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistration } from '../../src/domain/registration.js';
import { recallByAuthor } from '../../src/domain/receipt.js';
import { registerPrint } from '../../src/domain/printing.js';
import {
  resolveDbUrl, connectLifecycle, cleanupDoc, versionInput, type LifecycleEnv,
} from './_lifecycle-db.js';

const dbUrl = resolveDbUrl();

describe('Điểm 3 — in bản kiểm soát cho da_ban_hanh (tích hợp DB)', () => {
  let env: LifecycleEnv;
  const created: string[] = [];

  before(async () => { env = await connectLifecycle(dbUrl); });
  after(async () => {
    if (!env?.sql) return;
    for (const d of created) {
      await env.sql`DELETE FROM printed_copies WHERE version_id IN (SELECT version_id FROM document_versions WHERE doc_id = ${d})`;
      await cleanupDoc(env.sql, d);
    }
    await env.sql.end();
  });

  test('bản da_ban_hanh in được (sinh verify_token + QR)', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const docId = `TEST-PRINT-${Date.now()}`;
    created.push(docId);

    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );

    const rec = await registerPrint(sql as never, {
      versionId, printedBy: env.AUTHOR_ID,
      basePath: '', publicUrl: 'http://localhost',
    });
    assert.ok(rec.verify_token, 'phải sinh verify_token');
    assert.equal(rec.doc_id, docId);
    assert.match(rec.qrSvg, /<svg/, 'phải dựng QR SVG');
  });

  test('bản đã thu hồi KHÔNG in được (print.not_effective)', async (t) => {
    if (!env.dbOk) return t.skip('Không có Postgres chạy');
    if (!env.AUTHOR_ID || env.SITE_IDS.length < 1) return t.skip('Seed chưa đủ');
    const sql = env.sql!;
    const docId = `TEST-PRINT2-${Date.now()}`;
    created.push(docId);

    const versionId = await submitRegistration(
      sql as never,
      { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'group' },
      versionInput(docId, env.AUTHOR_ID) as never,
      { m14Enabled: false, siteIds: [env.SITE_IDS[0]] },
    );
    await recallByAuthor(sql as never, { versionId, userId: env.AUTHOR_ID, reason: 'Thu hồi để kiểm thử in' });

    await assert.rejects(
      registerPrint(sql as never, {
        versionId, printedBy: env.AUTHOR_ID, basePath: '', publicUrl: 'http://localhost',
      }),
      /hiệu lực/,
    );
  });
});
