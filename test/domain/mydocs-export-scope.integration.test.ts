/**
 * test/domain/mydocs-export-scope.integration.test.ts — kiểm thử TÍCH HỢP (CHẠM DB)
 * cho Task 8.4 của spec catalog-excel-export (Yêu cầu 2.2, 2.8).
 *
 * Mục tiêu: `assembleMyDocuments(sql, userId)` — nguồn dữ liệu duy nhất cho cả
 * trang `/my-documents` lẫn route export `/my-documents/export.xlsx` — phải chỉ
 * trả về các tài liệu do CHÍNH người dùng nộp (`v.registrant_user_id = userId`),
 * không bao giờ trả tài liệu của người nộp khác. Đây là lớp thực thi phạm vi
 * của MyDocs_Export (Yêu cầu 2.8) ngay tại tầng dữ liệu, độc lập với giao diện.
 *
 * Theo DCS-8: phạm vi/ràng buộc của DCS được ép ở tầng PostgreSQL thật, nên bộ
 * này BẮT BUỘC chạy trên Postgres. Harness giống Task 5.2
 * (test/domain/catalog-origin.integration.test.ts): DROP SCHEMA + migrate đầy đủ
 * một CSDL kiểm thử sạch (DATABASE_URL_TEST, tên phải chứa "test") rồi seed tối
 * thiểu cây tổ chức + hai người nộp A/B + hai phiên bản tài liệu (một của A, một
 * của B).
 *
 * Khi KHÔNG có Postgres (thiếu DATABASE_URL_TEST, hoặc không kết nối được),
 * toàn bộ suite TỰ SKIP gọn — KHÔNG làm vỡ `npm run test:unit` ở máy không-DB.
 * Đây là tình huống DCS-8 mong đợi khi chạy cục bộ không có Postgres.
 *
 * Nhập `assembleMyDocuments` từ module route thật để kiểm đúng đường đi mã sản
 * phẩm (module này kéo theo exceljs — nạp được nhờ overrides trong package.json).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';

import { assembleMyDocuments } from '../../src/routes/documents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'db', 'migrations');

const url = process.env.DATABASE_URL_TEST ?? '';
if (url && !/test/i.test(url)) {
  throw new Error(
    'DATABASE_URL_TEST phải trỏ vào cơ sở dữ liệu có chữ "test" trong tên — chặn nhầm vào dữ liệu thật',
  );
}

/** Chạy toàn bộ migration theo thứ tự số tăng dần (giống `npm run migrate`). */
async function applyMigrations(sql: Sql): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const na = Number(a.match(/^(\d+)/)?.[1] ?? '0');
      const nb = Number(b.match(/^(\d+)/)?.[1] ?? '0');
      return na - nb || a.localeCompare(b);
    });
  for (const f of files) {
    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
}

describe('assembleMyDocuments giới hạn theo registrant_user_id (tích hợp DB — Task 8.4)', () => {
  let sql: Sql | null = null;
  let dbOk = false;

  const BU = randomUUID(), SITE = randomUUID(), DEPT = randomUUID();
  const USER_A = randomUUID(), USER_B = randomUUID();
  const DOC_A = `TEST-MYDOCS-A-${randomUUID().slice(0, 8)}`;
  const DOC_B = `TEST-MYDOCS-B-${randomUUID().slice(0, 8)}`;

  before(async () => {
    if (!url) return; // thiếu DATABASE_URL_TEST -> skip
    try {
      const probe = postgres(url, { max: 2, onnotice: () => {}, connect_timeout: 3 });
      await probe`SELECT 1`;
      sql = probe;
      dbOk = true;
    } catch {
      dbOk = false; // không kết nối được Postgres -> skip
      return;
    }

    // CSDL sạch: DROP + migrate đầy đủ (giống Task 5.2 harness).
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await applyMigrations(sql);

    // Dữ liệu nền tối thiểu: cây tổ chức + hai người nộp A/B.
    await sql`INSERT INTO org_bu (bu_id, bu_code, name) VALUES (${BU}, 'MEAT', 'MeatLife')`;
    await sql`INSERT INTO org_site (site_id, site_code, name) VALUES (${SITE}, 'MML', 'MML')`;
    await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id)
              VALUES (${DEPT}, 'QA', 'QA In-process', ${SITE})`;
    await sql`INSERT INTO app_user_ref (user_id) VALUES (${USER_A})`;
    await sql`INSERT INTO app_user_ref (user_id) VALUES (${USER_B})`;

    // Tài liệu của A và tài liệu của B (mỗi người một phiên bản do chính mình nộp).
    await seedDocFor(DOC_A, USER_A);
    await seedDocFor(DOC_B, USER_B);
  });

  after(async () => {
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  });

  /** Seed một tài liệu + phiên bản với registrant_user_id cho trước. */
  async function seedDocFor(docId: string, userId: string): Promise<void> {
    await sql!`
      INSERT INTO documents (doc_id, doc_type, origin, scope_level, scope_dept_id)
      VALUES (${docId}, 'SOP', 'noi_bo', 'dept', ${DEPT})`;
    await sql!`
      INSERT INTO document_versions
        (version_id, doc_id, version_no, title, issued_date, approver_name,
         effective_date, review_cycle_months, source_channel, file_path, file_hash,
         status, registrant_user_id, owner_department_id)
      VALUES (${randomUUID()}, ${docId}, '1.0', ${'Tài liệu ' + docId},
              '2026-01-01', 'Người phê duyệt', '2026-02-01', 12, 'thu_cong',
              ${'/files/' + docId + '.pdf'}, ${docId + '-hash'}, 'cho_xac_nhan',
              ${userId}, ${DEPT})`;
  }

  test('A chỉ thấy tài liệu của A, không thấy tài liệu của B', async (t) => {
    if (!dbOk || !sql) return t.skip('Không có Postgres chạy (DCS-8) — bỏ qua test tích hợp');

    const docsA = await assembleMyDocuments(sql as never, USER_A);
    const ids = docsA.map((d) => d.doc_id);

    assert.ok(ids.includes(DOC_A), 'export của A phải gồm tài liệu do A nộp');
    assert.ok(!ids.includes(DOC_B), 'export của A KHÔNG được chứa tài liệu do B nộp');
  });

  test('B chỉ thấy tài liệu của B, không thấy tài liệu của A (chiều ngược)', async (t) => {
    if (!dbOk || !sql) return t.skip('Không có Postgres chạy (DCS-8) — bỏ qua test tích hợp');

    const docsB = await assembleMyDocuments(sql as never, USER_B);
    const ids = docsB.map((d) => d.doc_id);

    assert.ok(ids.includes(DOC_B), 'export của B phải gồm tài liệu do B nộp');
    assert.ok(!ids.includes(DOC_A), 'export của B KHÔNG được chứa tài liệu do A nộp');
  });
});
