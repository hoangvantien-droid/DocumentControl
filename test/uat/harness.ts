/**
 * test/uat/harness.ts — hạ tầng cho UAT TẦNG 2 (HTTP end-to-end).
 *
 * Mục tiêu: chạy app Fastify THẬT trong tiến trình (app.inject — KHÔNG mở cổng
 * mạng), seed dữ liệu nền theo mục 2 của docs/KE-HOACH-TEST-TOAN-DIEN.md, và
 * dọn sạch DB test theo đúng cơ chế của test/constraints.test.ts.
 *
 * TẦNG 2 CHỈ chạy khi có DATABASE_URL_TEST (VPS/CI có PostgreSQL). Khi thiếu
 * biến này, `dbAvailable` = false và các suite tầng 2 phải tự skip gọn — KHÔNG
 * làm vỡ `npm run test:unit`.
 *
 * App được dựng bằng cách LẶP LẠI đúng trình tự đăng ký plugin/route của
 * src/server.ts (server.ts chỉ có main() tự listen, không tách buildApp). Ở đây
 * KHÔNG sửa logic nghiệp vụ — chỉ ghép các register* y như production rồi dùng
 * inject thay cho listen.
 */
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';

import { registerViewLayer } from '../../src/views/render.js';
import { registerAuth, setCookiePath } from '../../src/middleware/auth.js';
import { registerHomeRoutes } from '../../src/routes/home.js';
import { registerAuthRoutes } from '../../src/routes/auth.js';
import { registerAdminRoutes } from '../../src/routes/admin.js';
import { registerDocumentRoutes } from '../../src/routes/documents.js';
import { registerConfirmationRoutes } from '../../src/routes/confirmation.js';
import { registerCatalogRoutes } from '../../src/routes/catalog.js';
import { registerSearchRoutes } from '../../src/routes/search.js';
import { registerDiffRoutes } from '../../src/routes/diff.js';
import { registerFunctionalGroupRoutes } from '../../src/routes/functional-groups.js';
import { registerReviewRoutes } from '../../src/routes/reviews.js';
import { registerPackageRoutes } from '../../src/routes/packages.js';
import { registerPrintingRoutes } from '../../src/routes/printing.js';
import { registerAuditRoutes } from '../../src/routes/audit.js';
import type { Config } from '../../src/config.js';
import { hashPassword } from '../../src/domain/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src');

// ---- Cổng vào DB test (giống constraints.test.ts) ------------------------
export const DB_URL = process.env.DATABASE_URL_TEST ?? '';
export const dbAvailable = DB_URL.length > 0;

if (dbAvailable && !/test/i.test(DB_URL)) {
  throw new Error(
    'DATABASE_URL_TEST phải trỏ vào cơ sở dữ liệu có chữ "test" trong tên — chặn nhầm vào dữ liệu thật',
  );
}

/** Secret phiên cho harness — không dùng DB thật nên cố định được. */
const SESSION_SECRET = 'uat-harness-session-secret-cố-định-ít-nhất-32-ký-tự';
const PASSWORD = 'uat-pass-123';

/** Cấu hình tối thiểu cho các route cần Config (documents, catalog, printing). */
const testConfig: Config = {
  nodeEnv: 'test',
  port: 0,
  logLevel: 'silent',
  databaseUrl: DB_URL,
  sessionSecret: SESSION_SECRET,
  fileStoragePath: join(__dirname, '..', '..', '.uat-files'),
  dbPoolMax: 4,
  basePath: '',
  publicUrl: 'http://localhost',
  embeddingApiUrl: null,
  embeddingApiKey: null,
  tesseractPath: '/usr/bin/tesseract',
};

/** Định danh dữ liệu nền (mục 2 của kịch bản). */
export interface SeedIds {
  buA: string; buB: string;
  siteX: string; siteY: string;
  deptX1: string; deptY1: string; deptX2: string;
  users: Record<string, string>; // mã gợi ý -> user_id
}

export interface Harness {
  app: FastifyInstance;
  sql: Sql;
  ids: SeedIds;
  /** Đăng nhập qua POST /login thật, trả về cookie đã ký để gắn vào request sau. */
  login(userKey: string): Promise<string>;
  teardown(): Promise<void>;
}

function buildSql(): Sql {
  return postgres(DB_URL, { max: 4, onnotice: () => {} });
}

/** Dựng app Fastify y như server.ts nhưng dùng sql tiêm vào và inject thay vì listen. */
async function buildApp(sql: Sql): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cookie, { secret: SESSION_SECRET });
  await app.register(formbody);
  await app.register(multipart, {
    attachFieldsToBody: 'keyValues',
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  });
  await app.register(fastifyStatic, { root: join(SRC, 'public'), prefix: '/static/' });

  const eta = new Eta({ views: join(SRC, 'views'), cache: false });
  registerViewLayer(app, eta, '');
  setCookiePath('');

  registerAuth(app, sql);
  registerAuthRoutes(app, sql);
  registerHomeRoutes(app, sql);
  registerAdminRoutes(app, sql);
  registerDocumentRoutes(app, sql, testConfig);
  registerConfirmationRoutes(app, sql);
  registerCatalogRoutes(app, sql, testConfig);
  registerSearchRoutes(app, sql);
  registerDiffRoutes(app, sql);
  registerFunctionalGroupRoutes(app, sql);
  registerReviewRoutes(app, sql);
  registerPackageRoutes(app, sql);
  registerPrintingRoutes(app, sql, testConfig);
  registerAuditRoutes(app, sql);

  await app.ready();
  return app;
}

/** Chạy toàn bộ migration 001→014 (giống `npm run migrate`) trên DB test sạch. */
function applyMigrations(sql: Sql): Promise<void> {
  const dir = join(SRC, 'db', 'migrations');
  // Thứ tự số tăng dần — các file đặt tên 001_.., 002_..
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const na = Number(a.match(/^(\d+)/)?.[1] ?? '0');
      const nb = Number(b.match(/^(\d+)/)?.[1] ?? '0');
      return na - nb || a.localeCompare(b);
    });
  return (async () => {
    for (const f of files) {
      await sql.unsafe(readFileSync(join(dir, f), 'utf8'));
    }
  })();
}

/**
 * Tạo một người dùng + gán vai (user_roles @group) + đặt primary_dept_id trực tiếp.
 *
 * LƯU Ý P.0: kịch bản §2.3 nêu KHÔNG có route đặt users.primary_dept_id và nghi
 * cột này có thể KHÔNG tồn tại trong schema. Hàm seedUser cố ghi primary_dept_id
 * khi primaryDeptId != undefined; nếu cột thiếu, lệnh UPDATE sẽ ném lỗi SQL để
 * phơi bày bug (xem test P.0 trong http.uat.test.ts).
 */
async function seedUser(
  sql: Sql,
  input: { email: string; fullName: string; roles: string[]; primaryDeptId?: string | null },
): Promise<string> {
  const id = randomUUID();
  const hash = await hashPassword(PASSWORD);
  await sql`
    INSERT INTO users (user_id, email, full_name, password_hash, is_active)
    VALUES (${id}, ${input.email}, ${input.fullName}, ${hash}, TRUE)`;
  for (const role of input.roles) {
    await sql`
      INSERT INTO user_roles (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id)
      VALUES (${id}, ${role}, 'group', NULL, NULL, NULL)
      ON CONFLICT (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id)
      DO UPDATE SET is_active = TRUE`;
  }
  if (input.primaryDeptId !== undefined) {
    // Có thể ném lỗi nếu cột không tồn tại — chủ ý, để test P.0 bắt được.
    await sql`UPDATE users SET primary_dept_id = ${input.primaryDeptId} WHERE user_id = ${id}`;
  }
  return id;
}

/** Dựng dữ liệu nền (mục 2) nếu cột primary_dept_id tồn tại. */
async function seedBaseData(sql: Sql): Promise<SeedIds> {
  const buA = randomUUID(), buB = randomUUID();
  const siteX = randomUUID(), siteY = randomUUID();
  const deptX1 = randomUUID(), deptY1 = randomUUID(), deptX2 = randomUUID();

  await sql`INSERT INTO org_bu (bu_id, bu_code, name) VALUES (${buA}, 'BU-A', 'BU A'), (${buB}, 'BU-B', 'BU B')`;
  // Site X thuộc CẢ BU-A và BU-B (N:N); Site Y chỉ BU-A.
  await sql`INSERT INTO org_site (site_id, site_code, name, legacy_primary_bu_id)
            VALUES (${siteX}, 'SITE-X', 'Site X', ${buA}), (${siteY}, 'SITE-Y', 'Site Y', ${buA})`;
  await sql`INSERT INTO org_site_bu (site_id, bu_id)
            VALUES (${siteX}, ${buA}), (${siteX}, ${buB}), (${siteY}, ${buA})`;
  await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id)
            VALUES (${deptX1}, 'DEPT-X1', 'Dept X1', ${siteX}),
                   (${deptX2}, 'DEPT-X2', 'Dept X2', ${siteX}),
                   (${deptY1}, 'DEPT-Y1', 'Dept Y1', ${siteY})`;

  const users: Record<string, string> = {};
  users.u_reader = await seedUser(sql, { email: 'reader@uat.test', fullName: 'Reader', roles: ['DC_READER'], primaryDeptId: deptX1 });
  users.u_author = await seedUser(sql, { email: 'author@uat.test', fullName: 'Author', roles: ['DC_AUTHOR'], primaryDeptId: deptX1 });
  users.u_dh_x = await seedUser(sql, { email: 'dhx@uat.test', fullName: 'DeptHead X', roles: ['DC_DEPT_HEAD'], primaryDeptId: deptX1 });
  users.u_dh_y = await seedUser(sql, { email: 'dhy@uat.test', fullName: 'DeptHead Y', roles: ['DC_DEPT_HEAD'], primaryDeptId: deptY1 });
  users.u_dh_null = await seedUser(sql, { email: 'dhnull@uat.test', fullName: 'DeptHead Null', roles: ['DC_DEPT_HEAD'], primaryDeptId: null });
  users.u_mix_ad = await seedUser(sql, { email: 'mixad@uat.test', fullName: 'Author+DeptHead', roles: ['DC_AUTHOR', 'DC_DEPT_HEAD'], primaryDeptId: deptX1 });
  users.u_mix_aa = await seedUser(sql, { email: 'mixaa@uat.test', fullName: 'Admin+Author', roles: ['DC_ADMIN', 'DC_AUTHOR'], primaryDeptId: deptX1 });
  users.u_mix_adm = await seedUser(sql, { email: 'mixadm@uat.test', fullName: 'Admin+DeptHead', roles: ['DC_ADMIN', 'DC_DEPT_HEAD'], primaryDeptId: deptY1 });
  users.u_admin = await seedUser(sql, { email: 'admin@uat.test', fullName: 'Admin', roles: ['DC_ADMIN'], primaryDeptId: deptX1 });
  // User bị khoá (A.3).
  users.u_locked = await seedUser(sql, { email: 'locked@uat.test', fullName: 'Locked', roles: ['DC_READER'], primaryDeptId: deptX1 });
  await sql`UPDATE users SET is_active = FALSE WHERE user_id = ${users.u_locked}`;

  return { buA, buB, siteX, siteY, deptX1, deptY1, deptX2, users };
}

/**
 * Seed một tài liệu + phiên bản ở trạng thái cho_xac_nhan với scope cho trước,
 * do `registrantUserId` nộp. Dùng cho các ca duyệt qua route /confirm/:id.
 * Trả về version_id.
 */
export async function seedPendingVersion(
  sql: Sql,
  input: {
    docId: string;
    scope: { level: 'group' | 'bu' | 'site' | 'dept'; buId?: string | null; siteId?: string | null; deptId?: string | null };
    registrantUserId: string;
    ownerDeptId: string;
    versionNo?: string;
  },
): Promise<string> {
  const versionId = randomUUID();
  await sql`
    INSERT INTO documents (doc_id, doc_type, origin, scope_level, scope_bu_id, scope_site_id, scope_dept_id)
    VALUES (${input.docId}, 'SOP', 'noi_bo', ${input.scope.level},
            ${input.scope.buId ?? null}, ${input.scope.siteId ?? null}, ${input.scope.deptId ?? null})
    ON CONFLICT (doc_id) DO NOTHING`;
  await sql`
    INSERT INTO document_versions
      (version_id, doc_id, version_no, title, issued_date, effective_date,
       review_cycle_months, source_channel, file_path, file_hash, status,
       registrant_user_id, owner_department_id)
    VALUES (${versionId}, ${input.docId}, ${input.versionNo ?? '1.0'}, ${'UAT ' + input.docId},
            '2026-01-01', '2099-01-01', 12, 'thu_cong', '/files/uat.pdf', 'uat-hash',
            'cho_xac_nhan', ${input.registrantUserId}, ${input.ownerDeptId})`;
  return versionId;
}

/** Kiểm tra cột users.primary_dept_id có tồn tại không (ca P.0). */
export async function hasPrimaryDeptIdColumn(sql: Sql): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'primary_dept_id'
    ) AS exists`;
  return rows[0]?.exists ?? false;
}

/**
 * Khởi tạo harness: dọn schema, migrate, seed, dựng app. Trả về đầy đủ công cụ.
 * Gọi trong before(); teardown() trong after().
 *
 * Ném lỗi nếu DB không khả dụng — caller phải kiểm dbAvailable trước.
 */
export async function startHarness(): Promise<Harness> {
  if (!dbAvailable) throw new Error('DATABASE_URL_TEST không được đặt — không khởi tạo được harness tầng 2');
  const sql = buildSql();
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await applyMigrations(sql);

  // P.0: nếu thiếu cột primary_dept_id, seed sẽ ném — ta để lỗi lan ra để test
  // schema (chạy trước) phơi bày; nhưng vẫn cố seed để các suite khác chạy.
  const ids = await seedBaseData(sql);
  const app = await buildApp(sql);

  async function login(userKey: string): Promise<string> {
    const uid = ids.users[userKey];
    if (!uid) throw new Error(`Không có user seed cho khoá: ${userKey}`);
    const email = emailOf(userKey);
    const res = await app.inject({
      method: 'POST', url: '/login',
      payload: { email, password: PASSWORD },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!raw) throw new Error(`Đăng nhập thất bại cho ${userKey} (status ${res.statusCode})`);
    // Lấy phần "dcs_sid=...." trước dấu ';'
    return String(raw).split(';')[0]!;
  }

  async function teardown(): Promise<void> {
    await app.close();
    await sql.end();
  }

  return { app, sql, ids, login, teardown };
}

function emailOf(userKey: string): string {
  const map: Record<string, string> = {
    u_reader: 'reader@uat.test', u_author: 'author@uat.test',
    u_dh_x: 'dhx@uat.test', u_dh_y: 'dhy@uat.test', u_dh_null: 'dhnull@uat.test',
    u_mix_ad: 'mixad@uat.test', u_mix_aa: 'mixaa@uat.test', u_mix_adm: 'mixadm@uat.test',
    u_admin: 'admin@uat.test', u_locked: 'locked@uat.test',
  };
  const e = map[userKey];
  if (!e) throw new Error(`Không có email cho khoá: ${userKey}`);
  return e;
}

export { PASSWORD };
