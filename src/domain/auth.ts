/**
 * src/domain/auth.ts — đăng nhập bằng email + mật khẩu, băm argon2id (DCS-8 §4.1).
 *
 * Giai đoạn 1: L1 chưa có, DCS tự xác thực. Khi L1 lên chuyển sang OIDC — mọi
 * chỗ lấy người dùng đi qua getCurrentUser (T-012) nên đổi ở một chỗ.
 *
 * Logic nghiệp vụ thuần, KHÔNG chạm HTTP (DCS-8 §2.1).
 */
import argon2 from 'argon2';
import type { Sql } from 'postgres';
import { BusinessError } from '../lib/errors.js';

export interface UserRef {
  user_id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
}

const ARGON2_OPTS: argon2.Options = { type: argon2.argon2id };

/** Băm mật khẩu — dùng khi tạo/đổi mật khẩu. Không bao giờ lưu dạng rõ. */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTS);
}

/** So khớp mật khẩu với hash đã lưu. */
export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain).catch(() => false);
}

/**
 * Xác thực email + mật khẩu. Trả về UserRef nếu đúng, ném BusinessError nếu sai.
 * Thông báo lỗi cố ý mơ hồ (không nói "sai email" hay "sai mật khẩu") để không
 * lộ email nào tồn tại.
 */
export async function authenticate(
  sql: Sql,
  email: string,
  password: string,
): Promise<UserRef> {
  const rows = await sql<
    (UserRef & { password_hash: string | null })[]
  >`SELECT user_id, email, full_name, is_active, password_hash
      FROM app_user_ref
     WHERE lower(email) = lower(${email})
     LIMIT 1`;

  const row = rows[0];
  const INVALID = new BusinessError('auth.invalid', 'Email hoặc mật khẩu không đúng', {
    httpStatus: 401,
  });

  if (!row || !row.password_hash) throw INVALID;
  if (!row.is_active) {
    throw new BusinessError('auth.inactive', 'Tài khoản đã ngừng hoạt động', {
      httpStatus: 403,
    });
  }
  const ok = await verifyPassword(row.password_hash, password);
  if (!ok) throw INVALID;

  return {
    user_id: row.user_id,
    email: row.email,
    full_name: row.full_name,
    is_active: row.is_active,
  };
}
