/**
 * scripts/create-admin.mjs — tạo (hoặc khôi phục) tài khoản quản trị đầu tiên.
 *
 * Hệ thống mới trống rỗng: cần một người dùng có DC_GROUP_OWNER để đăng nhập,
 * khai tổ chức (BU/Site/Department), người dùng và vai trò. Chạy MỘT LẦN sau
 * khi migrate.
 *
 *   cd /opt/dcs && node scripts/create-admin.mjs <email> <mật khẩu> "<Họ tên>"
 *
 * Đọc DATABASE_URL từ /etc/dcs/.env (hoặc biến môi trường sẵn có).
 * Dùng module đã build trong /opt/dcs/dist để băm mật khẩu đúng chuẩn argon2id.
 *
 * ── Sửa 2026-10-01: bảng thật là `users` và `user_roles`, không phải VIEW ──
 * `app_user_ref` và `app_user_role` là VIEW (information_schema: is_updatable =
 * NO) nên bản cũ INSERT/UPDATE vào chúng sẽ lỗi. App đọc `FROM users`
 * (src/domain/auth.ts) và `FROM user_roles` (src/domain/permissions.ts).
 *
 * Về ON CONFLICT: unique index `uq_user_role` khai báo trên 6 cột gồm 3 cột
 * scope nullable. Trong Postgres NULL != NULL, nên index này KHÔNG bắt trùng
 * khi scope đều NULL. Vì vậy không dựa vào ON CONFLICT để chống trùng: script
 * kiểm tra sẵn bằng SELECT rồi mới INSERT. Cách này đúng với `grantRole` của
 * app, vốn dùng `DO UPDATE SET is_active = TRUE` chứ không phải DO NOTHING.
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword } from '../dist/domain/auth.js';

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
  const existing = await sql`SELECT user_id FROM users WHERE lower(email) = lower(${email})`;
  const hash = await hashPassword(password);
  let userId;

  if (existing.length > 0) {
    userId = existing[0].user_id;
    await sql`
      UPDATE users
         SET password_hash = ${hash},
             full_name     = ${fullName ?? email},
             is_active     = TRUE,
             updated_at    = now()
       WHERE user_id = ${userId}`;
    console.log(`Cập nhật mật khẩu cho người dùng đã có: ${email}`);
  } else {
    userId = randomUUID();
    await sql`
      INSERT INTO users (user_id, email, full_name, password_hash, is_active, temp_record)
      VALUES (${userId}, ${email}, ${fullName ?? email}, ${hash}, TRUE, TRUE)`;
    console.log(`Tạo người dùng: ${email}`);
  }

  // Gán DC_GROUP_OWNER cấp group (quyền cao nhất — release mọi tài liệu, quản trị).
  // Chống trùng bằng SELECT trước, không dựa vào ON CONFLICT: unique index
  // không so khớp NULL (xem ghi chú đầu file).
  const granted = await sql`
    SELECT 1 FROM user_roles
     WHERE user_id = ${userId}
       AND role_code = 'DC_GROUP_OWNER'
       AND scope_level = 'group'
       AND scope_bu_id IS NULL
       AND scope_site_id IS NULL
       AND scope_dept_id IS NULL`;

  if (granted.length > 0) {
    await sql`UPDATE user_roles SET is_active = TRUE
               WHERE user_id = ${userId} AND role_code = 'DC_GROUP_OWNER' AND scope_level = 'group'`;
    console.log('Vai trò DC_GROUP_OWNER đã có — đã bật lại (is_active = TRUE).');
  } else {
    await sql`
      INSERT INTO user_roles (user_id, role_code, scope_level, is_active)
      VALUES (${userId}, 'DC_GROUP_OWNER', 'group', TRUE)`;
    console.log('Đã gán vai trò DC_GROUP_OWNER.');
  }

  console.log('Đăng nhập tại https://tienhv.io.vn/dcs/login');
} finally {
  await sql.end();
}
