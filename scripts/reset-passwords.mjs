/**
 * scripts/reset-passwords.mjs — đặt lại mật khẩu cho toàn bộ tài khoản trong `users`.
 *
 *   cd /opt/dcs && node scripts/reset-passwords.mjs [output.csv]
 *
 * Ghi mật khẩu ra CSV (chmod 600) để gửi cho quản trị viên; KHÔNG in ra stdout,
 * KHÔNG in password_hash. Dùng `hashPassword` của app để băm đúng chuẩn argon2id.
 *
 * LƯU Ý: bảng thật là `users`. `app_user_ref` là VIEW (is_updatable = NO) —
 * script create-admin.mjs cũ ghi vào đó nên hỏng.
 */
import { readFileSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword } from '../dist/domain/auth.js';

const OUT = process.argv[2] ?? '/tmp/dcs-backup/dcs-credentials.csv';

// Bảng chữ an toàn cho form-urlencoded, shell, CSV: không & + % = # ?
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_.';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';

function pick(set) {
  return set[randomInt(set.length)];
}

/** Mật khẩu 20 ký tự, bắt buộc có chữ hoa + thường + số. */
function generate() {
  const chars = [
    pick(UPPER),
    pick(LOWER),
    pick(DIGIT),
    ...Array.from({ length: 17 }, () => pick(ALPHABET)),
  ];
  // Fisher-Yates bằng randomInt (không dùng Math.random)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const path = '/etc/dcs/.env';
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^DATABASE_URL=(.*)$/);
      if (m) return m[1].trim();
    }
  }
  throw new Error('Không tìm thấy DATABASE_URL');
}

const sql = postgres(loadEnv(), { max: 1 });

try {
  const users = await sql`
    SELECT user_id, email, full_name
      FROM users
     WHERE is_active
     ORDER BY email`;

  if (users.length === 0) throw new Error('Không có tài khoản active nào');

  const rows = [];
  for (const u of users) {
    const plain = generate();
    const hash = await hashPassword(plain);
    const res = await sql`
      UPDATE users
         SET password_hash = ${hash}
       WHERE user_id = ${u.user_id}
      RETURNING user_id`;
    if (res.length !== 1) throw new Error(`UPDATE thất bại cho ${u.email}`);
    rows.push({ email: u.email, full_name: u.full_name, password: plain });
    console.log(`  ok  ${u.email}`);
  }

  // Mật khẩu đổi rồi thì phiên cũ không còn tin cậy — thu hồi hết.
  const killed = await sql`DELETE FROM app_session RETURNING session_id`;
  console.log(`\nĐã thu hồi ${killed.length} phiên đăng nhập cũ.`);

  const csv = ['email,full_name,password']
    .concat(rows.map((r) => `${r.email},${r.full_name},${r.password}`))
    .join('\n') + '\n';
  writeFileSync(OUT, csv, { mode: 0o600 });
  chmodSync(OUT, 0o600);
  console.log(`Đặt lại ${rows.length} mật khẩu → ${OUT} (chmod 600)`);
} finally {
  await sql.end();
}
