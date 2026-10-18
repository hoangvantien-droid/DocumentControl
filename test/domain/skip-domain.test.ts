/**
 * test/domain/skip-domain.test.ts — domain tự chặn (mô hình receipt mới).
 *
 * Mô hình cũ (confirmRegistration / recallVersion của dept head) đã gỡ; các ca
 * đó chuyển sang receipt-model.integration.test.ts. File này giữ ca quyền đăng
 * ký: user không có DC_AUTHOR -> BusinessError 403.
 *
 * Chạm DB: đọc DATABASE_URL linh hoạt, tự SKIP nếu không có Postgres.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import postgres from 'postgres';
import { BusinessError } from '../../src/lib/errors.js';
import { submitRegistration } from '../../src/domain/registration.js';

function resolveDbUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const p of ['/etc/dcs/.env', '/opt/dcs/.env', '.env']) {
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^DATABASE_URL=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}
const dbUrl = resolveDbUrl();

describe('Domain tự chặn (mô hình receipt)', () => {
  let sql: ReturnType<typeof postgres> | null = null;
  let dbOk = false;
  let READER_ID: string;
  let D_QA: string;

  before(async () => {
    if (!dbUrl) return;
    try {
      const probe = postgres(dbUrl, { max: 1, onnotice: () => {}, connect_timeout: 3 });
      await probe`SELECT 1`;
      sql = probe; dbOk = true;
      const r = await sql`SELECT user_id FROM users WHERE email='reader@mml.io' LIMIT 1`;
      READER_ID = r[0]?.user_id;
      const d = await sql`SELECT dept_id FROM org_department WHERE dept_code='QA' LIMIT 1`;
      D_QA = d[0]?.dept_id;
    } catch { dbOk = false; }
  });

  after(async () => { if (sql) await sql.end(); });

  test('D.16 — user không có DC_AUTHOR -> BusinessError 403', async (t) => {
    if (!dbOk) return t.skip('Không có Postgres chạy');
    if (!READER_ID || !D_QA) return t.skip('Seed chưa đủ');
    const docId = `TEST-D16-${Date.now()}`;
    try {
      await submitRegistration(sql as never,
        { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'dept', scopeDeptId: D_QA },
        {
          docId, versionNo: '1.0', title: 'Test D16',
          issuedDate: '2026-12-31', effectiveDate: '2026-12-31',
          reviewCycleMonths: 12, sourceChannel: 'thu_cong',
          filePath: '/tmp/test.pdf', fileHash: 'hash-d16',
          registrantUserId: READER_ID, ownerDepartmentId: D_QA,
        },
        { m14Enabled: false, siteIds: ['dummy'] },
      );
      assert.fail('phải ném lỗi');
    } catch (e) {
      assert.ok(e instanceof BusinessError, `expected BusinessError, got ${e}`);
      assert.equal((e as BusinessError).httpStatus, 403);
    }
  });
});
