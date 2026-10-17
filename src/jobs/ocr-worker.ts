/**
 * src/jobs/ocr-worker.ts — trình xử lý nội dung theo lô, chạy RỜI (T-046).
 *
 * Chạy qua cron hệ điều hành ngoài giờ, MỖI LẦN MỘT TỆP rồi thoát để trả bộ
 * nhớ (cờ ocr_batch_only, DCS-5 §1.3). Xử lý các phiên bản chưa bóc tách:
 * parse_status='chua_chay'. Với tệp quét (kém tin cậy) sẽ chạy tesseract trước
 * khi bóc tách — phần OCR-then-extract để lại khi có tệp thật; hiện xử lý PDF
 * văn bản qua processVersionContent.
 */
import { loadConfig } from '../config.js';
import { getSql, closeSql } from '../db/client.js';
import { processVersionContent } from '../domain/content.js';
import { createOcrEngine } from '../domain/ocr-engine.js';

const BATCH_LIMIT = 1; // mỗi lần một tệp trên máy 1 GB

export async function runOcrBatch(): Promise<{ processed: string[] }> {
  const config = loadConfig();
  const sql = getSql(config);

  const pending = await sql<{ version_id: string }[]>`
    SELECT version_id FROM document_versions
     WHERE parse_status = 'chua_chay'
     ORDER BY submitted_at NULLS LAST
     LIMIT ${BATCH_LIMIT}`;

  // Tạo engine OCR một lần ngoài vòng lặp theo cấu hình (mặc định Tesseract,
  // chạy cục bộ như tiến trình con). Tính chất tiến trình rời giữ nguyên:
  // worker vẫn xử lý mỗi lần một tệp rồi thoát (BATCH_LIMIT=1).
  const ocrEngine = createOcrEngine({
    engine: config.ocrEngine,
    tesseractPath: config.tesseractPath,
  });

  const processed: string[] = [];
  for (const p of pending) {
    await processVersionContent(sql, p.version_id, { ocrEngine });
    processed.push(p.version_id);
  }
  return { processed };
}

if (process.argv[1]?.endsWith('ocr-worker.ts') || process.argv[1]?.endsWith('ocr-worker.js')) {
  runOcrBatch()
    .then((r) => { console.log(`OCR/bóc tách xong: ${r.processed.length} tệp`); return closeSql(); })
    .then(() => process.exit(0))
    .catch((err) => { console.error('OCR worker lỗi:', err); closeSql().finally(() => process.exit(1)); });
}
