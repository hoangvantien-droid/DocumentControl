/**
 * src/lib/http-errors.ts — hiển thị BusinessError thân thiện (spec
 * friendly-error-messages).
 *
 * Thay vì reply.send(err.message) (trang text trắng), trả CẢNH BÁO TẠI CHỖ:
 *  - Request htmx (header HX-Request): trả FRAGMENT toast (tone error) + status
 *    lỗi -> htmx chèn vào #toast-zone, người dùng KHÔNG rời trang.
 *  - Request thường (fallback): trả trang có layout + alert-banner (không text
 *    trần). Giữ nguyên httpStatus của BusinessError.
 *
 * Lỗi KHÔNG phải BusinessError KHÔNG đi qua đây — để nó ném ra, trả 500 thật.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type BusinessError } from './errors.js';

/** Request có phải do htmx gửi không (htmx đặt header HX-Request: true). */
export function isHtmx(req: FastifyRequest): boolean {
  return (req.headers['hx-request'] ?? '') === 'true';
}

/** Escape tối thiểu cho nội dung chèn vào HTML fragment. */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Trả BusinessError dưới dạng cảnh báo tại chỗ. Gọi trong catch:
 *   if (isBusinessError(err)) return sendBusinessError(req, reply, err);
 */
export function sendBusinessError(
  req: FastifyRequest,
  reply: FastifyReply,
  err: BusinessError,
): FastifyReply {
  reply.code(err.httpStatus);
  if (isHtmx(req)) {
    // Fragment toast (khớp components/toast.eta: class toast toast--error + tự
    // ẩn). htmx chèn vào #toast-zone (hx-swap beforeend).
    reply.type('text/html; charset=utf-8');
    const html =
      '<div class="toast toast--error" role="alert" data-toast><strong>Cảnh báo:</strong> ' +
      esc(err.message) + '</div>' +
      '<script>(function(){var e=document.querySelectorAll("[data-toast]");' +
      'var t=e[e.length-1];if(!t)return;setTimeout(function(){t.style.display="none";' +
      'if(t.parentNode)t.parentNode.removeChild(t);},5000);})();</script>';
    return reply.send(html);
  }
  // Fallback non-htmx: trang có layout + alert-banner (không text trần).
  return reply.view('error.eta', { message: err.message });
}

/**
 * Báo thành công cho htmx: điều hướng qua header HX-Redirect (htmx tự chuyển).
 * Non-htmx: redirect thường. Giữ luồng thành công như cũ.
 */
export function sendOk(
  req: FastifyRequest,
  reply: FastifyReply,
  redirectTo: string,
): FastifyReply {
  if (isHtmx(req)) {
    reply.header('HX-Redirect', redirectTo);
    return reply.code(204).send();
  }
  return reply.redirect(redirectTo);
}
