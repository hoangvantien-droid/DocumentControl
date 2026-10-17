/**
 * src/domain/ocr-engine.ts — adapter OCR thay thế được qua cấu hình (Requirement 8).
 *
 * Mục tiêu: tách hợp đồng OCR khỏi hiện thực cụ thể để sau này thêm engine mới
 * (PaddleOCR, worker VLM...) chỉ là một `case` mới, không đụng `content.ts`.
 * Engine mặc định là Tesseract, chạy CỤC BỘ như tiến trình con — không HTTP/API
 * ngoài (Requirement 7.3). TesseractEngine chỉ ủy nhiệm `runTesseract` hiện có
 * trong `src/domain/ocr.ts` (giữ nguyên hàm đó).
 */
import { runTesseract, type OcrResult } from './ocr.js';

/** Hợp đồng OCR: nhận tệp + ngôn ngữ, trả văn bản. Cục bộ, không gọi API ngoài. */
export interface OcrEngine {
  run(filePath: string, lang?: string): Promise<OcrResult>;
}

/** Engine mặc định: Tesseract CLI (tiến trình rời), bọc runTesseract. */
export class TesseractEngine implements OcrEngine {
  constructor(private readonly tesseractPath: string) {}

  run(filePath: string, lang = 'vie+eng'): Promise<OcrResult> {
    // Chỉ ủy nhiệm runTesseract — vốn spawn tiến trình con CLI, không HTTP.
    return runTesseract(this.tesseractPath, filePath, lang);
  }
}

export interface OcrEngineConfig {
  /** Từ env OCR_ENGINE; mặc định 'tesseract'. */
  engine?: string;
  /** Từ config.tesseractPath. */
  tesseractPath: string;
}

/**
 * Chọn engine theo cấu hình. Tên rỗng/không nhận ra rơi vào `default` trả
 * Tesseract — KHÔNG ném lỗi, giữ hệ thống chạy được (Requirement 8.3).
 */
export function createOcrEngine(cfg: OcrEngineConfig): OcrEngine {
  const name = (cfg.engine ?? 'tesseract').toLowerCase();
  switch (name) {
    case 'tesseract':
    default:
      return new TesseractEngine(cfg.tesseractPath);
  }
}
