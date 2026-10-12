/**
 * scripts/rotate-one.mjs — đổi mật khẩu MỘT tài khoản và cập nhật lại file CSV.
 * KHÔNG in mật khẩu ra stdout/log. Tự thu hồi toàn bộ phiên đang mở của user đó.
 *   cd /opt/dcs && node scripts/rotate-one.mjs <csv> <email>
 */
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword } from '../dist/domain/auth.js';

const [, , csvPath, email] = process.argv;
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_.';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';
const pick = (s) => s[randomInt(s.length)];

function generate() {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), ...Array.from({ length: 17 }, () => pick(ALPHABET))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function loadEnv() {
  for (const line of readFileSync('/etc/dcs/.env', 'utf8').split('\n')) {
    const m = line.match(/^DATABASE_URL=(.*)$/);
    if (m) return m[1].trim();
  }
  throw new Error('no DATABASE_URL');
}

const lines = readFileSync(csvPath, 'utf8').trim().split('\n');
const head = lines[0].split(',');
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const idx = lines.findIndex((l, i) => i > 0 && l.split(',')[col.email] === email);
if (idx < 0) throw new Error(`Không thấy ${email} trong CSV`);

const plain = generate();
const sql = postgres(loadEnv(), { max: 1 });
try {
  const hash = await hashPassword(plain);
  await sql.begin(async (tx) => {
    const res = await tx`
      UPDATE users SET password_hash = ${hash}, updated_at = now()
       WHERE lower(email) = lower(${email})
      RETURNING user_id`;
    if (res.length !== 1) throw new Error(`UPDATE khớp ${res.length} dòng`);
    // app_session không có cột revoked/revoked_at -> thu hồi bằng cách xoá
    const del = await tx`DELETE FROM app_session WHERE user_id = ${res[0].user_id}`;
    const cells = lines[idx].split(',');
    cells[col.password] = plain;
    lines[idx] = cells.join(',');
    writeFileSync(csvPath, lines.join('\n') + '\n', { mode: 0o600 });
    chmodSync(csvPath, 0o600);
    console.log(`ok  ${email} — CSV cập nhật, xoá ${del.count} phiên cũ`);
  });
} finally {
  await sql.end();
}
