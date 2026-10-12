/**
 * src/domain/file-store.ts — lưu tệp PDF gốc NGOÀI cơ sở dữ liệu (DCS-5 §2.4).
 *
 * Tệp lưu trên đĩa (FILE_STORAGE_PATH), CSDL chỉ giữ file_path + file_hash
 * (SHA-256 tại thời điểm nạp, để kiểm toàn vẹn định kỳ — REQ-A08). 500 tệp ×
 * ~2 MB nhét vào CSDL sẽ làm sao lưu chậm và tốn bộ nhớ.
 *
 * Tệp gốc BẤT BIẾN (nguyên tắc số 2): ghi một lần, không ghi đè.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StoredFile {
  filePath: string;
  fileHash: string;
  sizeBytes: number;
}

/** Tính SHA-256 của một buffer. */
export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Lưu buffer tệp vào kho. Đường dẫn theo dạng năm/tháng/uuid.pdf để không dồn
 * mọi tệp vào một thư mục. Trả về đường dẫn tương đối (lưu vào CSDL) + hash.
 */
export async function storeFile(
  storageRoot: string,
  buf: Buffer,
  originalName: string,
): Promise<StoredFile> {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const ext = originalName.toLowerCase().endsWith('.pdf') ? '.pdf' : '';
  const relPath = join(yyyy, mm, `${randomUUID()}${ext}`);
  const absPath = join(storageRoot, relPath);

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, buf, { flag: 'wx' }); // wx: lỗi nếu đã tồn tại — bất biến

  return { filePath: absPath, fileHash: sha256(buf), sizeBytes: buf.length };
}
