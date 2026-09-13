/**
 * scripts/create-admin.mjs — tạo tài khoản quản trị đầu tiên.
 *
 * Hệ thống mới trống rỗng: cần một người dùng có DC_GROUP_OWNER để đăng nhập,
 * khai tổ chức (BU/Site/Department), người dùng và vai trò. Chạy MỘT LẦN sau
 * khi migrate.
 *
 *   cd /opt/dcs && node <đường-dẫn>/create-admin.mjs <email> <mật khẩu> "<Họ tên>"
 *
 * Đọc DATABASE_URL từ /etc/dcs/.env (hoặc biến môi trường sẵn có).
 * Dùng module đã build trong /opt/dcs/dist để băm mật khẩu đúng chuẩn argon2id.
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import argon2 from 'argon2';

const [, , email, password, fullName] = process.argv;
if (!email || !password) {
  console.error('Dùng: node create-admin.mjs <email> <mật khẩu> "<Họ tên>"');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Mật khẩu tối thiểu 8 ký tự.');
  process.exit(1);
}

// Nạp DATABASE_URL từ /etc/dcs/.env nếu chưa có trong môi trường.
function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const path = '/etc/dcs/.env';
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^DATABASE_URL=(.*)$/);
      if (m) return m[1].trim();
    }
  }
  throw new Error('Không tìm thấy DATABASE_URL (đặt biến môi trường hoặc /etc/dcs/.env)');
}

const sql = postgres(loadEnv(), { max: 1 });

try {
  const existing = await sql`SELECT user_id FROM app_user_ref WHERE lower(email) = lower(${email})`;
  let userId;
  const hash = await argon2.hash(password, { type: argon2.argon2id });

  if (existing.length > 0) {
    userId = existing[0].user_id;
    await sql`UPDATE app_user_ref SET password_hash = ${hash}, full_name = ${fullName ?? email}, is_active = TRUE WHERE user_id = ${userId}`;
    console.log(`Cập nhật mật khẩu cho người dùng đã có: ${email}`);
  } else {
    userId = randomUUID();
    await sql`
      INSERT INTO app_user_ref (user_id, email, full_name, password_hash, is_active, temp_record)
      VALUES (${userId}, ${email}, ${fullName ?? email}, ${hash}, TRUE, TRUE)`;
    console.log(`Tạo người dùng: ${email}`);
  }

  // Gán DC_GROUP_OWNER cấp group (quyền cao nhất — release mọi tài liệu, quản trị).
  await sql`
    INSERT INTO app_user_role (user_id, role_code, scope_level)
    VALUES (${userId}, 'DC_GROUP_OWNER', 'group')
    ON CONFLICT (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id) DO NOTHING`;

  console.log('Đã gán vai trò DC_GROUP_OWNER. Đăng nhập tại https://tienhv.io.vn/dcs/login');
} finally {
  await sql.end();
}
