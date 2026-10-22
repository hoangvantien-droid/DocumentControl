import type { DocType } from './registration.js';

export interface DocTypeOption {
  code: DocType;
  /** Nhãn hiển thị cho người dùng (hiện trùng mã; để mở đường bản địa hóa). */
  label: string;
}

/**
 * Nguồn DUY NHẤT của danh sách loại tài liệu cho tầng ứng dụng.
 *
 * Quan hệ với cơ sở dữ liệu: ràng buộc CHECK trong
 * src/db/migrations/001_schema.sql (documents.doc_type IN
 * ('SOP','WI','Form','Policy','External')) VẪN là nguồn thực thi thẩm quyền.
 * Hằng số này phải khớp CHECK đó. Thêm một loại mới sau này đòi HAI việc:
 *   (1) viết migration mở rộng ràng buộc CHECK, và
 *   (2) bổ sung mục tương ứng vào DOC_TYPES ở đây.
 * Không được chỉ sửa một trong hai nơi.
 */
export const DOC_TYPES: readonly DocTypeOption[] = [
  { code: 'SOP', label: 'SOP' },
  { code: 'WI', label: 'WI' },
  { code: 'Form', label: 'Form' },
  { code: 'Policy', label: 'Policy' },
  { code: 'External', label: 'External' },
] as const;

/** Chỉ các mã (tiện cho kiểm thử và so khớp). */
export const DOC_TYPE_CODES: readonly DocType[] = DOC_TYPES.map((t) => t.code);
