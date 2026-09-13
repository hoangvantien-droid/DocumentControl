/**
 * src/domain/users.ts — quản trị người dùng tạm, gán vào bộ phận (T-014).
 *
 * Giai đoạn 1: DCS lưu tạm full_name/email/password_hash. Một người gán được
 * nhiều bộ phận (app_user_dept N:N), có thể ngừng hoạt động. Khi L1 lên, các
 * cột tạm bị gỡ và người dùng đồng bộ từ L1.
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
      FROM app_user_ref
     WHERE temp_record = TRUE OR email IS NOT NULL
     ORDER BY full_name NULLS LAST, email`;
}

/** Tạo người dùng tạm với mật khẩu ban đầu. */
export async function createUser(
  sql: Sql,
  input: { email: string; fullName: string; password: string },
): Promise<string> {
  if (input.password.length < 8) {
    throw new BusinessError('user.weak_password', 'Mật khẩu tối thiểu 8 ký tự');
  }
  const existing = await sql`
    SELECT 1 FROM app_user_ref WHERE lower(email) = lower(${input.email}) LIMIT 1`;
  if (existing.length > 0) {
    throw new BusinessError('user.email_taken', `Email ${input.email} đã tồn tại`);
  }
  const id = randomUUID();
  const hash = await hashPassword(input.password);
  await sql`
    INSERT INTO app_user_ref (user_id, email, full_name, password_hash, is_active, temp_record)
    VALUES (${id}, ${input.email}, ${input.fullName}, ${hash}, TRUE, TRUE)`;
  return id;
}

export async function setUserActive(sql: Sql, userId: string, active: boolean): Promise<void> {
  await sql`UPDATE app_user_ref SET is_active = ${active} WHERE user_id = ${userId}`;
}

/** Gán người dùng vào một bộ phận (N:N). Idempotent nhờ ON CONFLICT. */
export async function assignToDepartment(sql: Sql, userId: string, deptId: string): Promise<void> {
  await sql`
    INSERT INTO app_user_dept (user_id, dept_id, is_active)
    VALUES (${userId}, ${deptId}, TRUE)
    ON CONFLICT (user_id, dept_id) DO UPDATE SET is_active = TRUE`;
}

export async function removeFromDepartment(sql: Sql, userId: string, deptId: string): Promise<void> {
  await sql`UPDATE app_user_dept SET is_active = FALSE
             WHERE user_id = ${userId} AND dept_id = ${deptId}`;
}

export async function departmentsOfUser(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ dept_id: string }[]>`
    SELECT dept_id FROM app_user_dept WHERE user_id = ${userId} AND is_active`;
  return rows.map((r) => r.dept_id);
}
