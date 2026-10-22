/**
 * test/domain/catalog-origin.integration.test.ts — kiểm thử TÍCH HỢP (CHẠM DB)
 * cho Task 5.2 của spec catalog-excel-export (Yêu cầu 1.6).
 *
 * Mục tiêu: sau khi thêm `d.origin` vào câu SELECT của `listVisibleDocuments`,
 * hàng trả về phải mang đúng trường `origin` của tài liệu ('noi_bo' | 'ngoai_bo').
 *
 * Theo DCS-8: ràng buộc/phạm vi của DCS được ép ở tầng PostgreSQL thật, nên
 * bộ này BẮT BUỘC chạy trên Postgres. Harness giống test/constraints.test.ts:
 * DROP + migrate một CSDL kiểm thử sạch (DATABASE_URL_TEST, tên chứa "test")
 * rồi seed tối thiểu dữ liệu nền cần cho một hàng danh mục.
 *
 * Tài liệu được seed do CHÍNH người dùng nộp (v.registrant_user_id = userId),
 * nên nằm trong Visible_Scope bất kể phân quyền phòng ban — cô lập đúng điều
 * đang kiểm (origin trong kết quả) khỏi logic phạm vi.
 *
 * Khi KHÔNG có Postgres (thiếu DATABASE_URL_TEST, hoặc không kết nối được),
 * toàn bộ suite TỰ SKIP gọn — KHÔNG làm vỡ `npm run test:unit` ở máy không-DB.
 * Đây là tình huống DCS-8 mong đợi khi chạy cục bộ không có Postgres.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';

import { listVisibleDocuments } from '../../src/domain/catalog.js';

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

describe('listVisibleDocuments trả về origin (tích hợp DB — Task 5.2)', () => {
  let sql: Sql | null = null;
  let dbOk = false;

  const BU = randomUUID(), SITE = randomUUID(), DEPT = randomUUID();
  const USER = randomUUID();

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

    // CSDL sạch: DROP + migrate đầy đủ (giống constraints.test.ts).
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await applyMigrations(sql);

    // Dữ liệu nền tối thiểu: cây tổ chức + người nộp.
    await sql`INSERT INTO org_bu (bu_id, bu_code, name) VALUES (${BU}, 'MEAT', 'MeatLife')`;
    await sql`INSERT INTO org_site (site_id, site_code, name) VALUES (${SITE}, 'MML', 'MML')`;
    await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id)
              VALUES (${DEPT}, 'QA', 'QA In-process', ${SITE})`;
    await sql`INSERT INTO app_user_ref (user_id) VALUES (${USER})`;
  });

  after(async () => {
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  });

  /** Seed một tài liệu + phiên bản do USER nộp, với origin cho trước. */
  async function seedDoc(docId: string, origin: 'noi_bo' | 'ngoai_bo'): Promise<void> {
    await sql!`
      INSERT INTO documents (doc_id, doc_type, origin, scope_level, scope_dept_id)
      VALUES (${docId}, ${origin === 'noi_bo' ? 'SOP' : 'External'}, ${origin}, 'dept', ${DEPT})`;
    await sql!`
      INSERT INTO document_versions
        (version_id, doc_id, version_no, title, issued_date, approver_name,
         effective_date, review_cycle_months, source_channel, file_path, file_hash,
         status, registrant_user_id, owner_department_id)
      VALUES (${randomUUID()}, ${docId}, '1.0', ${'Tài liệu ' + origin},
              '2026-01-01', 'Người phê duyệt', '2026-02-01', 12, 'thu_cong',
              ${'/files/' + docId + '.pdf'}, ${docId + '-hash'}, 'cho_xac_nhan',
              ${USER}, ${DEPT})`;
  }

  test('hàng trả về mang đúng origin của tài liệu đã seed', async (t) => {
    if (!dbOk || !sql) return t.skip('Không có Postgres chạy (DCS-8) — bỏ qua test tích hợp');
    const docId = `TEST-ORIGIN-${randomUUID().slice(0, 8)}`;
    await seedDoc(docId, 'ngoai_bo');

    const rows = await listVisibleDocuments(sql as never, USER);
    const row = rows.find((r) => r.doc_id === docId);

    assert.ok(row, 'phải tìm thấy tài liệu vừa seed trong danh mục của người nộp');
    assert.equal(row!.origin, 'ngoai_bo', 'trường origin phải đúng giá trị đã seed');
  });

  test('phân biệt được noi_bo và ngoai_bo trên nhiều hàng', async (t) => {
    if (!dbOk || !sql) return t.skip('Không có Postgres chạy (DCS-8) — bỏ qua test tích hợp');
    const docInternal = `TEST-ORIGIN-IN-${randomUUID().slice(0, 8)}`;
    const docExternal = `TEST-ORIGIN-EX-${randomUUID().slice(0, 8)}`;
    await seedDoc(docInternal, 'noi_bo');
    await seedDoc(docExternal, 'ngoai_bo');

    const rows = await listVisibleDocuments(sql as never, USER);
    const inRow = rows.find((r) => r.doc_id === docInternal);
    const exRow = rows.find((r) => r.doc_id === docExternal);

    assert.ok(inRow && exRow, 'phải tìm thấy cả hai tài liệu đã seed');
    assert.equal(inRow!.origin, 'noi_bo');
    assert.equal(exRow!.origin, 'ngoai_bo');
  });
});
