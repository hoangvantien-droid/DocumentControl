/**
 * src/middleware/auth.ts — getCurrentUser(request): ĐƯỜNG DUY NHẤT lấy người
 * dùng hiện tại (DCS-8 §4.2).
 *
 * Không chỗ nào trong code được đọc cookie phiên trực tiếp. Khi L1 lên và đổi
 * sang OIDC, chỉ sửa đúng hàm này. Cookie chỉ mang session_id đã ký; danh tính
 * lấy từ bảng app_session qua resolveSession.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { resolveSession, destroySession, type SessionUser } from '../domain/session.js';

/** Tên cookie mang session_id đã ký. */
export const SESSION_COOKIE = 'dcs_sid';

import { buildNav, type NavFlags } from './nav.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Người dùng hiện tại, hoặc null nếu chưa đăng nhập. Đặt bởi preHandler. */
    currentUser: SessionUser | null;
    /** Cờ hiển thị thực đơn theo vai trò. Đặt bởi preHandler. */
    nav: NavFlags;
  }
}

/**
 * Đăng ký lớp xác thực: mỗi request tự phân giải người dùng từ cookie phiên,
 * gán vào request.currentUser, và dựng cờ thực đơn. getCurrentUser đọc từ đó.
 */
export function registerAuth(app: FastifyInstance, sql: Sql): void {
  app.decorateRequest('currentUser', null);
  app.decorateRequest('nav', null);

  app.addHook('preHandler', async (req) => {
    req.currentUser = null;
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        req.currentUser = await resolveSession(sql, unsigned.value);
      }
    }
    req.nav = await buildNav(sql, req.currentUser);
  });
}

/** Đường DUY NHẤT lấy người dùng hiện tại. */
export function getCurrentUser(req: FastifyRequest): SessionUser | null {
  return req.currentUser;
}

/** Bắt buộc đã đăng nhập; nếu chưa thì chuyển hướng tới trang đăng nhập. */
export function requireUser(req: FastifyRequest, reply: FastifyReply): SessionUser | null {
  const user = getCurrentUser(req);
  if (!user) {
    reply.redirect('/login');
    return null;
  }
  return user;
}

/** Đặt cookie phiên đã ký. */
export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    maxAge: 8 * 60 * 60, // 8 giờ, khớp SESSION_TTL_MS
  });
}

/** Xoá cookie phiên và huỷ phiên trong DB. */
export async function clearSession(
  sql: Sql,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const raw = req.cookies[SESSION_COOKIE];
  if (raw) {
    const unsigned = req.unsignCookie(raw);
    if (unsigned.valid && unsigned.value) await destroySession(sql, unsigned.value);
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
