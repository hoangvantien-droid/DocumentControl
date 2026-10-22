/**
 * test/domain/catalog-export-scope.integration.test.ts — kiểm thử TÍCH HỢP (CHẠM DB)
 * cho Task 7.4 của spec catalog-excel-export (Yêu cầu 1.8, 4.2, 4.4).
 *
 * Catalog_Export và trang /documents DÙNG CHUNG đúng một đường dữ liệu:
 *   parseCatalogFilters(query) -> listVisibleDocuments(sql, userId, filters, isReadOnly)
 * Vì vậy khẳng định ở TẦNG DỮ LIỆU trên listVisibleDocuments là cách gọn nhất
 * để chứng minh cả hai tính chất mà export phải thỏa:
 *
 *   1) Phạm vi (Yêu cầu 1.8 / 4.4): export KHÔNG bao giờ chứa tài liệu nằm ngoài
 *      Visible_Scope của người yêu cầu — cùng đúng bộ lọc mà listVisibleDocuments
 *      đã ép TRƯỚC trong truy vấn (DCS-2 §7.1).
 *   2) Applied_Filters (Yêu cầu 4.2): với cùng một querystring, tập dữ liệu
 *      /documents/export.xlsx BẰNG tập /documents — vì cả hai gọi cùng hàm với
 *      cùng filters, nên áp một bộ lọc (ví dụ doc_type) trả về đúng tập con
 *      khớp trong phạm vi, không thừa không thiếu.
 *
 * Theo DCS-8: ràng buộc/phạm vi của DCS được ép ở tầng PostgreSQL thật, nên
 * bộ này BẮT BUỘC chạy trên Postgres. Harness giống
 * test/domain/catalog-origin.integration.test.ts (Task 5.2): DROP + migrate một
 * CSDL kiểm thử sạch (DATABASE_URL_TEST, tên chứa "test") rồi seed tối thiểu
 * cây tổ chức + người dùng + gán bộ phận.
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

describe('Catalog_Export phạm vi + Applied_Filters (tích hợp DB — Task 7.4)', () => {
  let sql: Sql | null = null;
  let dbOk = false;

  // Cây tổ chức: một BU, một site, HAI phòng ban. A thuộc DEPT_A, KHÔNG thuộc DEPT_B.
  const BU = randomUUID(), SITE = randomUUID();
  const DEPT_A = randomUUID(), DEPT_B = randomUUID();
  // Hai người dùng: A là người yêu cầu export; B là người nộp các tài liệu
  // (để tài liệu trong phạm vi A đến từ phạm vi phòng ban, KHÔNG phải nhánh
  // "tài liệu mình nộp" — cô lập đúng điều đang kiểm là Visible_Scope).
  const USER_A = randomUUID(), USER_B = randomUUID();

  // Số hiệu tài liệu được seed (cố định theo lần chạy để tra cứu lại).
  const DOC_IN_SOP = `T74-IN-SOP-${randomUUID().slice(0, 8)}`;   // trong scope DEPT_A, loại SOP
  const DOC_IN_WI = `T74-IN-WI-${randomUUID().slice(0, 8)}`;     // trong scope DEPT_A, loại WI
  const DOC_OUT = `T74-OUT-${randomUUID().slice(0, 8)}`;         // scope DEPT_B — NGOÀI phạm vi của A

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

    // CSDL sạch: DROP + migrate đầy đủ (giống catalog-origin.integration.test.ts).
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await applyMigrations(sql);

    // Dữ liệu nền tối thiểu. Sau migration 005: bảng là users/user_departments,
    // org_site không còn NOT NULL ở cột BU (đổi tên thành legacy_primary_bu_id),
    // quan hệ site↔bu nằm ở org_site_bu.
    await sql`INSERT INTO org_bu (bu_id, bu_code, name) VALUES (${BU}, 'MEAT', 'MeatLife')`;
    await sql`INSERT INTO org_site (site_id, site_code, name) VALUES (${SITE}, 'MML', 'MML')`;
    await sql`INSERT INTO org_site_bu (site_id, bu_id) VALUES (${SITE}, ${BU})`;
    await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id)
              VALUES (${DEPT_A}, 'QA-A', 'QA In-process', ${SITE}),
                     (${DEPT_B}, 'QA-B', 'QA Outgoing', ${SITE})`;
    await sql`INSERT INTO users (user_id) VALUES (${USER_A}), (${USER_B})`;
    // A chỉ thuộc DEPT_A. (B không cần gán phòng ban: B chỉ là người nộp.)
    await sql`INSERT INTO user_departments (user_id, dept_id) VALUES (${USER_A}, ${DEPT_A})`;

    // Seed ba tài liệu. Tất cả do USER_B nộp để KHÔNG rơi vào nhánh
    // "tài liệu mình nộp" của A — phép thử đo đúng phạm vi phòng ban.
    await seedDeptDoc(DOC_IN_SOP, 'SOP', DEPT_A);
    await seedDeptDoc(DOC_IN_WI, 'WI', DEPT_A);
    await seedDeptDoc(DOC_OUT, 'SOP', DEPT_B);
  });

  after(async () => {
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  });

  /**
   * Seed một tài liệu NỘI BỘ phạm vi cấp phòng ban + một phiên bản do USER_B nộp.
   * Trạng thái 'cho_xac_nhan' để tránh trigger yêu cầu nhãn liên kết (chỉ bắt
   * buộc khi chuyển sang da_dang_ky/hieu_luc). approval_reference đặt sẵn vì
   * tài liệu nội bộ bắt buộc có theo trigger fn_validate_version.
   */
  async function seedDeptDoc(docId: string, docType: string, deptId: string): Promise<void> {
    await sql!`
      INSERT INTO documents (doc_id, doc_type, origin, scope_level, scope_dept_id)
      VALUES (${docId}, ${docType}, 'noi_bo', 'dept', ${deptId})`;
    await sql!`
      INSERT INTO document_versions
        (version_id, doc_id, version_no, title, issued_date, approver_name,
         approval_reference, effective_date, review_cycle_months, source_channel,
         file_path, file_hash, status, registrant_user_id, owner_department_id)
      VALUES (${randomUUID()}, ${docId}, '1.0', ${'Tài liệu ' + docId},
              '2026-01-01', 'Người phê duyệt', ${'HS-' + docId}, '2026-02-01', 12,
              'thu_cong', ${'/files/' + docId + '.pdf'}, ${docId + '-hash'},
              'cho_xac_nhan', ${USER_B}, ${deptId})`;
  }

  test('export loại trừ tài liệu ngoài Visible_Scope của người yêu cầu (Yêu cầu 1.8/4.4)', async (t) => {
    if (!dbOk || !sql) return t.skip('Không có Postgres chạy (DCS-8) — bỏ qua test tích hợp');

    const rows = await listVisibleDocuments(sql as never, USER_A);
    const ids = new Set(rows.map((r) => r.doc_id));

    // Tài liệu trong phạm vi phòng ban của A phải có mặt trong tập export.
    assert.ok(ids.has(DOC_IN_SOP), 'tài liệu trong scope DEPT_A (SOP) phải nằm trong tập export');
    assert.ok(ids.has(DOC_IN_WI), 'tài liệu trong scope DEPT_A (WI) phải nằm trong tập export');
    // Tài liệu phạm vi DEPT_B — A KHÔNG thuộc — phải bị loại khỏi tập export.
    assert.ok(!ids.has(DOC_OUT), 'tài liệu ngoài phạm vi (scope DEPT_B) PHẢI bị loại khỏi export');
  });

  test('áp một bộ lọc doc_type trả về đúng tập con khớp trong phạm vi (Applied_Filters — Yêu cầu 4.2)', async (t) => {
    if (!dbOk || !sql) return t.skip('Không có Postgres chạy (DCS-8) — bỏ qua test tích hợp');

    // Cùng hàm + cùng filters mà export và /documents dùng chung. Lọc loại SOP:
    // chỉ DOC_IN_SOP đạt (DOC_OUT cũng là SOP nhưng ngoài phạm vi nên vẫn bị loại).
    const sopRows = await listVisibleDocuments(sql as never, USER_A, { doc_type: 'SOP' });
    const sopIds = new Set(sopRows.map((r) => r.doc_id));

    assert.ok(sopIds.has(DOC_IN_SOP), 'tài liệu SOP trong phạm vi phải xuất hiện khi lọc doc_type=SOP');
    assert.ok(!sopIds.has(DOC_IN_WI), 'tài liệu WI KHÔNG được xuất hiện khi lọc doc_type=SOP');
    assert.ok(!sopIds.has(DOC_OUT), 'tài liệu ngoài phạm vi vẫn bị loại dù khớp doc_type=SOP');
    for (const r of sopRows) {
      assert.equal(r.doc_type, 'SOP', 'mọi hàng khi lọc doc_type=SOP phải có doc_type = SOP');
    }

    // Lọc loại WI: chỉ DOC_IN_WI đạt trong phạm vi của A.
    const wiRows = await listVisibleDocuments(sql as never, USER_A, { doc_type: 'WI' });
    const wiIds = new Set(wiRows.map((r) => r.doc_id));

    assert.ok(wiIds.has(DOC_IN_WI), 'tài liệu WI trong phạm vi phải xuất hiện khi lọc doc_type=WI');
    assert.ok(!wiIds.has(DOC_IN_SOP), 'tài liệu SOP KHÔNG được xuất hiện khi lọc doc_type=WI');
    assert.ok(!wiIds.has(DOC_OUT), 'tài liệu ngoài phạm vi vẫn bị loại khi lọc doc_type=WI');
  });

  test('bộ lọc + phạm vi kết hợp: tập lọc là tập con của tập không lọc, và không rò tài liệu ngoài phạm vi', async (t) => {
    if (!dbOk || !sql) return t.skip('Không có Postgres chạy (DCS-8) — bỏ qua test tích hợp');

    // Parity Applied_Filters: tập khi lọc phải là tập con đúng của tập visible
    // không lọc (cùng hàm, chỉ khác tham số filters mà export truyền vào).
    const all = await listVisibleDocuments(sql as never, USER_A);
    const allIds = new Set(all.map((r) => r.doc_id));
    const filtered = await listVisibleDocuments(sql as never, USER_A, { doc_type: 'SOP' });

    for (const r of filtered) {
      assert.ok(allIds.has(r.doc_id), 'mọi hàng đã lọc phải thuộc tập visible không lọc');
      assert.notEqual(r.doc_id, DOC_OUT, 'tài liệu ngoài phạm vi không bao giờ xuất hiện trong tập đã lọc');
    }
    // Tập đã lọc trong phạm vi A đúng bằng {DOC_IN_SOP}.
    const filteredIds = filtered.map((r) => r.doc_id).filter((id) => id.startsWith('T74-'));
    assert.deepEqual(filteredIds.sort(), [DOC_IN_SOP].sort());
  });
});
