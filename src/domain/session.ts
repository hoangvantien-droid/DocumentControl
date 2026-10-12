/**
 * src/domain/session.ts — phiên làm việc lưu trong CSDL (DCS-8 §4.1).
 *
 * Phiên lưu DB chứ không trong bộ nhớ: 1 GB RAM không đủ cho kho phiên bộ nhớ,
 * và khởi động lại máy chủ không được làm mất phiên (T-011). Cookie chỉ mang
 * session_id đã ký; toàn bộ trạng thái phiên ở bảng app_session.
 */
import type { Sql } from 'postgres';

/** Hạn phiên: 8 giờ (DCS-8 §4.1). */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface SessionUser {
  user_id: string;
  email: string | null;
  full_name: string | null;
}

/** Tạo phiên mới cho người dùng, trả về session_id để đặt vào cookie. */
export async function createSession(sql: Sql, userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const rows = await sql<{ session_id: string }[]>`
    INSERT INTO app_session (user_id, expires_at)
    VALUES (${userId}, ${expiresAt})
    RETURNING session_id`;
  return rows[0]!.session_id;
}

/**
 * Tra phiên còn hạn và trả về người dùng. Trả null nếu phiên không tồn tại,
 * hết hạn, hoặc người dùng đã ngừng hoạt động. Cập nhật last_seen_at.
 */
export async function resolveSession(
  sql: Sql,
  sessionId: string,
): Promise<SessionUser | null> {
  const rows = await sql<SessionUser[]>`
    UPDATE app_session s
       SET last_seen_at = now()
      FROM users u
     WHERE s.session_id = ${sessionId}
       AND s.user_id = u.user_id
       AND s.expires_at > now()
       AND u.is_active
    RETURNING u.user_id, u.email, u.full_name`;
  return rows[0] ?? null;
}

/** Huỷ một phiên (đăng xuất). */
export async function destroySession(sql: Sql, sessionId: string): Promise<void> {
  await sql`DELETE FROM app_session WHERE session_id = ${sessionId}`;
}

/** Dọn phiên hết hạn — gọi định kỳ bởi tác vụ nền. */
export async function purgeExpiredSessions(sql: Sql): Promise<number> {
  const rows = await sql`DELETE FROM app_session WHERE expires_at <= now()`;
  return rows.count;
}
