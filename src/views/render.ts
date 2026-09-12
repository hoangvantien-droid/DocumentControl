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

export function registerViewLayer(app: FastifyInstance, eta: Eta): void {
  app.decorateReply('view', function (template: string, data: Record<string, unknown> = {}) {
    const html = eta.render(template, data);
    this.type('text/html; charset=utf-8').send(html);
    return this;
  });
}
