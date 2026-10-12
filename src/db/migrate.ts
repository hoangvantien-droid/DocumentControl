/**
 * src/db/migrate.ts — trình chạy migration.
 *
 * Chạy các file .sql trong migrations/ theo thứ tự SỐ tăng dần. Mỗi file chạy
 * trong MỘT giao dịch và được ghi vào bảng schema_migrations. File đã chạy thì
 * bỏ qua — nên chạy lần hai không lỗi (idempotent ở tầng runner, để schema gốc
 * DCS-4 không phải sửa thành CREATE ... IF NOT EXISTS).
 *
 * Dùng trực tiếp:  npm run migrate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getSql, closeSql } from './client.js';
import { loadConfig } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/** Số thứ tự nằm ở đầu tên file: 001_..., 002_... */
function migrationOrder(fileName: string): number {
  const match = fileName.match(/^(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => migrationOrder(a) - migrationOrder(b) || a.localeCompare(b));
}

export async function runMigrations(opts: {
  databaseUrl: string;
  dbPoolMax: number;
  log?: (msg: string) => void;
}): Promise<{ applied: string[]; skipped: string[] }> {
  const log = opts.log ?? ((m) => console.log(m));
  const sql = getSql({ databaseUrl: opts.databaseUrl, dbPoolMax: opts.dbPoolMax });

  // Bảng theo dõi migration — tạo trước, idempotent tự thân.
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      file_name   TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

  const done = await sql<{ file_name: string }[]>`SELECT file_name FROM schema_migrations`;
  const alreadyApplied = new Set(done.map((r) => r.file_name));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const fileName of listMigrationFiles()) {
    if (alreadyApplied.has(fileName)) {
      skipped.push(fileName);
      log(`  bỏ qua (đã chạy): ${fileName}`);
      continue;
    }
    const content = readFileSync(join(MIGRATIONS_DIR, fileName), 'utf8');
    log(`  chạy: ${fileName}`);
    // Mỗi migration một giao dịch: hoặc chạy trọn, hoặc rollback sạch.
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (file_name) VALUES (${fileName})`;
    });
    applied.push(fileName);
  }

  return { applied, skipped };
}

// Chạy khi gọi trực tiếp (npm run migrate).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.ts')) {
  const config = loadConfig();
  console.log(`Chạy migration trên: ${config.databaseUrl.replace(/:[^:@]*@/, ':****@')}`);
  runMigrations({ databaseUrl: config.databaseUrl, dbPoolMax: config.dbPoolMax })
    .then(({ applied, skipped }) => {
      console.log(`\nXong. Đã chạy ${applied.length} migration, bỏ qua ${skipped.length}.`);
      return closeSql();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration thất bại:', err);
      closeSql().finally(() => process.exit(1));
    });
}
