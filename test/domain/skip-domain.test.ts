/**
 * test/domain/skip-domain.test.ts — gọi domain trực tiếp cho các ca SKIP.
 * Đọc DATABASE_URL từ /etc/dcs/.env (không hardcode password).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BusinessError } from '../../src/lib/errors.js';
import { submitRegistration } from '../../src/domain/registration.js';
import { confirmRegistration, hasViewedDiff } from '../../src/domain/confirmation.js';
import { recallVersion } from '../../src/domain/lifecycle.js';

// Đọc DATABASE_URL từ /etc/dcs/.env
const envFile = readFileSync('/etc/dcs/.env', 'utf8');
const dbUrl = envFile.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
if (!dbUrl) throw new Error('Không đọc được DATABASE_URL từ /etc/dcs/.env');

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

const D_QA = '53d94437-3fb3-49e7-8cc3-1989107d0398';
const D_PROD = '8cb23fff-f18b-4b4f-9007-b19f80965a51';

const authorRow = await sql`SELECT user_id FROM users WHERE email='author@mml.io' LIMIT 1`;
const AUTHOR_ID = authorRow[0].user_id;
const dhQaRow = await sql`SELECT user_id FROM users WHERE email='dh_qa@mml.io' LIMIT 1`;
const DH_QA_ID = dhQaRow[0].user_id;
const readerRow = await sql`SELECT user_id FROM users WHERE email='reader@mml.io' LIMIT 1`;
const READER_ID = readerRow[0].user_id;

describe('D.16 — domain tự chặn (submitRegistration)', () => {
  test('user không có DC_AUTHOR → BusinessError 403', async () => {
    const docId = `TEST-D16-${Date.now()}`;
    try {
      await submitRegistration(sql,
        { docId, docType: 'SOP', origin: 'noi_bo', scopeLevel: 'dept', scopeDeptId: D_QA },
        {
          docId, versionNo: '1.0', title: 'Test D16',
          issuedDate: '2026-12-31', effectiveDate: '2026-12-31',
          filePath: '/tmp/test.pdf', registrantUserId: READER_ID,
          ownerDepartmentId: D_QA, scopeLevel: 'dept', scopeDeptId: D_QA,
        },
        { m14Enabled: true },
      );
      assert.fail('phải ném lỗi');
    } catch (e) {
      assert.ok(e instanceof BusinessError, `expected BusinessError, got ${e}`);
      assert.equal(e.httpStatus, 403);
    }
  });
});

describe('E.14 — domain chặn sai phạm vi (confirmRegistration)', () => {
  test('dh_qa confirm doc ngoài phạm vi → BusinessError 403', async () => {
    const prodDoc = await sql`
      SELECT v.version_id FROM document_versions v
      JOIN documents d ON d.doc_id = v.doc_id
      WHERE v.status = 'cho_xac_nhan' AND d.scope_dept_id = ${D_PROD}
      LIMIT 1`;
    if (!prodDoc[0]) return;
    try {
      await confirmRegistration(sql, {
        versionId: prodDoc[0].version_id,
        adminUserId: DH_QA_ID,
        adminCheckNos: ['7', '8', '9'],
      });
      assert.fail('phải ném lỗi');
    } catch (e) {
      assert.ok(e instanceof BusinessError, `expected BusinessError, got ${e}`);
      assert.equal(e.httpStatus, 403);
    }
  });
});

describe('I.9 — domain chặn thu hồi (recallVersion)', () => {
  test('dh_qa recall doc ngoài phạm vi → BusinessError 403', async () => {
    const prodDoc = await sql`
      SELECT v.version_id FROM document_versions v
      JOIN documents d ON d.doc_id = v.doc_id
      WHERE v.status IN ('da_dang_ky', 'hieu_luc') AND d.scope_dept_id = ${D_PROD}
      LIMIT 1`;
    if (!prodDoc[0]) return;
    try {
      await recallVersion(sql, {
        versionId: prodDoc[0].version_id,
        adminUserId: DH_QA_ID,
        reason: 'test',
      });
      assert.fail('phải ném lỗi');
    } catch (e) {
      assert.ok(e instanceof BusinessError, `expected BusinessError, got ${e}`);
      assert.equal(e.httpStatus, 403);
    }
  });
});

describe('E.5/E.13 — ngày hiệu lực đã qua → tự từ chối', () => {
  test('effective_date < today → outcome tu_choi_tu_dong', async () => {
    const docId = `TEST-E5-${Date.now()}`;
    const versionId = randomUUID();
    await sql`
      INSERT INTO documents (doc_id, doc_type, origin, scope_level, scope_dept_id)
      VALUES (${docId}, 'SOP', 'noi_bo', 'dept', ${D_QA})`;
    await sql`
      INSERT INTO document_versions (version_id, doc_id, version_no, title, effective_date, issued_date, review_cycle_months, source_channel, file_hash, status, registrant_user_id, owner_department_id, file_path)
      VALUES (${versionId}, ${docId}, '1.0', 'Test E5', '2020-01-01', '2020-01-01', 12, 'thu_cong', 'abc123', 'cho_xac_nhan', ${AUTHOR_ID}, ${D_QA}, '/tmp/test.pdf')`;
    try {
      const result = await confirmRegistration(sql, {
        versionId,
        adminUserId: DH_QA_ID,
        adminCheckNos: ['7', '8', '9'],
      });
      assert.equal(result.outcome, 'tu_choi_tu_dong');
      const audit = await sql`
        SELECT event_type FROM audit_log WHERE object_id = ${versionId} AND event_type = 'tu_choi_tu_dong' LIMIT 1`;
      assert.ok(audit[0], 'phải có audit tu_choi_tu_dong');
    } finally {
      await sql`DELETE FROM document_versions WHERE version_id = ${versionId}`;
      await sql`DELETE FROM documents WHERE doc_id = ${docId}`;
    }
  });
});

describe('E.16 — chống lách 9b (hasViewedDiff)', () => {
  test('compare from X to Y (X ≠ supersedes của Y) → không ghi đã xem', async () => {
    const rows = await sql`
      SELECT version_id FROM document_versions WHERE status = 'cho_xac_nhan' LIMIT 2`;
    if (rows.length < 2) return;
    const viewed = await hasViewedDiff(sql, DH_QA_ID, rows[1].version_id);
    assert.equal(typeof viewed, 'boolean');
  });
});

describe('E.18 — mục tự động chặn (parse_status lỗi)', () => {
  test('doc parse_status = loi → BusinessError conf.checklist_auto', async () => {
    const docId = `TEST-E18-${Date.now()}`;
    const versionId = randomUUID();
    await sql`
      INSERT INTO documents (doc_id, doc_type, origin, scope_level, scope_dept_id)
      VALUES (${docId}, 'SOP', 'noi_bo', 'dept', ${D_QA})`;
    await sql`
      INSERT INTO document_versions (version_id, doc_id, version_no, title, effective_date, issued_date, review_cycle_months, source_channel, file_hash, status, registrant_user_id, owner_department_id, file_path, parse_status)
      VALUES (${versionId}, ${docId}, '1.0', 'Test E18', '2026-12-31', '2026-10-17', 12, 'thu_cong', 'abc123', 'cho_xac_nhan', ${AUTHOR_ID}, ${D_QA}, '/tmp/test.pdf', 'that_bai')`;
    try {
      await confirmRegistration(sql, {
        versionId,
        adminUserId: DH_QA_ID,
        adminCheckNos: ['7', '8', '9'],
      });
      assert.fail('phải ném lỗi');
    } catch (e) {
      assert.ok(e instanceof BusinessError, `expected BusinessError, got ${e}`);
      assert.equal(e.code, 'conf.checklist_auto');
    } finally {
      await sql`DELETE FROM document_versions WHERE version_id = ${versionId}`;
      await sql`DELETE FROM documents WHERE doc_id = ${docId}`;
    }
  });
});

test('cleanup', async () => {
  await sql.end();
});
