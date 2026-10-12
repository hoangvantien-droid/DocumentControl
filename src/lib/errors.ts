/**
 * src/lib/errors.ts — phân biệt ba loại lỗi (DCS-8 §3.3).
 *
 *  1. BusinessError       — vi phạm quy tắc nghiệp vụ; routes/ chuyển thành
 *                           thông báo cho người dùng.
 *  2. Lỗi ràng buộc DB    — KHÔNG bắt rồi nuốt. Là dấu hiệu tầng service thiếu
 *                           kiểm tra. Ghi log đầy đủ (isDbConstraintError nhận diện).
 *  3. Lỗi không lường trước — ghi log, trả lỗi chung, không lộ chi tiết ra ngoài.
 */

/** Lỗi vi phạm quy tắc nghiệp vụ, mang mã để route ánh xạ ra thông báo. */
export class BusinessError extends Error {
  readonly code: string;
  /** Mã HTTP gợi ý khi trả về; mặc định 422 (dữ liệu hợp lệ về cú pháp nhưng sai nghiệp vụ). */
  readonly httpStatus: number;
  /** Dữ liệu bổ sung để route dựng thông báo (ví dụ số hiệu đang tồn tại). */
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    opts?: { httpStatus?: number; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
    this.httpStatus = opts?.httpStatus ?? 422;
    this.details = opts?.details;
  }
}

export function isBusinessError(e: unknown): e is BusinessError {
  return e instanceof BusinessError;
}

/**
 * Nhận diện lỗi ràng buộc PostgreSQL. Mã lớp 23 = integrity_constraint_violation
 * (23505 unique, 23503 foreign key, 23514 check, 23502 not null).
 *
 * Nếu lỗi này chạm tới tầng ứng dụng, nghĩa là tầng service ĐÃ THIẾU một kiểm
 * tra — phải sửa chỗ đó, KHÔNG bọc try-catch cho êm (DCS-9 bẫy số 1).
 */
export function isDbConstraintError(
  e: unknown,
): e is { code: string; constraint_name?: string; message: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string' &&
    (e as { code: string }).code.startsWith('23')
  );
}

/** Tên ràng buộc bị vi phạm, nếu có — hữu ích cho log. */
export function dbConstraintName(e: unknown): string | null {
  if (isDbConstraintError(e) && 'constraint_name' in e) {
    return (e as { constraint_name?: string }).constraint_name ?? null;
  }
  return null;
}
