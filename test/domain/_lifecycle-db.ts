/**
 * test/domain/_lifecycle-db.ts — hạ tầng DÙNG CHUNG cho các test tích hợp vòng
 * đời mới (điểm 1-10 của FEAT-004). KHÔNG phải file test (không khớp *.test.ts
 * nên runner bỏ qua).
 *
 * Giữ ĐÚNG khuôn self-skip của test/domain/receipt-model.integration.test.ts:
 * đọc DATABASE_URL linh hoạt (biến môi trường / .env), nếu không nối được
 * Postgres thì trả dbOk=false để từng test tự t.skip() — `npm run test:unit`
 * ở máy không-DB vẫn xanh.
 *
 * Seed tham chiếu theo scripts/seed_matrix.mjs: author@mml.io (DC_AUTHOR),
 * dc_mml@mml.io / dc_hcm@mml.io (DC_SITE_DOC_CONTROL theo site), ≥2 site.
 */
import { readFileSync, existsSync } from 'node:fs';
import postgres from 'postgres';

/** Đọc DATABASE_URL: ưu tiên biến môi trường, rồi /etc/dcs/.env, rồi .env. */
export function resolveDbUrl(): string | null {
  if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const p of ['/etc/dcs/.env', '/opt/dcs/.env', '.env']) {
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^DATABASE_URL(?:_TEST)?=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

export type Sql = ReturnType<typeof postgres>;

export interface LifecycleEnv {
  sql: Sql | null;
  dbOk: boolean;
  /** user_id của author@mml.io (DC_AUTHOR) — người đăng ký trong các ca. */
  AUTHOR_ID: string;
  /** site_id của ≥2 site đầu (theo site_code) để sinh receipt. */
  SITE_IDS: string[];
}

/** Nối DB + nạp seed tối thiểu. Gọi trong before(); kiểm env.dbOk trước mỗi test. */
export async function connectLifecycle(dbUrl: string | null): Promise<LifecycleEnv> {
  const env: LifecycleEnv = { sql: null, dbOk: false, AUTHOR_ID: '', SITE_IDS: [] };
  if (!dbUrl) return env;
  try {
    const probe = postgres(dbUrl, { max: 1, onnotice: () => {}, connect_timeout: 3 });
    await probe`SELECT 1`;
    env.sql = probe;
    env.dbOk = true;
    const a = await probe`SELECT user_id FROM users WHERE email = 'author@mml.io' LIMIT 1`;
    env.AUTHOR_ID = a[0]?.user_id ?? '';
    const sites = await probe`SELECT site_id FROM org_site ORDER BY site_code LIMIT 2`;
    env.SITE_IDS = sites.map((r: { site_id: string }) => r.site_id);
  } catch {
    env.dbOk = false;
  }
  return env;
}

/** Tìm một DC Site đang hoạt động cho site cho trước (hoặc '' nếu chưa seed). */
export async function dcSiteUserFor(sql: Sql, siteId: string): Promise<string> {
  const rows = await sql`
    SELECT user_id FROM user_roles
     WHERE role_code = 'DC_SITE_DOC_CONTROL' AND is_active AND scope_site_id = ${siteId}
     LIMIT 1`;
  return rows[0]?.user_id ?? '';
}

/** Xóa sạch một tài liệu test (version + receipt cascade + documents). */
export async function cleanupDoc(sql: Sql, docId: string): Promise<void> {
  await sql`DELETE FROM document_versions WHERE doc_id = ${docId}`;
  await sql`DELETE FROM documents WHERE doc_id = ${docId}`;
}

/** Ngày hôm nay 'YYYY-MM-DD'. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
/** Dời ngày hôm nay đi `days` ngày (âm = quá khứ). */
export function shiftDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Input VersionInput mặc định hợp lệ cho submitRegistration (ngày = hôm nay). */
export function versionInput(
  docId: string,
  authorId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    docId, versionNo: '1.0', title: `LC ${docId}`,
    issuedDate: today(), effectiveDate: today(),
    reviewCycleMonths: 12, sourceChannel: 'thu_cong',
    filePath: '/tmp/lc.pdf', fileHash: `hash-${docId}`,
    registrantUserId: authorId, ownerDepartmentId: '',
    ...over,
  };
}
