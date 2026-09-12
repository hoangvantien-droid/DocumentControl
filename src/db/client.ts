/**
 * src/db/client.ts — kết nối PostgreSQL, gộp kết nối, helper nạp file .sql.
 *
 * Dùng `postgres` (porsager) — SQL thuần, KHÔNG ORM (DCS-8 §1.2). DCS-4 là
 * nguồn sự thật về lược đồ; thêm ORM sẽ tạo định nghĩa lược đồ thứ hai và
 * hai bản sẽ lệch nhau.
 */
import postgres, { type Sql } from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _sql: Sql | null = null;

/**
 * Tạo (hoặc trả về) kết nối gộp dùng chung. Gọi nhiều lần trả về cùng một
 * instance để tránh mở nhiều pool trên máy 1 GB (DCS-5 §2.1: max_connections
 * thấp, gộp kết nối phía ứng dụng).
 */
export function getSql(config: Pick<Config, 'databaseUrl' | 'dbPoolMax'>): Sql {
  if (_sql) return _sql;
  _sql = postgres(config.databaseUrl, {
    max: config.dbPoolMax,
    // Từ vựng nghiệp vụ tiếng Việt không dấu — không đổi tên cột (DCS-8 §3.1, §3.2).
    transform: { undefined: null },
    onnotice: () => {}, // im lặng NOTICE để log gọn
  });
  return _sql;
}

/** Đóng pool — dùng khi tắt máy chủ hoặc kết thúc bộ kiểm thử. */
export async function closeSql(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}

/**
 * Nạp nội dung một file .sql trong thư mục db/sql/ theo tên.
 * Ví dụ: loadSqlFile('search') -> db/sql/search.sql.
 * Dùng cho các truy vấn dài đặt trong file riêng thay vì nhúng chuỗi (DCS-8 §1.2).
 */
export function loadSqlFile(name: string): string {
  const path = join(__dirname, 'sql', name.endsWith('.sql') ? name : `${name}.sql`);
  return readFileSync(path, 'utf8');
}
