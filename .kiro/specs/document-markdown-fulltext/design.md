# Design Document

## Overview

Tính năng này bổ sung **một nguồn chỉ mục tìm kiếm MỚI cấp phiên bản** phủ toàn bộ thân tài liệu, giải quyết lỗ hổng: mọi dòng thân KHÔNG khớp `HEADING_RE` (`src/domain/extract.ts`) không rơi vào `document_sections` nào nên không bao giờ xuất hiện trong `v_search_index`.

Cách tiếp cận bám sát mã nguồn hiện có:

1. Một **Bộ_Sinh_Markdown thuần** (`src/domain/fulltext-markdown.ts`) nhận `(meta, sections, fullText, isForm)` đã có trong `processVersionContent` và trả về Markdown_Toàn_Văn + nguồn chỉ mục. Hàm không đọc tệp PDF (Requirement 2.2).
2. Hai cột mới trên `document_versions`: `markdown_content TEXT` (Markdown_Toàn_Văn) và `fulltext_tsv tsvector` (Chỉ_Mục_Toàn_Văn) với **GIN index** (Requirement 5.4).
3. Điểm tích hợp nằm TRONG `sql.begin` của `processVersionContent`, ngay cạnh việc lưu `document_sections`/`document_chunks` và `UPDATE document_versions` (Requirement 2.3, 2.4).
4. `v_search_index` thêm một nhánh `UNION ALL` cấp phiên bản dùng `fulltext_tsv`; `fn_search`/`fn_search_limited` giữ nguyên thân, tự nhiên trả nguồn mới vì chúng chỉ đọc `si.search_tsv` từ view (Requirement 1.3, 5.2).
5. Một **OcrEngine adapter** (`src/domain/ocr-engine.ts`) bọc `runTesseract` hiện có, chọn qua factory theo cấu hình (Requirement 8).

Nguyên tắc xuyên suốt giữ đúng tinh thần hệ thống: tìm kiếm **độc lập lớp AI** (chỉ `search_tsv` + `pg_trgm`, không `embedding`, không `index_status`), chỉ mục sinh bằng `vn_tsv`/`vn_unaccent` cấu hình `'simple'` để nhất quán với các `search_tsv` sẵn có, và OCR chạy **cục bộ** như tiến trình con.

Ngôn ngữ ví dụ: **TypeScript** (ESM, `.js` import specifier) cho tầng domain và **SQL (PostgreSQL)** cho migration — đúng ngăn xếp phát hiện trong workspace (`postgres` 3.4.5, `node --test`, `unpdf`).

## Architecture

```
                         processVersionContent (src/domain/content.ts)
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             │                          │                           │
        extractPdf                 OcrEngine.run            buildFulltextMarkdown
      (src/domain/extract.ts)  (src/domain/ocr-engine.ts)  (src/domain/fulltext-markdown.ts)
             │                          │ (chỉ khi kem_tin_cay           │ (hàm THUẦN, không I/O)
             │                          │  & non-Form & engine)         │
             ▼                          ▼                               ▼
        ExtractResult ───────────► result (sections, fullText) ───► { markdown, fulltextSource }
                                        │                               │
                                        ▼ (TRONG cùng sql.begin)        │
                   ┌───────────────────────────────────────────────────┘
                   │  DELETE document_sections → INSERT sections/chunks
                   │  UPDATE document_versions SET parse_status, parse_note,
                   │         file_page_count,
                   │         markdown_content = <markdown>,
                   │         fulltext_tsv     = vn_tsv(<fulltextSource>)  -- NULL nếu Form
                   ▼
            document_versions (markdown_content, fulltext_tsv + GIN)
                   │
                   ▼
            v_search_index  (thêm nhánh UNION ALL match_level='fulltext')
                   │
                   ▼
            fn_search / fn_search_limited  (giữ nguyên thân)
                   │
                   ▼
            search() / suggest()  (src/domain/search.ts — không đổi)
```

Luồng dữ liệu không thay đổi hình dạng với lớp gọi phía trên: `search.ts` tiếp tục gọi `fn_search_limited` và nhận thêm hàng `match_level = 'fulltext'`.

## Components and Interfaces

### 1. Bộ_Sinh_Markdown — `src/domain/fulltext-markdown.ts` (mới, thuần)

Hàm thuần, tất định, **không nhận đường dẫn tệp và không làm I/O** (Requirement 2.2, 9.2). Nhận đúng dữ liệu đã có trong `processVersionContent`.

```typescript
import type { ExtractedSection } from './extract.js';

/** Metadata ngữ cảnh lấy từ document_versions + documents (đã truy vấn sẵn). */
export interface FulltextMeta {
  docId: string;          // documents.doc_id / document_versions.doc_id
  title: string;          // document_versions.title
  versionNo: string;      // document_versions.version_no
  scope: string | null;   // document_versions.scope
  status: string;         // document_versions.status (vd 'hieu_luc')
  effectiveDate: string | null; // document_versions.effective_date (ISO date)
  docType: string;        // documents.doc_type
}

export interface FulltextMarkdown {
  /** Markdown_Toàn_Văn đầy đủ — lưu vào document_versions.markdown_content. */
  markdown: string;
  /**
   * Nguồn văn bản để sinh Chỉ_Mục_Toàn_Văn (tsvector).
   * NULL với Tài_Liệu_Dạng_Form (Requirement 6.2). Non-Form: phủ TOÀN BỘ thân
   * kể cả phần không khớp HEADING_RE (Requirement 6.3).
   */
  fulltextSource: string | null;
}

export function buildFulltextMarkdown(
  meta: FulltextMeta,
  sections: ExtractedSection[],
  fullText: string,
  isForm: boolean,
): FulltextMarkdown;
```

Hành vi:

- **Frontmatter_Ngữ_Cảnh** (Requirement 9.1): khối YAML frontmatter ở đầu `markdown` cho **non-Form**, gồm đủ bảy trường `docId`, `title`, `versionNo`, `scope`, `status`, `effectiveDate`, `docType`.
- **Thân non-Form**: mỗi `ExtractedSection` thành một heading Markdown `## {sectionCode} {sectionTitle}` theo sau bởi `rawText`.
- **Phần dư ngoài mục** (Requirement 1.2, 6.3): phần của `fullText` KHÔNG thuộc mục nào không được để rơi khỏi chỉ mục. Thiết kế chốt: **`fulltextSource` của non-Form = `fullText` nối thêm `sectionTitle` của các mục** (để tiêu đề mục cũng vào chỉ mục toàn văn). Vì `fullText` do bước bóc tách trả về chứa toàn bộ thân tài liệu (gồm cả dòng không khớp `HEADING_RE`), mọi token thân đều vào `fulltext_tsv`. `markdown` (bản hiển thị/MCP) và `fulltextSource` (nguồn index) tách biệt: `markdown` có cấu trúc heading đẹp, `fulltextSource` tối ưu độ phủ.
- **Form** (Requirement 6.1, 6.2): `markdown` chỉ gồm frontmatter tối giản + danh sách `- {sectionCode} {sectionTitle}` (chỉ tiêu đề, KHÔNG `rawText`); `fulltextSource = null`.
- **Tất định** (Requirement 3.2): cùng đầu vào luôn cho cùng chuỗi — không `Date.now()`, không `randomUUID`, không thứ tự không ổn định (giữ nguyên thứ tự `sections`).

### 2. OcrEngine adapter — `src/domain/ocr-engine.ts` (mới)

Hợp đồng chung thay thế được qua cấu hình (Requirement 8.1, 8.2). TesseractEngine bọc `runTesseract` hiện có trong `src/domain/ocr.ts` (giữ nguyên hàm đó).

```typescript
import { runTesseract, type OcrResult } from './ocr.js';

/** Hợp đồng OCR: nhận tệp + ngôn ngữ, trả văn bản. Cục bộ, không gọi API ngoài. */
export interface OcrEngine {
  run(filePath: string, lang?: string): Promise<OcrResult>;
}

/** Engine mặc định: Tesseract CLI (tiến trình rời), bọc runTesseract. */
export class TesseractEngine implements OcrEngine {
  constructor(private readonly tesseractPath: string) {}
  run(filePath: string, lang = 'vie+eng'): Promise<OcrResult> {
    return runTesseract(this.tesseractPath, filePath, lang);
  }
}

export interface OcrEngineConfig {
  engine?: string;       // từ env OCR_ENGINE; mặc định 'tesseract'
  tesseractPath: string; // từ config.tesseractPath
}

/** Chọn engine theo cấu hình. Không cấu hình -> Tesseract (Requirement 8.3). */
export function createOcrEngine(cfg: OcrEngineConfig): OcrEngine {
  const name = (cfg.engine ?? 'tesseract').toLowerCase();
  switch (name) {
    case 'tesseract':
    default:
      return new TesseractEngine(cfg.tesseractPath);
  }
}
```

- **Cục bộ** (Requirement 7.3): `TesseractEngine` chỉ ủy nhiệm `runTesseract` — vốn `spawn` tiến trình con CLI, không HTTP/fetch. Interface không có khái niệm endpoint.
- Factory mặc định trả Tesseract khi `engine` rỗng/không nhận ra — không ném lỗi, giữ hệ thống chạy được. Thêm engine tương lai (PaddleOCR, worker VLM) chỉ là một `case` mới trả đối tượng cùng `OcrEngine`, không đổi hợp đồng với `content.ts`.

Cấu hình mới trong `src/config.ts`: thêm `ocrEngine: string` đọc từ `env.OCR_ENGINE ?? 'tesseract'`. Giữ `tesseractPath` như cũ.

### 3. Điểm tích hợp — `src/domain/content.ts` (sửa)

`processVersionContent` đã có sẵn `meta` (truy vấn `file_path`, `doc_type`), `isForm`, và `result` (gồm `sections` + `fullText`, sau khi có thể bị thay bằng `ocrResult` ở Nhánh_OCR). Thay đổi:

1. **Dùng OcrEngine thay gọi trực tiếp `runTesseract`** (Requirement 8.1). Nhận engine qua `opts`:
   ```typescript
   opts: { tesseractPath?: string; ocrEngine?: OcrEngine } = {}
   ```
   Trong Nhánh_OCR, thay `runTesseract(opts.tesseractPath, meta.file_path)` bằng:
   ```typescript
   const engine = opts.ocrEngine ?? (opts.tesseractPath ? new TesseractEngine(opts.tesseractPath) : null);
   if (result.parseStatus === 'kem_tin_cay' && !isForm && engine) {
     const ocr = await engine.run(meta.file_path);
     // ... phần xây ocrResult giữ nguyên như hiện tại
   }
   ```
   `src/jobs/ocr-worker.ts` truyền `ocrEngine: createOcrEngine({ engine: config.ocrEngine, tesseractPath: config.tesseractPath })`. Tính chất **tiến trình rời** của OCR không đổi (`src/jobs/ocr-worker.ts` chạy mỗi lần một tệp rồi thoát).

2. **Lấy thêm `doc_type`, `title`, `version_no`, `scope`, `status`, `effective_date` cho frontmatter** (Requirement 9.1). Mở rộng truy vấn `meta` đầu hàm:
   ```sql
   SELECT v.file_path, v.title, v.version_no, v.scope, v.status, v.effective_date,
          v.doc_id, d.doc_type
     FROM document_versions v JOIN documents d ON d.doc_id = v.doc_id
    WHERE v.version_id = ${versionId}
   ```

3. **Sinh + lưu TRONG cùng transaction** (Requirement 2.3, 2.4). Sau vòng lặp `INSERT` sections/chunks, trước/cùng `UPDATE document_versions`:
   ```typescript
   const fm = buildFulltextMarkdown(
     { docId: meta.doc_id, title: meta.title, versionNo: meta.version_no,
       scope: meta.scope, status: meta.status,
       effectiveDate: meta.effective_date, docType: meta.doc_type },
     result.sections, result.fullText, isForm,
   );

   await tx`
     UPDATE document_versions
        SET parse_status = ${result.parseStatus}, parse_note = ${result.parseNote},
            file_page_count = ${result.pageCount},
            markdown_content = ${fm.markdown},
            fulltext_tsv = CASE WHEN ${fm.fulltextSource}::text IS NULL
                                THEN NULL
                                ELSE vn_tsv(${fm.fulltextSource}) END
      WHERE version_id = ${versionId}`;
   ```
   Vì lệnh này nằm trong `sql.begin`, nếu transaction rollback thì `markdown_content`/`fulltext_tsv` không được lưu (Requirement 2.4). `UPDATE` ghi đè giá trị cũ nên **chạy lại là thay thế, idempotent** (Requirement 3.1); `DELETE document_sections` hiện có đã xoá mục cũ. **Không parse lại PDF** — chỉ đọc `result` sẵn có (Requirement 2.2).

### 4. Tầng tìm kiếm — `src/domain/search.ts` (không đổi)

`search()`/`suggest()` gọi `fn_search_limited` và nhận thêm hàng `match_level = 'fulltext'`. `SearchHit.match_level` đã là `string`, không cần sửa kiểu. Snippet cho nhánh fulltext KHÔNG do `search.ts` tính: nó đến từ biểu thức `left(coalesce(v.markdown_content,''), 200)` định nghĩa trong nhánh `UNION ALL` của `v_search_index` (phần Migration bên dưới), nên `search.ts` giữ nguyên, chỉ đọc thêm hàng mới qua view.

## Data Models

### Cột mới trên `document_versions`

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `markdown_content` | `TEXT` NULL | Markdown_Toàn_Văn do Bộ_Sinh_Markdown tạo (hiển thị + sẵn sàng MCP). |
| `fulltext_tsv` | `tsvector` NULL | Chỉ_Mục_Toàn_Văn. NULL với Form hoặc phiên bản cũ chưa xử lý lại. |

Kèm `CREATE INDEX ... USING GIN (fulltext_tsv)` (Requirement 5.4).

### Quyết định lưu trữ — Chốt phương án A (cột trong `document_versions`)

**Phương án A (chọn):** thêm `markdown_content TEXT` + `fulltext_tsv tsvector` vào `document_versions`.

**Phương án B (loại):** lưu tệp `.md` trên đĩa cạnh `file_path`, chỉ giữ `tsvector` trong DB.

Lý do chọn A:

- **Nhất quán mẫu sẵn có**: `document_sections.raw_text`, `document_chunks.content` và các `search_tsv` đều là văn bản/tsvector trong DB. Thêm cột đi đúng khuôn mẫu, không tạo lớp lưu trữ thứ hai.
- **Backup theo DB**: sao lưu một nguồn. Phương án B buộc đồng bộ vòng đời tệp `.md` với bản ghi (xoá phiên bản, chạy lại, rollback transaction) trên **máy ~1GB không Docker** — thêm điểm hỏng và rủi ro lệch dữ liệu.
- **TOAST tự nén**: PostgreSQL tự chuyển cột `TEXT`/`tsvector` lớn sang TOAST và nén LZ, nên Markdown vài trăm KB không phình bảng chính. Với kho ~500 tài liệu, tổng dung lượng nằm trong tầm kiểm soát và nằm gọn trong backup DB.
- **Nguyên tử**: cột trong `document_versions` cập nhật ngay trong `sql.begin` của `processVersionContent`, thoả Requirement 2.4 miễn phí. Tệp trên đĩa không thuộc transaction DB nên khó đảm bảo "không hoàn tất thì không lưu".

### Cột thường + set tường minh trong transaction (không dùng GENERATED STORED)

`search_tsv` hiện có là `GENERATED ALWAYS AS (vn_tsv(...)) STORED` vì nguồn là **các cột sẵn có cùng bảng** (`title`, `scope`, `keywords`, `raw_text`). Ở đây nguồn chỉ mục là **Markdown sinh ở tầng app** (hợp nhất `fullText` + tiêu đề mục, có nhánh Form/non-Form), KHÔNG phải một cột sẵn có.

Hai lựa chọn kỹ thuật:

1. `fulltext_tsv` là cột thường, set tường minh `vn_tsv(fulltextSource)` trong transaction. **Chọn phương án này.** Cho phép logic Form (NULL) vs non-Form (phủ toàn thân + tiêu đề mục) và giữ `markdown_content` (bản hiển thị) khác `fulltextSource` (nguồn index). Idempotent nhờ `UPDATE` ghi đè.
2. `fulltext_tsv GENERATED ALWAYS AS (vn_tsv(markdown_content)) STORED`: đơn giản nhưng buộc nguồn index **đúng bằng** `markdown_content` và không thể để NULL có điều kiện cho Form (cột generated không phân biệt Form). Loại vì mất tính linh hoạt Form/non-Form và ép chỉ mục trùng khít bản hiển thị.

### Tương thích phiên bản cũ (Requirement 4.3)

Cột NULL mặc định. Phiên bản cũ chưa chạy lại có `fulltext_tsv = NULL` ⇒ nhánh `UNION ALL` fulltext **không sinh hàng** cho chúng (lọc `WHERE v.fulltext_tsv IS NOT NULL`), nhưng nhánh `document` và `section` của `v_search_index` vẫn chạy nguyên vẹn ⇒ phiên bản cũ vẫn tìm được qua chỉ mục cấp tài liệu và cấp mục. Không có job backfill (Requirement 4.1, 4.2).

### Migration mới — `src/db/migrations/016_fulltext_markdown.sql`

Theo trình chạy `src/db/migrate.ts` (mỗi file một transaction, chạy theo thứ tự số). Nội dung:

```sql
-- 016_fulltext_markdown.sql — chỉ mục toàn văn cấp phiên bản.

ALTER TABLE document_versions
  ADD COLUMN markdown_content TEXT,
  ADD COLUMN fulltext_tsv     tsvector;

CREATE INDEX idx_docver_fulltext_tsv
  ON document_versions USING GIN (fulltext_tsv);

-- Thay view để thêm nguồn fulltext cấp phiên bản. Giữ nguyên hai nhánh cũ.
-- fn_search/fn_search_limited KHÔNG đổi: chúng chỉ đọc si.search_tsv từ view.
CREATE OR REPLACE VIEW v_search_index AS
SELECT v.version_id, v.doc_id, v.version_no, v.title, v.status,
       v.effective_date, v.next_review_date, v.owner_department_id,
       d.doc_type, d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id,
       NULL::VARCHAR(30)  AS section_code,
       NULL::VARCHAR(300) AS section_title,
       NULL::TEXT         AS snippet,
       'document'::TEXT   AS match_level,
       v.search_tsv
  FROM document_versions v
  JOIN documents d ON d.doc_id = v.doc_id
UNION ALL
SELECT v.version_id, v.doc_id, v.version_no, v.title, v.status,
       v.effective_date, v.next_review_date, v.owner_department_id,
       d.doc_type, d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id,
       s.section_code, s.section_title, left(coalesce(s.raw_text,''), 200),
       'section'::TEXT,
       s.search_tsv
  FROM document_sections s
  JOIN document_versions v ON v.version_id = s.version_id
  JOIN documents d ON d.doc_id = v.doc_id
UNION ALL
-- NGUON MOI: chi muc toan van cap phien ban. Chi hang co fulltext_tsv.
SELECT v.version_id, v.doc_id, v.version_no, v.title, v.status,
       v.effective_date, v.next_review_date, v.owner_department_id,
       d.doc_type, d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id,
       NULL::VARCHAR(30)  AS section_code,
       NULL::VARCHAR(300) AS section_title,
       left(coalesce(v.markdown_content,''), 200),
       'fulltext'::TEXT   AS match_level,
       v.fulltext_tsv     AS search_tsv
  FROM document_versions v
  JOIN documents d ON d.doc_id = v.doc_id
 WHERE v.fulltext_tsv IS NOT NULL;
```

Vì `CREATE OR REPLACE VIEW` không đổi danh sách/kiểu cột, `fn_search` (đọc `si.search_tsv`, `si.match_level`, `si.snippet`) tiếp tục chạy không sửa và tự trả nguồn mới (Requirement 1.3). Nhánh mới dùng `vn_tsv` ⇒ không dấu khớp có dấu nhờ `vn_unaccent` (Requirement 5.1, 5.5). Không đụng `embedding`/`index_status` (Requirement 5.2).

### Sẵn sàng MCP (Requirement 9.3, không implement)

`markdown_content` là dữ liệu sạch, có frontmatter metadata; truy vấn qua `fn_search` đã trả `match_level='fulltext'` cùng `version_id`. Máy_Chủ_MCP tương lai đọc trực tiếp `document_versions.markdown_content` + gọi `fn_search` để truy hồi — **không thuộc phạm vi spec này**, không thêm endpoint/giao thức MCP nào ở đây.

## Error Handling

- **Thiếu dữ liệu meta**: giữ hành vi hiện có — `meta` không tồn tại thì ném `'Không tìm thấy phiên bản để xử lý nội dung'` trước khi vào transaction.
- **OCR thất bại** (`ocr.ok === false` hoặc văn bản rỗng): giữ nguyên nhánh hiện tại — `result` không bị thay, Bộ_Sinh_Markdown sinh từ `fullText` của `extractPdf` (có thể rỗng). Không ném, không chặn hiệu lực (đúng DCS-2 mục 4.6).
- **`fulltextSource` rỗng chuỗi vs NULL**: Form luôn NULL. Non-Form với `fullText` rỗng cho `fulltext_tsv` = `vn_tsv('')` (tsvector rỗng, không khớp gì) — chấp nhận được, không gây lỗi.
- **Rollback transaction** (Requirement 2.4): mọi thay đổi gồm `markdown_content`/`fulltext_tsv` nằm trong `sql.begin`, lỗi bất kỳ ⇒ không lưu gì.
- **Factory OCR**: giá trị `OCR_ENGINE` lạ ⇒ rơi vào `default` trả Tesseract, không ném (hệ thống vẫn chạy).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Độ phủ toàn văn cho non-Form

*For any* phiên bản KHÔNG phải Tài_Liệu_Dạng_Form với `fullText` và danh sách `sections` bất kỳ, mọi token xuất hiện trong `fullText` (bao gồm cả các dòng không khớp `HEADING_RE`) đều xuất hiện trong `fulltextSource` do `buildFulltextMarkdown` trả về.

**Validates: Requirements 1.2, 2.1, 6.3**

### Property 2: Bộ_Sinh_Markdown tất định

*For any* bộ đầu vào `(meta, sections, fullText, isForm)`, hai lần gọi `buildFulltextMarkdown` liên tiếp trên cùng đầu vào trả về `markdown` và `fulltextSource` giống hệt nhau.

**Validates: Requirements 3.1, 3.2**

### Property 3: Form chỉ sinh tiêu đề, không chỉ mục thân

*For any* Tài_Liệu_Dạng_Form với danh sách `sections` bất kỳ, kết quả `buildFulltextMarkdown` có `fulltextSource === null` và `markdown` chứa mọi `sectionTitle` nhưng KHÔNG chứa `rawText` của bất kỳ mục nào.

**Validates: Requirements 6.1, 6.2**

### Property 4: Frontmatter đầy đủ trường ngữ cảnh

*For any* phiên bản không phải Form, `markdown` do `buildFulltextMarkdown` sinh chứa đầy đủ bảy trường Frontmatter_Ngữ_Cảnh: số hiệu tài liệu, tiêu đề, phiên bản, phạm vi, trạng thái hiệu lực, ngày và `doc_type`.

**Validates: Requirements 9.1, 9.2**

## Testing Strategy

Dùng `node:test` + `node:assert/strict` (đúng cấu hình `package.json`: `node --import tsx --test`). Hai lớp test bổ sung nhau: property test cho hàm thuần, integration/example/smoke cho phần DB và cấu hình.

### Property tests — `test/domain/fulltext-markdown.test.ts` (thuần, không DB)

Mỗi property chạy tối thiểu 100 vòng với bộ sinh ngẫu nhiên tự viết (không có thư viện PBT trong `package.json`; dùng vòng lặp + sinh dữ liệu đơn giản). Tag theo mẫu **Feature: document-markdown-fulltext, Property {n}: {text}**.

- **Property 1 — độ phủ**: sinh `fullText` gồm trộn dòng khớp `HEADING_RE` ("6.2 Tiêu đề") và dòng KHÔNG khớp (đoạn văn thường, câu ngẫu nhiên); `sections = splitSections(fullText)`. Khẳng định token hoá `fullText` ⊆ token hoá `fulltextSource`. Bao gồm trường hợp có phần dư ngoài mục (đoạn đầu file trước mục đầu tiên) và trường hợp không có phần dư.
- **Property 2 — tất định**: sinh đầu vào ngẫu nhiên (cả Form và non-Form), gọi hai lần, `assert.equal` từng trường.
- **Property 3 — Form**: sinh `sections` với `rawText` chứa một token "đánh dấu" duy nhất không trùng tiêu đề; khẳng định `fulltextSource === null` và token đánh dấu không có trong `markdown`, trong khi mọi `sectionTitle` đều có.
- **Property 4 — frontmatter**: sinh `meta` ngẫu nhiên (non-Form); khẳng định `markdown` chứa `docId`, `title`, `versionNo`, `scope`, `status`, `effectiveDate`, `docType`.

### Unit / example tests — OCR factory (`test/domain/ocr-engine.test.ts`)

- `createOcrEngine({ tesseractPath })` (không có `engine`) trả về `instanceof TesseractEngine` (Requirement 8.3).
- `createOcrEngine({ engine: 'tesseract', tesseractPath })` trả đối tượng có phương thức `.run` (hợp đồng chung, Requirement 8.1, 8.2).
- `createOcrEngine({ engine: 'khong-ton-tai', tesseractPath })` không ném, trả Tesseract mặc định.

### Integration tests — tìm kiếm + điểm tích hợp (`test/domain/fulltext-search.test.ts`, cần DB)

Theo mẫu test cần DB sẵn có (dùng `getSql`, seed rồi dọn). Mỗi test 1–3 ví dụ:

- **Khớp thân ngoài mục** (Requirement 1.1, 1.2): seed một `document_versions` với `markdown_content` + `fulltext_tsv = vn_tsv(...)` chứa cụm từ nằm ở đoạn KHÔNG thuộc mục; gọi `fn_search`; khẳng định trả về `version_id` với `match_level='fulltext'`.
- **Không hồi quy + bổ sung** (Requirement 1.3): cùng dữ liệu, khớp số hiệu và khớp tiêu đề mục vẫn trả về; nguồn fulltext là bổ sung.
- **Tương thích phiên bản cũ** (Requirement 4.3): seed phiên bản có `fulltext_tsv = NULL`; khớp số hiệu/tiêu đề mục vẫn ra; không có hàng fulltext.
- **Không dấu khớp có dấu** (Requirement 5.5): seed thân có dấu, tìm bằng truy vấn không dấu, khẳng định trả về.
- **Nhất quán `vn_tsv`** (Requirement 5.1): khẳng định `fulltext_tsv = vn_tsv(markdown_or_source)` trong DB.
- **Idempotent chạy lại** (Requirement 3.1): gọi `processVersionContent` hai lần cho cùng phiên bản (với `extract`/engine giả trả cùng dữ liệu); khẳng định `markdown_content`/`fulltext_tsv` cuối cùng không đổi và `document_sections` không nhân đôi.
- **Nhánh OCR dùng engine giả** (Requirement 2.5, 7.1, 7.2): truyền `ocrEngine` giả. (a) Khi `extractPdf` giả trả `thanh_cong`, engine.run KHÔNG được gọi. (b) Khi trả `kem_tin_cay` + non-Form, engine.run được gọi và `markdown_content` chứa văn bản OCR.

### Smoke / review (không chạy 100 vòng)

- Chữ ký `buildFulltextMarkdown` không nhận `filePath`, không async I/O (Requirement 2.2).
- `content.ts` gọi `engine.run(...)` thay vì `runTesseract` trực tiếp (Requirement 8.1).
- `TesseractEngine` chỉ ủy nhiệm `runTesseract` (spawn cục bộ), không HTTP (Requirement 7.3).
- Migration tạo GIN index trên `fulltext_tsv` (Requirement 5.4); `fn_search` không tham chiếu `embedding`/`index_status` (Requirement 5.2).
- Không có job/endpoint backfill (Requirement 4.1, 4.2).
