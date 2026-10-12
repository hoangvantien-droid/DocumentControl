/**
 * src/domain/users.ts — quản trị người dùng do DCS sở hữu.
 *
 * Một người có thể được gán nhiều Department; nghỉ việc thì tắt hoạt động để
 * bảo toàn bằng chứng xác nhận đọc và audit lịch sử.
 */
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { hashPassword } from './auth.js';
import { BusinessError } from '../lib/errors.js';

export interface UserRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
}

export async function listUsers(sql: Sql): Promise<UserRow[]> {
  return sql<UserRow[]>`
    SELECT user_id, email, full_name, is_active
      FROM users
     WHERE email IS NOT NULL
     ORDER BY full_name NULLS LAST, email`;
}

/** Tạo người dùng DCS với mật khẩu ban đầu. */
export async function createUser(
  sql: Sql,
  input: { email: string; fullName: string; password: string },
): Promise<string> {
  if (input.password.length < 8) {
    throw new BusinessError('user.weak_password', 'Mật khẩu tối thiểu 8 ký tự');
  }
  const existing = await sql`
    SELECT 1 FROM users WHERE lower(email) = lower(${input.email}) LIMIT 1`;
  if (existing.length > 0) {
    throw new BusinessError('user.email_taken', `Email ${input.email} đã tồn tại`);
  }
  const id = randomUUID();
  const hash = await hashPassword(input.password);
  await sql`
    INSERT INTO users (user_id, email, full_name, password_hash, is_active)
    VALUES (${id}, ${input.email}, ${input.fullName}, ${hash}, TRUE)`;
  return id;
}

export async function setUserActive(sql: Sql, userId: string, active: boolean): Promise<void> {
  await sql`UPDATE users SET is_active = ${active} WHERE user_id = ${userId}`;
}

/** Gán người dùng vào một bộ phận (N:N). Idempotent nhờ ON CONFLICT. */
export async function assignToDepartment(sql: Sql, userId: string, deptId: string): Promise<void> {
  await sql`
    INSERT INTO user_departments (user_id, dept_id, is_active)
    VALUES (${userId}, ${deptId}, TRUE)
    ON CONFLICT (user_id, dept_id) DO UPDATE SET is_active = TRUE`;
}

export async function removeFromDepartment(sql: Sql, userId: string, deptId: string): Promise<void> {
  await sql`UPDATE user_departments SET is_active = FALSE
             WHERE user_id = ${userId} AND dept_id = ${deptId}`;
}

export async function departmentsOfUser(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ dept_id: string }[]>`
    SELECT dept_id FROM user_departments WHERE user_id = ${userId} AND is_active`;
  return rows.map((r) => r.dept_id);
}
