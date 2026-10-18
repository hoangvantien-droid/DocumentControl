-- 017_receipt_model.sql — Mô hình "bên nhận phản hồi" (receipt) thay lớp duyệt dept head.
--
-- BỐI CẢNH THAY ĐỔI (chốt với chủ sản phẩm):
--   Mô hình cũ: Author nộp -> Dept Head duyệt TRƯỚC khi ban hành -> người nhận
--   acknowledge đã đọc. Mô hình mới: nội dung đã phê duyệt OFFLINE bên ngoài;
--   Author đăng ký là BAN HÀNH THẲNG; các SITE nhận kiểm tra SAU ban hành
--   (chấp nhận / từ chối). Không còn lớp gác cổng ở nguồn.
--
-- NGUYÊN TẮC NỀN: doc_id + version_no là THỰC THỂ DUY NHẤT (một file, một hash)
-- xuyên suốt mọi site. Không có bản nội dung riêng theo site. "Sai khác giữa
-- các site" là khác PHẢN HỒI (chấp nhận/từ chối), không phải khác nội dung.
--
-- Chạy theo trình chạy src/db/migrate.ts: mỗi file một giao dịch, theo thứ tự
-- số. KHÔNG dùng IF NOT EXISTS (runner đã bỏ qua file đã chạy — idempotent ở
-- tầng runner), để lỗi trùng lộ ra sớm thay vì nuốt im lặng.

-- ============================================================
-- 1. Trạng thái vòng đời mới: thêm 'da_ban_hanh' cho document_versions.
--    'da_ban_hanh' = Author đăng ký xong, ban hành thẳng (chưa qua ai duyệt).
--    Giữ các trạng thái cũ trong CHECK để không vỡ dữ liệu/đường dẫn còn tham
--    chiếu trong giai đoạn chuyển đổi; Task 9 sẽ dọn các mã không còn dùng.
-- ============================================================
ALTER TABLE document_versions DROP CONSTRAINT IF EXISTS document_versions_status_check;
ALTER TABLE document_versions
  ADD CONSTRAINT document_versions_status_check CHECK (
    status IN (
      'cho_hoan_thien',   -- nháp chờ hoàn thiện
      'da_ban_hanh',      -- MỚI: Author đăng ký, ban hành thẳng
      'thu_hoi',          -- đã thu hồi
      'het_hieu_luc',     -- bị phiên bản mới thay thế
      -- --- các mã cũ, giữ tạm cho giai đoạn chuyển đổi (Task 9 dọn) ---
      'cho_xac_nhan', 'tu_choi', 'da_dang_ky', 'hieu_luc'
    )
  );

-- ============================================================
-- 2. document_receipt — mỗi dòng = (một phiên bản × một SITE nhận).
--    Đây là nơi ghi phạm vi áp dụng theo site (mỗi site một mốc apply_date) và
--    phản hồi của site. Thêm site sau = thêm dòng mới, KHÔNG đổi phiên bản.
--
--    Vì sao KHÔNG tái dùng document_site_rollout (migration 011): bảng rollout
--    phục vụ "áp dụng lệch pha theo lịch" (planned/applied, tạm hoãn) và đang
--    được catalog.ts dùng để lọc. Receipt là khái niệm khác: phản hồi
--    chấp nhận/từ chối kèm LOẠI lỗi (sai đăng ký / sai nội dung). Tách bảng để
--    không trộn hai vòng đời; rollout cũ gỡ dần ở các task sau.
-- ============================================================
CREATE TABLE document_receipt (
    receipt_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
    site_id         UUID NOT NULL REFERENCES org_site(site_id) ON DELETE RESTRICT,
    -- Khi ban hành hẹp tới một dept trong site: ghi dept đích để biết phạm vi
    -- hẹp; receipt vẫn do SITE phản hồi (đơn vị phản hồi là site).
    target_dept_id  UUID REFERENCES org_department(dept_id) ON DELETE RESTRICT,

    -- Ngày site này áp dụng — ghi khi chuyển sang chap_nhan. Mỗi site một mốc.
    apply_date      DATE,

    status          VARCHAR(15) NOT NULL DEFAULT 'cho_phan_hoi'
        CHECK (status IN ('cho_phan_hoi', 'chap_nhan', 'tu_choi')),

    -- Chỉ có nghĩa khi tu_choi. Hai loại xử lý khác nhau ở tầng nghiệp vụ:
    --   sai_dang_ky  -> Author sửa metadata tại chỗ (giữ phiên bản).
    --   sai_noi_dung -> Author thu hồi + ban hành phiên bản mới.
    response_type   VARCHAR(15)
        CHECK (response_type IN ('sai_dang_ky', 'sai_noi_dung')),
    response_note   TEXT,

    -- Người phản hồi (any-of: bất kỳ DC Site của site đó; người đầu quyết).
    responded_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
    responded_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Một site chỉ có MỘT receipt cho một phiên bản (thêm lại = cập nhật dòng cũ).
    CONSTRAINT uq_receipt_version_site UNIQUE (version_id, site_id),

    -- Từ chối bắt buộc có loại + lý do (ép ở DB, tầng domain kiểm tra TRƯỚC).
    CONSTRAINT chk_receipt_reject_type
        CHECK (status <> 'tu_choi' OR response_type IS NOT NULL),
    CONSTRAINT chk_receipt_reject_note
        CHECK (status <> 'tu_choi' OR coalesce(response_note, '') <> ''),

    -- Đã phản hồi (chấp nhận/từ chối) thì phải có người + mốc thời gian.
    CONSTRAINT chk_receipt_responded
        CHECK (status = 'cho_phan_hoi'
               OR (responded_by IS NOT NULL AND responded_at IS NOT NULL)),

    -- Chấp nhận thì phải ghi ngày áp dụng của site.
    CONSTRAINT chk_receipt_apply_date
        CHECK (status <> 'chap_nhan' OR apply_date IS NOT NULL)
);

CREATE INDEX idx_receipt_version ON document_receipt(version_id);
CREATE INDEX idx_receipt_site    ON document_receipt(site_id);
CREATE INDEX idx_receipt_status  ON document_receipt(status);
-- Hàng chờ phản hồi của một site: lọc nhanh các receipt chưa phản hồi.
CREATE INDEX idx_receipt_pending ON document_receipt(site_id) WHERE status = 'cho_phan_hoi';

-- ============================================================
-- 3. document_issue_report — report bất thường của Reader, lọc trước ở site.
--    Reader phát hiện bất thường -> tạo report (moi) -> DC Site thẩm định:
--      chuyen_phan_hoi -> DC Site chuyển thành từ chối receipt tới Author
--      bac_bo          -> đóng report kèm lý do (không phiền Author)
--    Report KHÔNG trực tiếp đổi trạng thái tài liệu/receipt — chỉ là tín hiệu
--    nội bộ trong site chờ DC Site thẩm định.
-- ============================================================
CREATE TABLE document_issue_report (
    report_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
    -- Site của người report — DC Site đúng site đó mới thẩm định.
    site_id         UUID NOT NULL REFERENCES org_site(site_id) ON DELETE RESTRICT,
    reported_by     UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    note            TEXT NOT NULL,

    status          VARCHAR(15) NOT NULL DEFAULT 'moi'
        CHECK (status IN ('moi', 'chuyen_phan_hoi', 'bac_bo')),

    reviewed_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    review_note     TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Report có mô tả bất thường (không cho rỗng).
    CONSTRAINT chk_report_note CHECK (coalesce(note, '') <> ''),
    -- Đã thẩm định (chuyển/bác bỏ) thì phải có người + mốc thời gian.
    CONSTRAINT chk_report_reviewed
        CHECK (status = 'moi'
               OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
    -- Bác bỏ bắt buộc kèm lý do (để Reader biết vì sao không chuyển).
    CONSTRAINT chk_report_reject_note
        CHECK (status <> 'bac_bo' OR coalesce(review_note, '') <> '')
);

CREATE INDEX idx_report_version ON document_issue_report(version_id);
CREATE INDEX idx_report_site    ON document_issue_report(site_id);
-- Hộp report của site: các report mới chờ DC Site thẩm định.
CREATE INDEX idx_report_new     ON document_issue_report(site_id) WHERE status = 'moi';
