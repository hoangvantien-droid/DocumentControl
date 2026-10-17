# Requirements Document

## Introduction

Tìm kiếm toàn văn hiện tại chỉ phủ phần nội dung đã bóc tách được thành mục. Luồng xử lý nội dung (`processVersionContent`) tách văn bản PDF thành các mục theo `HEADING_RE` ("6.2 Tần suất lưu mẫu") rồi nạp vào `document_sections`; `v_search_index` chỉ gộp `search_tsv` của `document_versions` (số hiệu, tiêu đề, phạm vi, từ khóa) với `search_tsv` của `document_sections` (tiêu đề mục + văn bản thô của mục). Mọi dòng thân tài liệu KHÔNG khớp `HEADING_RE` không bao giờ rơi vào một mục nào, nên không hề xuất hiện trong chỉ mục tìm kiếm. Người dùng gõ một cụm từ nằm ở đoạn giữa văn bản (không thuộc tiêu đề mục nào bóc được) sẽ không tìm ra tài liệu dù cụm từ đó có thật trong tài liệu.

Tính năng này bổ sung một nguồn chỉ mục toàn văn MỚI: hệ thống sinh Markdown từ dữ liệu đã bóc tách (các mục và văn bản đầy đủ) rồi đánh chỉ mục TOÀN BỘ thân tài liệu qua Markdown đó, bao gồm cả phần không khớp `HEADING_RE`. Mục tiêu là MỞ RỘNG độ phủ tìm kiếm toàn văn, không thay thế chỉ mục cấp tài liệu hoặc cấp mục hiện có.

Phạm vi áp dụng chỉ cho phiên bản được xử lý nội dung từ nay (phiên bản mới nộp, hoặc tài liệu cũ được xử lý lại qua chính luồng hiện có). Tính năng KHÔNG bao gồm job backfill theo lô cho kho tài liệu cũ.

Lựa chọn lưu trữ Markdown/chỉ mục (cột trong bảng so với tệp trên đĩa) được chốt ở pha Thiết kế; tài liệu yêu cầu này mô tả hành vi quan sát được, không ràng buộc cách lưu.

Nguồn nội dung được phân biệt theo đầu vào: PDF đã có lớp văn bản được đọc trực tiếp, KHÔNG chạy nhận dạng ký tự; chỉ tệp quét/ảnh (bị đánh dấu kém tin cậy do quá ít văn bản) mới chạy nhận dạng ký tự. Nhận dạng ký tự LUÔN chạy cục bộ, không gửi tài liệu ra dịch vụ hoặc API ngoài, vì môi trường nhà máy chặn truy cập Internet và tài liệu phải được giữ bảo mật. Engine nhận dạng ký tự được thiết kế thay thế được qua cấu hình, mặc định là Tesseract.

Markdown_Toàn_Văn được định dạng thân thiện cho truy vấn bằng AI về sau: kèm một khối metadata ngữ cảnh ở đầu tài liệu (frontmatter) để lớp AI hiểu ngữ cảnh và tính hiệu lực. Thiết kế dữ liệu phải sẵn sàng cho một máy chủ MCP trong tương lai (dữ liệu sạch, có metadata, truy vấn qua `fn_search`) nhưng tài liệu yêu cầu này KHÔNG bao gồm việc hiện thực máy chủ MCP, cũng không bao gồm anydoc hay các định dạng office (Word/Excel/PowerPoint) ngoài PDF.

## Glossary

- **DCS**: Hệ thống Kiểm soát Tài liệu (Document Control System), đối tượng của tài liệu yêu cầu này.
- **Trình_Xử_Lý_Nội_Dung**: Thành phần `processVersionContent` trong `src/domain/content.ts`, điều phối đọc PDF, bóc tách mục, phân đoạn và cập nhật trạng thái trong một transaction.
- **Bộ_Sinh_Markdown**: Thành phần mới sinh chuỗi Markdown của một phiên bản từ dữ liệu đã bóc tách (danh sách mục và văn bản đầy đủ), không đọc lại tệp PDF.
- **Phiên_Bản**: Một bản ghi trong bảng `document_versions`, đơn vị mang nội dung được xử lý và đánh chỉ mục.
- **Mục**: Một bản ghi `document_sections`, kết quả bóc tách theo `HEADING_RE`, thuộc một Phiên_Bản.
- **Văn_Bản_Đầy_Đủ**: Chuỗi `fullText` do bước bóc tách trả về (từ PDF hoặc từ văn bản OCR), gồm toàn bộ thân tài liệu kể cả phần không khớp `HEADING_RE`.
- **Markdown_Toàn_Văn**: Chuỗi Markdown đại diện toàn bộ thân một Phiên_Bản do Bộ_Sinh_Markdown tạo, dùng làm nguồn chỉ mục toàn văn.
- **Chỉ_Mục_Toàn_Văn**: Giá trị `tsvector` mới sinh từ Markdown_Toàn_Văn bằng `vn_tsv`, phủ toàn bộ thân tài liệu.
- **vn_tsv**: Hàm CSDL hiện có sinh `tsvector` bằng `to_tsvector('simple', vn_unaccent(...))`.
- **vn_unaccent**: Hàm CSDL hiện có bỏ dấu tiếng Việt trước khi phân tách token.
- **Nhánh_OCR**: Đường xử lý trong Trình_Xử_Lý_Nội_Dung khi tệp quét được nhận dạng ký tự rồi bóc tách lại từ văn bản nhận dạng.
- **PDF_Có_Lớp_Văn_Bản**: Tệp PDF mà `extractPdf` đọc được đủ văn bản, tức số ký tự trên mỗi trang không nhỏ hơn ngưỡng 50 trong `src/domain/extract.ts`.
- **PDF_Quét**: Tệp PDF bị `extractPdf` đánh dấu `kem_tin_cay` do số ký tự trên mỗi trang nhỏ hơn ngưỡng 50 trong `src/domain/extract.ts`, dấu hiệu tệp quét/ảnh chưa nhận dạng ký tự.
- **Engine_OCR**: Thành phần thực hiện nhận dạng ký tự theo một hợp đồng chung (interface/adapter) do Trình_Xử_Lý_Nội_Dung gọi, nhận tệp và trả về văn bản; có thể thay thế qua cấu hình mà không đổi luồng xử lý nội dung.
- **Engine_OCR_Mặc_Định**: Engine_OCR dùng Tesseract CLI qua `runTesseract` trong `src/domain/ocr.ts`, là engine được chọn khi không có cấu hình khác.
- **Cấu_Hình_Engine_OCR**: Biến môi trường chọn Engine_OCR dùng cho Trình_Xử_Lý_Nội_Dung.
- **Frontmatter_Ngữ_Cảnh**: Khối metadata ở đầu Markdown_Toàn_Văn gồm số hiệu tài liệu, tiêu đề, phiên bản, phạm vi, trạng thái hiệu lực, ngày và `doc_type`.
- **Máy_Chủ_MCP**: Máy chủ theo giao thức MCP cho phép tác nhân AI truy vấn DCS; nằm ngoài phạm vi tài liệu yêu cầu này.
- **Tài_Liệu_Dạng_Form**: Tài liệu có `doc_type = 'Form'`, chỉ giữ tiêu đề mục để hiển thị, không phân đoạn nội dung.
- **Tìm_Kiếm_Toàn_Văn**: Luồng tìm kiếm qua `fn_search` / `fn_search_limited`, chỉ dùng `search_tsv` và `pg_trgm`, không đọc `embedding`, không đọc `index_status`.

## Requirements

### Requirement 1: Mở rộng độ phủ tìm kiếm toàn văn tới thân tài liệu

**User Story:** Là người dùng tra cứu tài liệu, tôi muốn tìm ra tài liệu bằng một cụm từ nằm ở bất kỳ đoạn nào trong thân tài liệu, để không bị bỏ sót tài liệu chỉ vì cụm từ đó không nằm trong một tiêu đề mục bóc tách được.

#### Acceptance Criteria

1. WHEN một truy vấn Tìm_Kiếm_Toàn_Văn khớp một cụm từ nằm trong Văn_Bản_Đầy_Đủ của một Phiên_Bản đã có Chỉ_Mục_Toàn_Văn, THE DCS SHALL trả về Phiên_Bản đó trong kết quả.
2. WHEN một cụm từ xuất hiện trong thân một Phiên_Bản nhưng KHÔNG thuộc bất kỳ Mục nào bóc tách theo `HEADING_RE`, THE DCS SHALL vẫn trả về Phiên_Bản đó cho truy vấn khớp cụm từ đó nhờ Chỉ_Mục_Toàn_Văn.
3. THE DCS SHALL giữ nguyên các kết quả khớp ở cấp tài liệu (số hiệu, tiêu đề, phạm vi, từ khóa) và cấp mục đang có, đồng thời bổ sung kết quả khớp từ Chỉ_Mục_Toàn_Văn.

### Requirement 2: Sinh và lưu Chỉ_Mục_Toàn_Văn trong cùng luồng xử lý nội dung

**User Story:** Là người vận hành DCS, tôi muốn Chỉ_Mục_Toàn_Văn được tạo tự động trong cùng luồng xử lý nội dung hiện có, để không cần thao tác riêng cho mỗi phiên bản.

#### Acceptance Criteria

1. WHEN Trình_Xử_Lý_Nội_Dung xử lý một Phiên_Bản, THE Bộ_Sinh_Markdown SHALL sinh Markdown_Toàn_Văn từ các Mục đã bóc tách và Văn_Bản_Đầy_Đủ của Phiên_Bản đó.
2. THE Bộ_Sinh_Markdown SHALL sinh Markdown_Toàn_Văn chỉ từ dữ liệu đã bóc tách và KHÔNG đọc lại tệp PDF.
3. WHEN Trình_Xử_Lý_Nội_Dung sinh và lưu Chỉ_Mục_Toàn_Văn, THE DCS SHALL thực hiện trong cùng transaction với việc lưu Mục và cập nhật `parse_status`.
4. IF transaction của Trình_Xử_Lý_Nội_Dung không hoàn tất, THEN THE DCS SHALL không lưu Chỉ_Mục_Toàn_Văn của Phiên_Bản đó.
5. WHEN Trình_Xử_Lý_Nội_Dung chạy qua Nhánh_OCR, THE Bộ_Sinh_Markdown SHALL sinh Markdown_Toàn_Văn từ các Mục và Văn_Bản_Đầy_Đủ lấy từ văn bản OCR.

### Requirement 3: Xử lý lại nhất quán và tất định

**User Story:** Là người vận hành DCS, tôi muốn xử lý lại một phiên bản tạo ra Chỉ_Mục_Toàn_Văn nhất quán với lần xử lý trước, để kết quả tìm kiếm không phụ thuộc số lần chạy lại.

#### Acceptance Criteria

1. WHEN Trình_Xử_Lý_Nội_Dung chạy lại cho một Phiên_Bản đã có Chỉ_Mục_Toàn_Văn, THE DCS SHALL thay thế Chỉ_Mục_Toàn_Văn cũ bằng Chỉ_Mục_Toàn_Văn sinh từ dữ liệu bóc tách của lần chạy hiện tại.
2. WHEN hai lần xử lý liên tiếp dùng cùng Văn_Bản_Đầy_Đủ và cùng danh sách Mục, THE DCS SHALL tạo cùng một Chỉ_Mục_Toàn_Văn.

### Requirement 4: Giới hạn phạm vi chỉ phiên bản được xử lý từ nay

**User Story:** Là chủ sở hữu kho tài liệu, tôi muốn giữ nguyên phạm vi chỉ xử lý phiên bản từ nay, để tránh một lần chạy lớn trên ~500 tài liệu cũ.

#### Acceptance Criteria

1. THE DCS SHALL sinh Chỉ_Mục_Toàn_Văn cho một Phiên_Bản chỉ khi Phiên_Bản đó được Trình_Xử_Lý_Nội_Dung xử lý.
2. THE DCS SHALL không cung cấp job backfill theo lô để sinh Chỉ_Mục_Toàn_Văn cho các Phiên_Bản cũ chưa được xử lý lại.
3. WHILE một Phiên_Bản cũ chưa được Trình_Xử_Lý_Nội_Dung xử lý lại, THE DCS SHALL tiếp tục trả về Phiên_Bản đó trong Tìm_Kiếm_Toàn_Văn qua chỉ mục cấp tài liệu và cấp mục hiện có.

### Requirement 5: Độc lập lớp AI và nhất quán với cơ chế tìm kiếm hiện có

**User Story:** Là người bảo trì DCS, tôi muốn Tìm_Kiếm_Toàn_Văn vẫn độc lập với lớp AI và nhất quán với cơ chế tìm kiếm hiện có, để tìm kiếm chạy được cả khi lớp AI ngừng.

#### Acceptance Criteria

1. WHEN Trình_Xử_Lý_Nội_Dung sinh Chỉ_Mục_Toàn_Văn cho một Phiên_Bản không phải Tài_Liệu_Dạng_Form, THE DCS SHALL sinh Chỉ_Mục_Toàn_Văn bằng `vn_tsv` và `vn_unaccent` với cấu hình `'simple'`, nhất quán với các `search_tsv` hiện có.
2. WHEN DCS thực hiện Tìm_Kiếm_Toàn_Văn, THE DCS SHALL chỉ dựa trên `search_tsv` và `pg_trgm`, không đọc `embedding` và không đọc `index_status`.
3. WHILE lớp AI ngừng hoạt động, THE DCS SHALL vẫn trả về kết quả khớp từ Chỉ_Mục_Toàn_Văn.
4. THE DCS SHALL cung cấp một chỉ mục GIN trên `tsvector` của Chỉ_Mục_Toàn_Văn để truy vấn khớp toàn văn.
5. WHEN một truy vấn tiếng Việt không dấu khớp nội dung có dấu trong thân tài liệu, THE DCS SHALL trả về Phiên_Bản tương ứng nhờ `vn_unaccent`.

### Requirement 6: Form chỉ sinh Markdown tiêu đề, không đánh chỉ mục toàn văn thân

**User Story:** Là người cấu hình tài liệu, tôi muốn Tài_Liệu_Dạng_Form chỉ có Markdown tiêu đề mục để hiển thị mà không đánh chỉ mục toàn văn thân, để giữ đúng quy tắc không phân đoạn nội dung Form.

#### Acceptance Criteria

1. WHERE một Phiên_Bản là Tài_Liệu_Dạng_Form, THE Bộ_Sinh_Markdown SHALL sinh Markdown chỉ gồm tiêu đề các Mục để hiển thị.
2. WHERE một Phiên_Bản là Tài_Liệu_Dạng_Form, THE DCS SHALL không sinh Chỉ_Mục_Toàn_Văn cho thân tài liệu của Phiên_Bản đó.
3. WHERE một Phiên_Bản KHÔNG phải Tài_Liệu_Dạng_Form, THE DCS SHALL sinh Chỉ_Mục_Toàn_Văn phủ toàn bộ thân tài liệu.

### Requirement 7: Phân biệt đầu vào và chỉ nhận dạng ký tự khi cần

**User Story:** Là người vận hành DCS, tôi muốn hệ thống chỉ chạy nhận dạng ký tự với tệp quét, để PDF đã có lớp văn bản được xử lý nhanh và không tốn tài nguyên nhận dạng.

#### Acceptance Criteria

1. WHEN Trình_Xử_Lý_Nội_Dung xử lý một PDF_Có_Lớp_Văn_Bản, THE DCS SHALL lấy Văn_Bản_Đầy_Đủ từ văn bản đọc trực tiếp và SHALL không chạy Engine_OCR.
2. WHEN Trình_Xử_Lý_Nội_Dung xử lý một PDF_Quét không phải Tài_Liệu_Dạng_Form và có Cấu_Hình_Engine_OCR khả dụng, THE DCS SHALL chạy Engine_OCR rồi lấy Văn_Bản_Đầy_Đủ từ văn bản nhận dạng ký tự.
3. WHEN Trình_Xử_Lý_Nội_Dung chạy Engine_OCR, THE DCS SHALL thực hiện nhận dạng ký tự cục bộ và SHALL không gửi tệp tài liệu hoặc văn bản tài liệu tới dịch vụ hoặc API ngoài DCS.

### Requirement 8: Engine nhận dạng ký tự thay thế được qua cấu hình

**User Story:** Là người bảo trì DCS, tôi muốn đổi engine nhận dạng ký tự qua cấu hình mà không sửa luồng xử lý nội dung, để sau này cắm PaddleOCR hoặc worker VLM mà không phá vỡ xử lý hiện có.

#### Acceptance Criteria

1. THE DCS SHALL gọi nhận dạng ký tự qua hợp đồng chung của Engine_OCR nhận tệp đầu vào và trả về văn bản.
2. WHEN Cấu_Hình_Engine_OCR chọn một Engine_OCR khác, THE DCS SHALL dùng Engine_OCR được chọn mà không đổi hợp đồng giữa Trình_Xử_Lý_Nội_Dung và Engine_OCR.
3. WHERE Cấu_Hình_Engine_OCR không chỉ định Engine_OCR, THE DCS SHALL dùng Engine_OCR_Mặc_Định dựa trên Tesseract.

### Requirement 9: Markdown giàu metadata ngữ cảnh cho truy vấn AI

**User Story:** Là người xây dựng lớp truy vấn AI trên DCS, tôi muốn Markdown_Toàn_Văn kèm metadata ngữ cảnh, để tác nhân AI hiểu ngữ cảnh và tính hiệu lực của tài liệu khi truy vấn về sau.

#### Acceptance Criteria

1. WHEN Bộ_Sinh_Markdown sinh Markdown_Toàn_Văn cho một Phiên_Bản không phải Tài_Liệu_Dạng_Form, THE Bộ_Sinh_Markdown SHALL kèm Frontmatter_Ngữ_Cảnh gồm số hiệu tài liệu, tiêu đề, phiên bản, phạm vi, trạng thái hiệu lực, ngày và `doc_type`.
2. THE Bộ_Sinh_Markdown SHALL sinh Frontmatter_Ngữ_Cảnh từ dữ liệu đã có của Phiên_Bản và SHALL không phụ thuộc `embedding` hay `index_status`.
3. THE DCS SHALL giữ Markdown_Toàn_Văn và Chỉ_Mục_Toàn_Văn truy vấn được qua `fn_search`, cung cấp dữ liệu sạch và có metadata sẵn sàng cho Máy_Chủ_MCP trong tương lai.

## Out of Scope

Các hạng mục sau nằm ngoài phạm vi tài liệu yêu cầu này và được ghi lại làm hướng mở rộng tương lai:

- **anydoc và định dạng office**: Hỗ trợ bóc tách và đánh chỉ mục cho Word, Excel, PowerPoint và các định dạng ngoài PDF chưa được bao gồm.
- **Máy_Chủ_MCP**: Giao thức để tác nhân AI truy vấn DCS chưa được hiện thực. Thiết kế dữ liệu hiện tại chuẩn bị sẵn sàng (dữ liệu sạch, có metadata, truy vấn qua `fn_search`) nhưng việc dựng Máy_Chủ_MCP thuộc một spec riêng.
