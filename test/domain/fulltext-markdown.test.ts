/**
 * test/domain/fulltext-markdown.test.ts — property test cho buildFulltextMarkdown.
 *
 * Thuần, KHÔNG cần DB. Mỗi property chạy >=100 vòng với bộ sinh ngẫu nhiên tự
 * viết (dự án không có thư viện PBT). Kiểm chứng 4 property trong design.md.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildFulltextMarkdown, type FulltextMeta } from '../../src/domain/fulltext-markdown.js';
import { splitSections, type ExtractedSection } from '../../src/domain/extract.js';

const ROUNDS = 100;

// ---- Bộ sinh ngẫu nhiên đơn giản ----
function randInt(n: number): number { return Math.floor(Math.random() * n); }
function pick<T>(arr: T[]): T { return arr[randInt(arr.length)]!; }

const WORDS = ['muc', 'dich', 'pham', 'vi', 'trach', 'nhiem', 'quy', 'trinh', 'luu', 'mau', 'tan', 'suat', 'kiem', 'tra', 'bao', 'quan'];
function randWords(min: number, max: number): string {
  const n = min + randInt(max - min + 1);
  return Array.from({ length: n }, () => pick(WORDS)).join(' ');
}

/** Sinh fullText trộn dòng khớp HEADING_RE và dòng thường (gồm phần dư ngoài mục). */
function randFullText(): string {
  const lines: string[] = [];
  // Phần dư đầu file (trước mục đầu tiên) — có xác suất xuất hiện.
  if (randInt(2) === 0) lines.push(randWords(2, 6));
  const nSections = 1 + randInt(4);
  for (let i = 1; i <= nSections; i++) {
    lines.push(`${i}. ${randWords(1, 4)}`);           // dòng khớp HEADING_RE
    const nBody = randInt(3);
    for (let b = 0; b < nBody; b++) lines.push(randWords(2, 6)); // dòng thường
  }
  return lines.join('\n');
}

function randMeta(): FulltextMeta {
  return {
    docId: `SOP-${randInt(1000)}`,
    title: `Tieu de ${randWords(1, 3)}`,
    versionNo: `${1 + randInt(5)}.${randInt(10)}`,
    scope: randInt(3) === 0 ? null : `pham vi ${randWords(1, 2)}`,
    status: pick(['hieu_luc', 'da_dang_ky', 'cho_xac_nhan']),
    effectiveDate: randInt(3) === 0 ? null : `2026-0${1 + randInt(9)}-15`,
    docType: pick(['SOP', 'WI', 'Policy', 'External']),
  };
}

/** Token hoá nhất quán: tách theo ký tự không phải chữ/số, bỏ rỗng, lowercase. */
function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

describe('Feature: document-markdown-fulltext', () => {
  // Property 1: Độ phủ toàn văn cho non-Form. Validates: Requirements 1.2, 2.1, 6.3
  test('Property 1: Độ phủ toàn văn cho non-Form', () => {
    for (let r = 0; r < ROUNDS; r++) {
      const fullText = randFullText();
      const sections = splitSections(fullText);
      const meta = randMeta();
      const { fulltextSource } = buildFulltextMarkdown(meta, sections, fullText, false);
      assert.ok(fulltextSource !== null, 'non-Form phải có fulltextSource');
      const srcTokens = tokenize(fulltextSource!);
      for (const tok of tokenize(fullText)) {
        assert.ok(srcTokens.has(tok), `token "${tok}" của fullText phải có trong fulltextSource`);
      }
    }
  });

  // Property 2: Bộ_Sinh_Markdown tất định. Validates: Requirements 3.1, 3.2
  test('Property 2: Bộ_Sinh_Markdown tất định', () => {
    for (let r = 0; r < ROUNDS; r++) {
      const fullText = randFullText();
      const sections = splitSections(fullText);
      const meta = randMeta();
      const isForm = randInt(2) === 0;
      const a = buildFulltextMarkdown(meta, sections, fullText, isForm);
      const b = buildFulltextMarkdown(meta, sections, fullText, isForm);
      assert.equal(a.markdown, b.markdown);
      assert.equal(a.fulltextSource, b.fulltextSource);
    }
  });

  // Property 3: Form chỉ sinh tiêu đề, không chỉ mục thân. Validates: Requirements 6.1, 6.2
  test('Property 3: Form chỉ sinh tiêu đề, không chỉ mục thân', () => {
    for (let r = 0; r < ROUNDS; r++) {
      const nSections = 1 + randInt(4);
      const sections: ExtractedSection[] = [];
      const markers: string[] = [];
      for (let i = 1; i <= nSections; i++) {
        const marker = `MARKER${r}X${i}ZZ`; // token đánh dấu duy nhất trong rawText
        markers.push(marker);
        sections.push({ sectionCode: `${i}`, sectionTitle: `Tieu de ${i} ${randWords(1, 2)}`, orderNo: i, rawText: `noi dung ${marker}` });
      }
      const meta = randMeta();
      const { markdown, fulltextSource } = buildFulltextMarkdown(meta, sections, 'khong dung', true);
      assert.equal(fulltextSource, null, 'Form: fulltextSource phải null');
      for (const m of markers) assert.ok(!markdown.includes(m), `Form markdown KHÔNG được chứa rawText marker ${m}`);
      for (const s of sections) assert.ok(markdown.includes(s.sectionTitle), `Form markdown phải chứa tiêu đề ${s.sectionTitle}`);
    }
  });

  // Property 4: Frontmatter đầy đủ trường ngữ cảnh. Validates: Requirements 9.1, 9.2
  test('Property 4: Frontmatter đầy đủ trường ngữ cảnh', () => {
    for (let r = 0; r < ROUNDS; r++) {
      const fullText = randFullText();
      const sections = splitSections(fullText);
      const meta = randMeta();
      const { markdown } = buildFulltextMarkdown(meta, sections, fullText, false);
      assert.ok(markdown.includes('docId:'), 'thiếu docId');
      assert.ok(markdown.includes('title:'), 'thiếu title');
      assert.ok(markdown.includes('versionNo:'), 'thiếu versionNo');
      assert.ok(markdown.includes('scope:'), 'thiếu scope');
      assert.ok(markdown.includes('status:'), 'thiếu status');
      assert.ok(markdown.includes('effectiveDate:'), 'thiếu effectiveDate');
      assert.ok(markdown.includes('docType:'), 'thiếu docType');
      // Giá trị có mặt (các trường không null).
      assert.ok(markdown.includes(meta.docId), 'thiếu giá trị docId');
      assert.ok(markdown.includes(meta.versionNo), 'thiếu giá trị versionNo');
      assert.ok(markdown.includes(meta.docType), 'thiếu giá trị docType');
    }
  });
});
