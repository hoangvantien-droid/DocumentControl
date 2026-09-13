/**
 * src/domain/ocr.ts — nhận dạng ký tự chạy như tiến trình RỜI (T-046, DCS-8 §1.2).
 *
 * Tesseract xử lý một trang A4 có thể ngốn 300-500 MB. Nếu chạy trong tiến trình
 * máy chủ web thì máy 1 GB sẽ bị hệ điều hành giết. Chạy như tiến trình con rồi
 * thoát -> hệ điều hành thu hồi sạch. Mỗi lần MỘT tệp (cờ ocr_batch_only).
 *
 * Đây là hàm gọi CLI; trình chạy OCR theo lô (đọc hàng đợi) là jobs/ocr-worker.
 */
import { spawn } from 'node:child_process';

export interface OcrResult {
  ok: boolean;
  text: string;
  error?: string;
}

/**
 * Chạy tesseract trên một tệp ảnh/PDF, trả về văn bản. tesseractPath từ config.
 * Ngôn ngữ vie+eng cho tài liệu tiếng Việt.
 */
export function runTesseract(
  tesseractPath: string,
  inputPath: string,
  lang = 'vie+eng',
): Promise<OcrResult> {
  return new Promise((resolve) => {
    // "stdout" để tesseract in kết quả ra stdout thay vì tệp.
    const proc = spawn(tesseractPath, [inputPath, 'stdout', '-l', lang], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, text: '', error: e.message }));
    proc.on('close', (code) => {
      if (code === 0) resolve({ ok: true, text: out });
      else resolve({ ok: false, text: out, error: err || `tesseract thoát mã ${code}` });
    });
  });
}
