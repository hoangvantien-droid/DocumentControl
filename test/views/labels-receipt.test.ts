/**
 * test/views/labels-receipt.test.ts — kiểm thử THUẦN nhãn cho mô hình receipt
 * mới (trạng thái version mới, receipt, loại từ chối, report, tổng hợp, vai mới).
 *
 * Giữ nguyên tắc labels.ts: không in mã enum ra UI; mã lạ trả về chính mã.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  docStatusLabel, roleLabel,
  receiptStatusLabel, receiptRejectTypeLabel,
  issueReportStatusLabel, aggregateStatusLabel,
} from '../../src/views/labels.js';

describe('docStatusLabel — trạng thái vòng đời mới', () => {
  test('da_ban_hanh có nhãn người-đọc', () => {
    assert.equal(docStatusLabel('da_ban_hanh'), 'Đã ban hành');
  });
  test('thu_hoi / het_hieu_luc giữ nhãn', () => {
    assert.equal(docStatusLabel('thu_hoi'), 'Đã thu hồi');
    assert.equal(docStatusLabel('het_hieu_luc'), 'Hết hiệu lực');
  });
  test('mã lạ trả về chính mã (lộ sớm khi test)', () => {
    assert.equal(docStatusLabel('xyz'), 'xyz');
  });
  test('null/undefined -> chuỗi rỗng', () => {
    assert.equal(docStatusLabel(null), '');
    assert.equal(docStatusLabel(undefined), '');
  });
});

describe('roleLabel — vai mới DC_SITE_DOC_CONTROL', () => {
  test('vai mới có nhãn', () => {
    assert.match(roleLabel('DC_SITE_DOC_CONTROL'), /Kiểm soát tài liệu site/);
  });
  test('vai cũ DC_DEPT_HEAD vẫn có nhãn (dữ liệu lịch sử)', () => {
    assert.match(roleLabel('DC_DEPT_HEAD'), /vai cũ/);
  });
});

describe('receiptStatusLabel', () => {
  test('cho_phan_hoi / chap_nhan / tu_choi', () => {
    assert.equal(receiptStatusLabel('cho_phan_hoi'), 'Chờ phản hồi');
    assert.equal(receiptStatusLabel('chap_nhan'), 'Đã chấp nhận');
    assert.equal(receiptStatusLabel('tu_choi'), 'Đã từ chối');
  });
  test('mã lạ trả chính mã', () => {
    assert.equal(receiptStatusLabel('zzz'), 'zzz');
  });
});

describe('receiptRejectTypeLabel', () => {
  test('phân biệt sai đăng ký / sai nội dung', () => {
    assert.equal(receiptRejectTypeLabel('sai_dang_ky'), 'Sai thông tin đăng ký');
    assert.equal(receiptRejectTypeLabel('sai_noi_dung'), 'Sai nội dung tài liệu');
  });
});

describe('issueReportStatusLabel', () => {
  test('moi / chuyen_phan_hoi / bac_bo', () => {
    assert.match(issueReportStatusLabel('moi'), /Mới/);
    assert.match(issueReportStatusLabel('chuyen_phan_hoi'), /chuyển/);
    assert.match(issueReportStatusLabel('bac_bo'), /bác bỏ/);
  });
});

describe('aggregateStatusLabel', () => {
  test('mọi mã tổng hợp có nhãn', () => {
    assert.equal(aggregateStatusLabel('chua_phat_hanh'), 'Chưa phát hành');
    assert.equal(aggregateStatusLabel('dang_cho'), 'Đang chờ phản hồi');
    assert.equal(aggregateStatusLabel('mot_phan'), 'Một phần đã áp dụng');
    assert.equal(aggregateStatusLabel('tranh_chap'), 'Có site báo sai sót');
    assert.equal(aggregateStatusLabel('toan_bo'), 'Toàn bộ đã áp dụng');
  });
});
