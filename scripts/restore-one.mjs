/**
 * Khôi phục mật khẩu một tài khoản từ file CSV (không in mật khẩu ra stdout).
 *
 *   node /tmp/dcs-backup/restore-one.mjs <csv> <email>
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { hashPassword } from '/opt/dcs/dist/domain/auth.js';

const [, , csvPath, email] = process.argv;

function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const line of readFileSync('/etc/dcs/.env', 'utf8').split('\n')) {
    const m = line.match(/^DATABASE_URL=(.*)$/);
    if (m) return m[1].trim();
  }
  throw new Error('Không tìm thấy DATABASE_URL');
}

const lines = readFileSync(csvPath, 'utf8').trim().split('\n');
const header = lines[0].split(',');
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const row = lines.slice(1).map((l) => l.split(',')).find((c) => c[col.email] === email);
if (!row) throw new Error(`Không thấy ${email} trong CSV`);

const plain = row[col.password];
const sql = postgres(loadEnv(), { max: 1 });
try {
  const hash = await hashPassword(plain);
  const res = await sql`
    UPDATE users SET password_hash = ${hash}, updated_at = now()
     WHERE lower(email) = lower(${email})
    RETURNING user_id`;
  console.log(res.length === 1 ? `ok  ${email}` : `FAIL ${email}`);
} finally {
  await sql.end();
}
