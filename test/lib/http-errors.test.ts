/**
 * test/lib/http-errors.test.ts — kiểm thử THUẦN helper hiển thị lỗi (mock
 * req/reply, không chạm mạng).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isHtmx, sendBusinessError, sendOk } from '../../src/lib/http-errors.js';
import { BusinessError } from '../../src/lib/errors.js';

function mockReq(htmx: boolean) {
  return { headers: htmx ? { 'hx-request': 'true' } : {} } as never;
}
function mockReply() {
  const r: any = {
    _code: null, _type: null, _sent: null, _headers: {}, _view: null,
    code(c: number) { this._code = c; return this; },
    type(t: string) { this._type = t; return this; },
    header(k: string, v: string) { this._headers[k] = v; return this; },
    send(body?: unknown) { this._sent = body ?? null; return this; },
    redirect(to: string) { this._redirect = to; return this; },
    view(tpl: string, data: unknown) { this._view = { tpl, data }; return this; },
  };
  return r;
}

describe('isHtmx', () => {
  test('header HX-Request=true -> true', () => {
    assert.equal(isHtmx(mockReq(true)), true);
  });
  test('không header -> false', () => {
    assert.equal(isHtmx(mockReq(false)), false);
  });
});

describe('sendBusinessError', () => {
  test('htmx -> fragment toast error + httpStatus', () => {
    const r = mockReply();
    const err = new BusinessError('x.y', 'Chỉ in được bản đang hiệu lực', { httpStatus: 422 });
    sendBusinessError(mockReq(true), r, err);
    assert.equal(r._code, 422);
    assert.match(String(r._sent), /toast--error/);
    assert.match(String(r._sent), /Chỉ in được bản đang hiệu lực/);
    assert.equal(r._view, null); // không render trang
  });
  test('non-htmx -> trang error.eta (không text trần)', () => {
    const r = mockReply();
    const err = new BusinessError('x.y', 'Sai nghiệp vụ', { httpStatus: 403 });
    sendBusinessError(mockReq(false), r, err);
    assert.equal(r._code, 403);
    assert.equal(r._view.tpl, 'error.eta');
    assert.equal(r._view.data.message, 'Sai nghiệp vụ');
  });
  test('escape HTML trong message (htmx)', () => {
    const r = mockReply();
    const err = new BusinessError('x', '<script>x</script>', {});
    sendBusinessError(mockReq(true), r, err);
    assert.doesNotMatch(String(r._sent), /<script>x<\/script>/);
    assert.match(String(r._sent), /&lt;script&gt;/);
  });
});

describe('sendOk', () => {
  test('htmx -> HX-Redirect header + 204', () => {
    const r = mockReply();
    sendOk(mockReq(true), r, '/my-documents');
    assert.equal(r._headers['HX-Redirect'], '/my-documents');
    assert.equal(r._code, 204);
  });
  test('non-htmx -> redirect thường', () => {
    const r = mockReply();
    sendOk(mockReq(false), r, '/my-documents');
    assert.equal(r._redirect, '/my-documents');
  });
});
