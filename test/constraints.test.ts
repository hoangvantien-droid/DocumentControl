/**
 * test/constraints.test.ts
 *
 * Kiểm chứng 16 ràng buộc nghiệp vụ ĐƯỢC ÉP Ở TẦNG CƠ SỞ DỮ LIỆU.
 *
 * Vì sao bộ này tồn tại riêng:
 *   Phần lớn kiểm soát của DCS nằm ở tầng PostgreSQL — chỉ mục duy nhất có
 *   điều kiện, CHECK, trigger, quy tắc chặn ghi. Kiểm thử với cơ sở dữ liệu
 *   giả lập sẽ PASS trong khi hệ thật hỏng. Bộ này BẮT BUỘC chạy trên
 *   PostgreSQL thật.
 *
 * Chạy:  DATABASE_URL_TEST=postgres://... node --test test/constraints.test.ts
 *
 * Lưu ý: bộ này xoá sạch và dựng lại cơ sở dữ liệu kiểm thử trước mỗi lần chạy.
 * TUYỆT ĐỐI không trỏ DATABASE_URL_TEST vào cơ sở dữ liệu thật.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('Thiếu DATABASE_URL_TEST');
if (!/test/i.test(url)) {
  throw new Error('DATABASE_URL_TEST phải trỏ vào cơ sở dữ liệu có chữ "test" trong tên — chặn nhầm vào dữ liệu thật');
}

const sql = postgres(url, { max: 2, onnotice: () => {} });

/** Chạy một thao tác và mong nó BỊ CHẶN. Trả về thông báo lỗi để kiểm tra thêm. */
async function expectBlocked(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e: any) {
    return String(e.message ?? e);
  }
  assert.fail('Thao tác này đáng lẽ phải bị chặn nhưng đã được cho qua');
}

// ---- Dữ liệu nền dùng chung ----
const BU = randomUUID(), SITE = randomUUID(), DEPT = randomUUID();
const U_NOP = randomUUID(), U_XACNHAN = randomUUID();

before(async () => {
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await sql.unsafe(readFileSync('src/db/migrations/001_schema.sql', 'utf8'));
  await sql.unsafe(readFileSync('src/db/migrations/002_phu_luc_giai_doan_1.sql', 'utf8'));

  await sql`INSERT INTO org_bu (bu_id, bu_code, name) VALUES (${BU}, 'MEAT', 'MeatLife')`;
  await sql`INSERT INTO org_site (site_id, site_code, name, bu_id) VALUES (${SITE}, 'MML', 'MML', ${BU})`;
  await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id) VALUES (${DEPT}, 'QA', 'QA In-process', ${SITE})`;
  await sql`INSERT INTO app_user_ref (user_id) VALUES (${U_NOP}), (${U_XACNHAN})`;
  await sql`INSERT INTO app_user_dept (user_id, dept_id) VALUES (${U_NOP}, ${DEPT})`;
  await sql`INSERT INTO documents (doc_id, doc_type, scope_level, scope_site_id)
            VALUES ('MML/QA/HD-001', 'WI', 'site', ${SITE})`;
});

after(async () => { await sql.end(); });

/** Tạo một phiên bản với các giá trị mặc định hợp lệ, cho phép ghi đè. */
async function taoPhienBan(overrides: Record<string, unknown> = {}) {
  const rec = {
    version_id: randomUUID(),
    doc_id: 'MML/QA/HD-001',
    version_no: '1.0',
    title: 'Hướng dẫn kiểm tra mẫu lưu',
    issued_date: '2026-01-01',
    approver_name: 'QA tập đoàn',
    approval_reference: 'KD-2026-0001',
    effective_date: '2027-01-01',
    review_cycle_months: 12,
    source_channel: 'thu_cong',
    file_path: '/files/hd-001.pdf',
    file_hash: 'abc123',
    status: 'cho_xac_nhan',
    registrant_user_id: U_NOP,
    owner_department_id: DEPT,
    ...overrides,
  };
  await sql`INSERT INTO document_versions ${sql(rec as any)}`;
  return rec.version_id as string;
}

/** Nhãn liên kết là điều kiện để phiên bản rời trạng thái chờ xác nhận. */
async function themNhan(versionId: string) {
  await sql`INSERT INTO document_links (version_id, link_type, link_code, created_by)
            VALUES (${versionId}, 'dieu_khoan', 'BRC-9-5.6.2', ${U_NOP})`;
}

// ============================================================
describe('Kiểm soát hai lớp', () => {
  test('1. Người xác nhận không được trùng người nộp', async () => {
    const v = await taoPhienBan();
    const msg = await expectBlocked(() =>
      sql`UPDATE document_versions SET admin_user_id = ${U_NOP}, confirmed_at = now()
          WHERE version_id = ${v}`);
    assert.match(msg, /chk_admin_not_registrant/);
  });

  test('2. Đã xác nhận thì bắt buộc có người xác nhận', async () => {
    const v = await taoPhienBan({ version_no: '1.1' });
    await expectBlocked(() =>
      sql`UPDATE document_versions SET confirmed_at = now() WHERE version_id = ${v}`);
  });
});

describe('Guard ngày hiệu lực', () => {
  test('3. Ngày hiệu lực không được nhỏ hơn ngày xác nhận', async () => {
    const v = await taoPhienBan({ version_no: '1.2', effective_date: '2026-01-15' });
    const msg = await expectBlocked(() =>
      sql`UPDATE document_versions SET admin_user_id = ${U_XACNHAN}, confirmed_at = '2026-06-01'
          WHERE version_id = ${v}`);
    assert.match(msg, /chk_effective_after_confirm/);
  });

  test('4. Ngày hết hạn phải lớn hơn ngày hiệu lực', async () => {
    await expectBlocked(() =>
      taoPhienBan({ version_no: '1.3', effective_date: '2027-01-01', expiry_date: '2026-06-01' }));
  });
});

describe('Bắt buộc ghi lý do', () => {
  test('5. Từ chối không lý do bị chặn', async () => {
    const v = await taoPhienBan({ version_no: '1.4' });
    await expectBlocked(() =>
      sql`UPDATE document_versions SET status = 'tu_choi' WHERE version_id = ${v}`);
  });

  test('6. Thu hồi không lý do bị chặn', async () => {
    const v = await taoPhienBan({ version_no: '1.5' });
    await expectBlocked(() =>
      sql`UPDATE document_versions SET status = 'thu_hoi' WHERE version_id = ${v}`);
  });
});

describe('Mức độ thay đổi', () => {
  test('7. Phiên bản mới bắt buộc khai mức độ thay đổi', async () => {
    const goc = await taoPhienBan({ version_no: '2.0' });
    await expectBlocked(() =>
      taoPhienBan({ version_no: '2.1', supersedes_version_id: goc }));
  });

  test('8. Thay đổi lớn bắt buộc có tóm tắt', async () => {
    const goc = await taoPhienBan({ version_no: '3.0' });
    await expectBlocked(() =>
      taoPhienBan({ version_no: '3.1', supersedes_version_id: goc, change_significance: 'lon' }));
  });

  test('9. Thay đổi lớn có tóm tắt thì hợp lệ', async () => {
    const goc = await taoPhienBan({ version_no: '4.0' });
    const v = await taoPhienBan({
      version_no: '4.1', supersedes_version_id: goc,
      change_significance: 'lon', change_summary: 'Đổi ngưỡng nhiệt độ hấp',
    });
    assert.ok(v);
  });
});

describe('Phiên bản và hiệu lực', () => {
  test('10. Không trùng cặp số hiệu và phiên bản', async () => {
    await taoPhienBan({ version_no: '5.0' });
    const msg = await expectBlocked(() => taoPhienBan({ version_no: '5.0' }));
    assert.match(msg, /uq_doc_version/);
  });

  test('11. Mỗi số hiệu chỉ MỘT bản hiệu lực — ép ở tầng cơ sở dữ liệu', async () => {
    const a = await taoPhienBan({ version_no: '6.0' });
    const b = await taoPhienBan({ version_no: '6.1' });
    await themNhan(a); await themNhan(b);
    await sql`UPDATE document_versions SET status = 'hieu_luc' WHERE version_id = ${a}`;
    const msg = await expectBlocked(() =>
      sql`UPDATE document_versions SET status = 'hieu_luc' WHERE version_id = ${b}`);
    assert.match(msg, /uq_one_effective_per_doc/);
    await sql`UPDATE document_versions SET status = 'het_hieu_luc' WHERE version_id = ${a}`;
  });

  test('12. Có đúng một trong hai: ngày riêng hoặc thuộc gói', async () => {
    const v = await taoPhienBan({ version_no: '7.0' });
    await expectBlocked(() =>
      sql`UPDATE document_versions SET package_id = gen_random_uuid() WHERE version_id = ${v}`);
  });
});

describe('Nhãn liên kết bắt buộc', () => {
  test('13. Không có nhãn thì không rời được trạng thái chờ xác nhận', async () => {
    const v = await taoPhienBan({ version_no: '8.0' });
    const msg = await expectBlocked(() =>
      sql`UPDATE document_versions SET status = 'da_dang_ky' WHERE version_id = ${v}`);
    assert.match(msg, /nhãn liên kết/i);
  });
});

describe('Ghi vết append-only', () => {
  test('14. UPDATE và DELETE lên ghi vết đều không có tác dụng', async () => {
    await sql`INSERT INTO audit_log (actor_type, event_type, object_type, object_id)
              VALUES ('nguoi', 'xem', 'document_versions', 'x')`;
    const [{ count: truoc }] = await sql`SELECT count(*)::int FROM audit_log`;

    await sql`UPDATE audit_log SET event_type = 'tai'`;
    const [{ count: daDoi }] = await sql`SELECT count(*)::int FROM audit_log WHERE event_type = 'tai'`;
    assert.equal(daDoi, 0, 'UPDATE lên audit_log phải không có tác dụng');

    await sql`DELETE FROM audit_log`;
    const [{ count: sau }] = await sql`SELECT count(*)::int FROM audit_log`;
    assert.equal(sau, truoc, 'DELETE lên audit_log phải không có tác dụng');
  });
});

describe('Nhóm chức năng', () => {
  test('15. Bắt buộc có người phụ trách đích danh', async () => {
    await expectBlocked(() =>
      sql`INSERT INTO functional_groups (code, name) VALUES ('FG-X', 'Thiếu người phụ trách')`);
  });
});

describe('Tìm kiếm tiếng Việt', () => {
  test('16. Gõ không dấu vẫn tìm ra kết quả có dấu', async () => {
    const [{ count }] = await sql`
      SELECT count(*)::int FROM document_versions
       WHERE search_tsv @@ plainto_tsquery('simple', vn_unaccent('mau luu'))`;
    assert.ok(count > 0, 'Gõ "mau luu" phải tìm ra "mẫu lưu"');
  });
});

describe('Tài liệu nạp từ kho cũ', () => {
  test('17. Bản ghi nạp bắt buộc có ngày hiệu lực gốc', async () => {
    await expectBlocked(() =>
      taoPhienBan({ version_no: '9.0', migrated_record: true }));
  });
});

describe('So sánh phiên bản', () => {
  test('18. Nhận đúng mục thêm và mục đổi nội dung', async () => {
    const cu = await taoPhienBan({ version_no: '10.0' });
    const moi = await taoPhienBan({
      version_no: '10.1', supersedes_version_id: cu,
      change_significance: 'nho',
    });
    await sql`INSERT INTO document_sections (version_id, section_code, section_title, order_no, raw_text)
              VALUES (${cu}, '6.2', 'Tần suất', 1, 'hai lần mỗi tuần')`;
    await sql`INSERT INTO document_sections (version_id, section_code, section_title, order_no, raw_text)
              VALUES (${moi}, '6.2', 'Tần suất', 1, 'ba lần mỗi tuần'),
                     (${moi}, '7', 'Hồ sơ lưu', 2, 'nội dung mới')`;

    const rows = await sql`SELECT section_code, change_type FROM fn_diff_versions(${cu}, ${moi}) ORDER BY 1`;
    const map = Object.fromEntries(rows.map((r: any) => [r.section_code, r.change_type]));
    assert.equal(map['6.2'], 'doi_noi_dung');
    assert.equal(map['7'], 'them');
  });

  test('19. Phiên bản đầu tiên thì báo không có gì để so', async () => {
    const [{ fn_diff_reliability: kq }] = await sql`SELECT fn_diff_reliability(NULL, gen_random_uuid())`;
    assert.equal(kq, 'la_phien_ban_dau_tien');
  });

  test('20. Ô tích 9b chỉ mở sau khi đã xem so sánh', async () => {
    const v = randomUUID();
    const [{ fn_has_viewed_diff: truoc }] = await sql`SELECT fn_has_viewed_diff(${U_XACNHAN}, ${v})`;
    assert.equal(truoc, false);

    await sql`INSERT INTO audit_log (actor_user_id, actor_type, event_type, object_type, object_id)
              VALUES (${U_XACNHAN}, 'nguoi', 'xem_so_sanh', 'document_versions', ${v})`;
    const [{ fn_has_viewed_diff: sau }] = await sql`SELECT fn_has_viewed_diff(${U_XACNHAN}, ${v})`;
    assert.equal(sau, true);
  });
});
