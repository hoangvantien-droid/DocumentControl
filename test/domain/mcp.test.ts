/**
 * test/domain/mcp.test.ts — unit/property test THUẦN cho module MCP (không DB).
 *
 * Phủ các property kiểm chứng được mà không cần Postgres: clampLimit, capSnippet,
 * resolveIdentity (stub resolveSession), tầng ánh xạ search, và logic
 * không-tìm-thấy của readMarkdownIfAllowed. Phần cần DB (lọc quyền thật) nằm ở
 * mcp-permission.test.ts (xem PENDING-DB-TESTS).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampLimit,
  capSnippet,
  resolveIdentity,
  mapSearchHits,
  readMarkdownIfAllowed,
  type SearchResultItem,
} from '../../src/routes/mcp.js';
import type { SearchHit } from '../../src/domain/search.js';

const ROUNDS = 100;
function randInt(n: number): number { return Math.floor(Math.random() * n); }

describe('Feature: dcs-mcp-server', () => {
  // Property 7: Số kết quả luôn trong khoảng cho phép. Validates: 6.1, 6.2
  test('Property 7: Số kết quả luôn trong khoảng cho phép', () => {
    assert.equal(clampLimit(undefined), 20);
    assert.equal(clampLimit(100), 50);
    assert.equal(clampLimit(0), 1);
    assert.equal(clampLimit(-5), 1);
    for (let r = 0; r < ROUNDS; r++) {
      const n = randInt(200) - 50; // -50..149
      const c = clampLimit(n);
      assert.ok(c >= 1 && c <= 50, `clampLimit(${n})=${c} ngoài [1,50]`);
    }
    assert.equal(clampLimit(NaN), 20);
    assert.equal(clampLimit(Infinity), 20);
  });

  // Property 8: Snippet luôn bị cắt theo Snippet_Cap. Validates: 6.3
  test('Property 8: Snippet luôn bị cắt theo Snippet_Cap', () => {
    assert.equal(capSnippet(null), '');
    for (let r = 0; r < ROUNDS; r++) {
      const len = randInt(700);
      const s = 'x'.repeat(len);
      const out = capSnippet(s);
      assert.ok(out.length <= 300, `độ dài ${out.length} > 300`);
      assert.ok(s.startsWith(out), 'phải là tiền tố của chuỗi gốc');
    }
  });

  // Property 9: Phân giải danh tính là điều kiện cần. Validates: 2.1, 2.3, 2.4
  test('Property 9: Phân giải danh tính là điều kiện cần của mọi yêu cầu', async () => {
    const fakeUser = { user_id: 'u-1', email: null, full_name: null };
    const cfg = {} as never;
    const sql = {} as never;

    // Thiếu cookie -> null (không gọi resolveSession).
    let called = false;
    const deps = { resolveSession: async () => { called = true; return fakeUser; } };
    const reqNoCookie = { cookies: {}, unsignCookie: () => ({ valid: true, value: 's' }) } as never;
    assert.equal(await resolveIdentity(sql, cfg, reqNoCookie, deps), null);
    assert.equal(called, false, 'không được gọi resolveSession khi thiếu cookie');

    // Cookie sai chữ ký -> null.
    const reqBadSig = { cookies: { dcs_sid: 'raw' }, unsignCookie: () => ({ valid: false, value: null }) } as never;
    assert.equal(await resolveIdentity(sql, cfg, reqBadSig, deps), null);

    // resolveSession trả null -> null.
    const reqOk = { cookies: { dcs_sid: 'raw' }, unsignCookie: () => ({ valid: true, value: 'sid-1' }) } as never;
    assert.equal(await resolveIdentity(sql, cfg, reqOk, { resolveSession: async () => null }), null);

    // Hợp lệ -> trả đúng SessionUser.
    const got = await resolveIdentity(sql, cfg, reqOk, { resolveSession: async () => fakeUser });
    assert.deepEqual(got, fakeUser);
  });

  // Property 2/3/6: ánh xạ search giữ nguyên dữ liệu, không lọc lại, giữ match_level.
  // Validates: 3.2, 3.3, 3.4, 3.5
  test('Property 2,3,6: mapSearchHits giữ nguyên tập kết quả và match_level', () => {
    const levels = ['document', 'section', 'fulltext'];
    for (let r = 0; r < ROUNDS; r++) {
      const n = randInt(10);
      const hits: SearchHit[] = Array.from({ length: n }, (_, i) => ({
        doc_id: `D-${r}-${i}`,
        version_id: `V-${i}`,
        version_no: '1.0',
        title: `T${i}`,
        status: 'hieu_luc',
        section_code: null,
        section_title: null,
        snippet: 'x'.repeat(randInt(500)),
        match_level: levels[randInt(3)]!,
        rank: Math.random(),
      }));
      const out: SearchResultItem[] = mapSearchHits(hits);
      // Property 3: tập doc_id không đổi, không thêm/bớt.
      assert.deepEqual(out.map((o) => o.doc_id), hits.map((h) => h.doc_id));
      // Property 6: match_level giữ nguyên từng phần tử.
      assert.deepEqual(out.map((o) => o.match_level), hits.map((h) => h.match_level));
      // Property 8 áp vào snippet trong ánh xạ.
      for (const o of out) assert.ok(o.snippet.length <= 300);
    }
  });

  // Property 4/5: readMarkdownIfAllowed không trả nội dung khi không được phép,
  // và không phân biệt "không tồn tại" với "ngoài phạm vi".
  // Validates: 4.2, 4.3, 5.3, 5.4
  test('Property 4,5: readMarkdownIfAllowed từ chối không phân biệt', async () => {
    // Trường hợp 1: không có bản hiệu lực (doc không tồn tại) -> null.
    const sqlNoVersion = (() => {
      const f = async () => [] as { version_id: string }[];
      return f as never;
    })();
    const r1 = await readMarkdownIfAllowed(sqlNoVersion, 'u1', 'KHONG-TON-TAI', async () => true);
    assert.equal(r1, null, 'không có bản hiệu lực -> null');

    // Trường hợp 2: có bản hiệu lực nhưng canViewVersion=false (ngoài phạm vi) -> null.
    // sql trả version_id ở lần gọi đầu; canViewVersion luôn false.
    const sqlWithVersion = (async () => [{ version_id: 'V-1' }]) as never;
    const r2 = await readMarkdownIfAllowed(sqlWithVersion, 'u1', 'TON-TAI-NGOAI-PHAM-VI', async () => false);
    assert.equal(r2, null, 'ngoài phạm vi -> null');

    // Property 5: hai nhánh cho kết quả giống hệt (đều null) -> caller sinh notFound giống hệt.
    assert.equal(r1, r2);
  });
});
