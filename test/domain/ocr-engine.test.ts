/**
 * test/domain/ocr-engine.test.ts — kiểm thử factory chọn engine OCR (task 3.3).
 *
 * Thuần, KHÔNG cần DB. Xác nhận createOcrEngine luôn trả một OcrEngine hợp lệ:
 * mặc định là Tesseract; tên lạ không ném mà rơi về Tesseract (Requirement
 * 8.1, 8.2, 8.3).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createOcrEngine, TesseractEngine } from '../../src/domain/ocr-engine.js';

const TESS = '/usr/bin/tesseract';

describe('createOcrEngine — factory chọn engine OCR', () => {
  test('Không chỉ định engine -> TesseractEngine (Requirement 8.3)', () => {
    const engine = createOcrEngine({ tesseractPath: TESS });
    assert.ok(engine instanceof TesseractEngine);
  });

  test("engine='tesseract' -> đối tượng có phương thức run (Requirement 8.1, 8.2)", () => {
    const engine = createOcrEngine({ engine: 'tesseract', tesseractPath: TESS });
    assert.equal(typeof engine.run, 'function');
  });

  test('Tên engine lạ -> KHÔNG ném, trả Tesseract mặc định (Requirement 8.3)', () => {
    let engine;
    assert.doesNotThrow(() => {
      engine = createOcrEngine({ engine: 'khong-ton-tai', tesseractPath: TESS });
    });
    assert.ok(engine instanceof TesseractEngine);
  });
});
