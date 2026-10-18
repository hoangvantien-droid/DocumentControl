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

/** Path của cookie — đặt theo base path để phiên gắn đúng phạm vi (/dcs). */
let cookiePath = '/';
export function setCookiePath(p: string): void {
  cookiePath = p || '/';
}

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

/**
 * Chặn truy cập trang nghiệp vụ tài liệu cho Admin-THUẦN (đứng ngoài luồng).
 * Phòng thủ sâu ở route: ẩn menu là chưa đủ, URL trực tiếp cũng phải bị chặn.
 * Trả user nếu được phép; null nếu đã gửi phản hồi (redirect/403).
 */
export async function requireDocFlow(
  sql: Sql, req: FastifyRequest, reply: FastifyReply,
): Promise<SessionUser | null> {
  const user = requireUser(req, reply);
  if (!user) return null;
  const { isDocFlowUser } = await import('../domain/permissions.js');
  if (!(await isDocFlowUser(sql, user.user_id))) {
    reply.code(403);
    reply.send('Admin quản trị không truy cập trang nghiệp vụ tài liệu. Dùng tài khoản có vai Biên soạn / Kiểm soát tài liệu site / Người đọc.');
    return null;
  }
  return user;
}

/** Đặt cookie phiên đã ký. */
export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: cookiePath,
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
  reply.clearCookie(SESSION_COOKIE, { path: cookiePath });
}
