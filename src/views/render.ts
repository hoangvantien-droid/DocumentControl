/**
 * src/views/render.ts — gắn Eta vào Fastify.
 *
 * Kết xuất phía máy chủ (SSR) + htmx (DCS-8 §1.1). Thêm reply.view(template, data)
 * để route trả HTML gọn.
 */
import type { FastifyInstance } from 'fastify';
import type { Eta } from 'eta';

declare module 'fastify' {
  interface FastifyReply {
    view(template: string, data?: Record<string, unknown>): FastifyReply;
  }
}

/**
 * Thêm tiền tố base path vào mọi URL nội bộ trong HTML (href/src/action/formaction
 * và các thuộc tính htmx hx-get/hx-post…). Chỉ áp cho đường dẫn bắt đầu bằng một
 * dấu "/" (nội bộ); bỏ qua "//" (external) và URL tuyệt đối. Làm ở MỘT chỗ để
 * không phải sửa từng view và không sót.
 */
function applyBasePath(html: string, basePath: string): string {
  if (!basePath) return html;
  const attrs = ['href', 'src', 'action', 'formaction', 'hx-get', 'hx-post', 'hx-put', 'hx-delete', 'hx-patch'];
  const re = new RegExp(`\\b(${attrs.join('|')})="(/(?!/)[^"]*)"`, 'g');
  return html.replace(re, (_m, attr: string, path: string) => {
    // Đã có prefix rồi thì không thêm nữa (tránh double).
    if (path === basePath || path.startsWith(basePath + '/')) return `${attr}="${path}"`;
    return `${attr}="${basePath}${path}"`;
  });
}

/** Mã trạng thái máy -> chữ tiếng Việt hiển thị (UAT: bảng danh mục hiện mã thô). */
export const STATUS_TEXT: Record<string, string> = {
  cho_hoan_thien: 'Chờ hoàn thiện',
  cho_xac_nhan: 'Chờ xác nhận',
  tu_choi: 'Từ chối',
  da_dang_ky: 'Đã đăng ký',
  hieu_luc: 'Hiệu lực',
  het_hieu_luc: 'Hết hiệu lực',
  thu_hoi: 'Thu hồi',
};

export function registerViewLayer(app: FastifyInstance, eta: Eta, basePath: string): void {
  app.decorateReply('view', function (template: string, data: Record<string, unknown> = {}) {
    // Tự chèn user hiện tại, cờ thực đơn để mọi view dùng chung. Data route ghi đè.
    const req = this.request;
    const merged = {
      user: req?.currentUser ?? null,
      nav: req?.nav ?? {},
      basePath,
      statusText: STATUS_TEXT,
      ...data,
    };
    let html = eta.render(template, merged);
    html = applyBasePath(html, basePath);
    this.type('text/html; charset=utf-8').send(html);
    return this;
  });
}
