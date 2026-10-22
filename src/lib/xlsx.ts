/**
 * src/lib/xlsx.ts — bộ dựng workbook .xlsx dùng chung (DCS catalog-excel-export §1).
 *
 * Trừu tượng hóa quanh `exceljs`: mô tả cột theo khai báo (header + hàm trích
 * giá trị từ row), dựng workbook một sheet, và stream ra `FastifyReply`. Không
 * chứa tri thức nghiệp vụ về danh mục hay "tài liệu của tôi" — chỉ thuần
 * "column-definitions + rows → workbook → reply".
 */
import type { FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';

/** Mô tả một cột: tiêu đề hiển thị + cách lấy giá trị ô từ một dòng dữ liệu. */
export interface ColumnDef<Row> {
  header: string;
  /** Trả về giá trị ô. Null/undefined được chuẩn hóa thành chuỗi rỗng. */
  value: (row: Row) => string | number | null | undefined;
  /** Độ rộng cột gợi ý (tùy chọn). */
  width?: number;
}

/** Dựng workbook một sheet từ định nghĩa cột + danh sách dòng. */
export function buildWorkbook<Row>(
  columns: readonly ColumnDef<Row>[],
  rows: readonly Row[],
  sheetName = 'Export',
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  // Hàng tiêu đề luôn được ghi, kể cả khi rows rỗng → workbook rỗng-ish vẫn hợp lệ.
  ws.addRow(columns.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    ws.addRow(columns.map((c) => normalizeCell(c.value(row))));
  }
  columns.forEach((c, i) => {
    if (c.width) ws.getColumn(i + 1).width = c.width;
  });
  return wb;
}

function normalizeCell(v: string | number | null | undefined): string | number {
  return v === null || v === undefined ? '' : v;
}

/** Tên tệp theo quy ước: {prefix}-YYYYMMDD-HHmmss.xlsx (giờ máy chủ). */
export function exportFileName(prefix: string, at: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`
    + `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `${prefix}-${ts}.xlsx`;
}

/** Đặt header .xlsx chuẩn và stream workbook ra reply. */
export async function streamXlsx(
  reply: FastifyReply,
  workbook: ExcelJS.Workbook,
  fileName: string,
): Promise<void> {
  reply.header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
  // Ghi trực tiếp ra luồng của reply (reply.raw) để tránh đệm toàn bộ trong RAM.
  await workbook.xlsx.write(reply.raw);
  reply.raw.end();
}
