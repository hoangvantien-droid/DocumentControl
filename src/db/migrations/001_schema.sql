-- 001_schema.sql — Phan CHINH cua schema DCS (copy nguyen van tu DCS-4).
-- Nguon: .kiro/specs/Document control/DCS-4-Schema-PostgreSQL.sql (dong 1-1302).

-- ============================================================
-- DCS — Hệ Quản lý & Phân phối Tài liệu Điện tử
-- Schema PostgreSQL, bản 2 — khớp với DCS-3 Khai báo chi tiết
--
-- Phạm vi: khâu SAU phê duyệt. Soạn thảo và ký duyệt thuộc hệ khác.
-- Tham chiếu: DCS-1 (yêu cầu), DCS-2 (nghiệp vụ), DCS-3 (khai báo)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;   -- tim khong dau ra ket qua co dau
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- tim doc_id khop mot phan
CREATE EXTENSION IF NOT EXISTS vector;      -- cho cột embedding, bỏ nếu dùng kho vector ngoài

-- ============================================================
-- HO TRO TIM KIEM TIENG VIET
--
-- PostgreSQL khong co cau hinh phan tich tieng Viet san. Cach chay duoc:
--   1. Bo dau ca noi dung lan cau truy van  -> go "luu mau" ra "lưu mẫu"
--   2. Dung cau hinh 'simple' (tach theo khoang trang, khong than tu hoa)
--      — chap nhan duoc vi tieng Viet khong bien hinh
--   3. pg_trgm tren doc_id -> go "HD-005" ra "MML/QA/HD-005"
--
-- unaccent() mac dinh KHONG immutable nen khong dung truc tiep trong
-- generated column; boc lai thanh ham immutable rieng.
-- ============================================================

CREATE OR REPLACE FUNCTION vn_unaccent(t TEXT)
RETURNS TEXT AS $$
    SELECT unaccent('unaccent', coalesce(t, ''));
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- array_to_string() duoc PostgreSQL danh dau STABLE (phu thuoc ham xuat cua kieu
-- phan tu), nen KHONG dung truc tiep trong generated column. Voi TEXT[] thi no
-- thuc su bat bien, nen boc lai — day la cach lam chuan cho truong hop nay.
CREATE OR REPLACE FUNCTION vn_join(parts TEXT[])
RETURNS TEXT AS $$
    SELECT coalesce(array_to_string(parts, ' '), '');
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION vn_tsv(VARIADIC parts TEXT[])
RETURNS tsvector AS $$
    SELECT to_tsvector('simple', vn_unaccent(array_to_string(parts, ' ')));
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- ============================================================
-- J. CAY TO CHUC — BAN DOC DONG BO TU L1
--
-- Dac ta phan quyen QA ban 1.0 (da duyet) dat L1 lam NGUON SU THAT DUY NHAT
-- cho dinh danh, cay to chuc va phan quyen, voi quy tac: khong app nao duoc
-- tu luu nguoi dung hay tu kiem quyen cuc bo.
--
-- Cac bang duoi day la BAN DOC dong bo tu L1. DCS KHONG sua chung.
-- Rule chan ghi o cuoi khoi nay bien dieu do thanh rang buoc ky thuat,
-- khong chi la thoa thuan tren giay.
-- ============================================================

CREATE TABLE org_bu (                          -- L2: nganh hang (Condiment, Meat...)
    bu_id           UUID PRIMARY KEY,
    bu_code         VARCHAR(20)  NOT NULL UNIQUE,
    name            VARCHAR(150) NOT NULL,
    synced_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE org_site (                        -- L3: phap nhan / nha may
    site_id         UUID PRIMARY KEY,
    site_code       VARCHAR(20)  NOT NULL UNIQUE,
    name            VARCHAR(150) NOT NULL,
    bu_id           UUID NOT NULL REFERENCES org_bu(bu_id) ON DELETE RESTRICT,
    synced_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE org_department (                  -- L4: phong ban tac nghiep
    dept_id         UUID PRIMARY KEY,
    dept_code       VARCHAR(20)  NOT NULL UNIQUE,
    name            VARCHAR(150) NOT NULL,
    site_id         UUID NOT NULL REFERENCES org_site(site_id) ON DELETE RESTRICT,
    manager_user_id UUID,                      -- phuc vu leo thang bac 2
    synced_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_site_bu   ON org_site(bu_id);
CREATE INDEX idx_dept_site ON org_department(site_id);

-- Chi THAM CHIEU user_id cua L1. KHONG luu ho ten, chuc danh, phong ban —
-- nhung thu do hoi L1 luc hien thi. Bang nay ton tai de dat duoc khoa ngoai.
CREATE TABLE app_user_ref (
    user_id         UUID PRIMARY KEY,          -- = app_user.user_id ben L1
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Gan nguoi dung vao bo phan — cung thuoc mo hinh pham vi cua L1 (user_dept).
-- DCS BUOC PHAI co ban doc nay: neu khong, khong tinh duoc "bao nhieu nguoi
-- phai doc tai lieu nay" ma phai goi API L1 cho tung dong bao cao — bat kha thi.
-- N:N vi mot nguoi co the thuoc nhieu bo phan.
CREATE TABLE app_user_dept (
    user_id     UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE CASCADE,
    dept_id     UUID NOT NULL REFERENCES org_department(dept_id) ON DELETE CASCADE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, dept_id)
);

CREATE INDEX idx_user_dept_dept ON app_user_dept(dept_id) WHERE is_active;

-- Chan moi thao tac ghi tu phia DCS len ban doc dong bo.
-- Job dong bo chay bang role rieng va tam DISABLE cac rule nay.
CREATE RULE org_bu_no_write   AS ON UPDATE TO org_bu   DO INSTEAD NOTHING;
CREATE RULE org_site_no_write AS ON UPDATE TO org_site DO INSTEAD NOTHING;
CREATE RULE org_dept_no_write AS ON UPDATE TO org_department DO INSTEAD NOTHING;
CREATE RULE user_dept_no_write AS ON UPDATE TO app_user_dept DO INSTEAD NOTHING;

-- ============================================================
-- NHOM CHUC NANG DOC TAI LIEU — THU DUY NHAT DCS SO HUU VE CON NGUOI
--
-- Ly do ton tai: L1 co pham vi toi cap Department nhung KHONG co khai niem
-- chuc nang. Hai nguoi cung phong QA co the can doc hai bo tai lieu khac nhau.
--
-- KHONG dat ten la "vi tri cong viec": dung dung tu do se khien nguoi sau nham
-- voi chuc danh HR va som muon co nguoi di dong bo no tu he nhan su — pha dung
-- y do ban dau, vi day la phan quyen theo CHUC NANG do QA quyet dinh.
-- ============================================================

CREATE TABLE functional_groups (
    group_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(30)  NOT NULL UNIQUE,   -- FG-CCP-HAP
    name                VARCHAR(150) NOT NULL,          -- mo ta CONG VIEC, khong phai chuc danh
    -- Bat buoc dich danh MOT nguoi, khong giao cho mot phong. Cung logic voi
    -- tai lieu ngoai bo: thu khong ai so huu la thu khong ai duy tri.
    owner_user_id       UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
    review_cycle_months SMALLINT NOT NULL DEFAULT 12 CHECK (review_cycle_months > 0),
    next_review_date    DATE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE functional_group_members (
    group_id    UUID NOT NULL REFERENCES functional_groups(group_id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
    added_by    UUID REFERENCES app_user_ref(user_id) ON DELETE SET NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_fg_member_user ON functional_group_members(user_id);
CREATE INDEX idx_fg_review ON functional_groups(next_review_date) WHERE is_active;

-- ============================================================
-- B. TÀI LIỆU VÀ PHIÊN BẢN
-- ============================================================

-- doc_id do người đăng ký nhập, KHÔNG tự sinh (REQ-A03).
-- Bảng này không mang nội dung và không mang con trỏ "bản đang hiệu lực" —
-- thông tin đó suy ra bằng truy vấn, xem uq_one_effective_per_doc.
-- Ve viec doc_id lam khoa chinh:
--   So hieu tai lieu CO THE DOI (tai co cau nganh hang, sap nhap nha may,
--   chuan hoa lai quy uoc danh so). Hai cach xu ly:
--     a) Doi sang khoa thay the UUID, doc_id chi la truong duy nhat
--     b) Giu doc_id lam khoa chinh, them ON UPDATE CASCADE tren moi khoa ngoai
--   Chon (b): cach (a) dung sach vo hon nhung phai sua 4 bang cong moi truy van
--   da kiem chung, rui ro cao hon loi ich. Voi (b), doi so hieu se tu lan truyen.
--   RUI RO CON LAI: audit_log.object_id la TEXT tu do nen KHONG lan truyen —
--   nhung day la hanh vi DUNG cho mot so ghi vet, vi no ghi lai su that TAI THOI
--   DIEM do. Khi doi so hieu, ghi mot ban ghi 'doi_so_hieu' de noi hai gia tri.
CREATE TABLE documents (
    doc_id          VARCHAR(50) PRIMARY KEY,             -- MML/QA/HD-005
    -- Quy cach va ke hoach chat luong KHONG co trong danh sach nay: chung la
    -- du lieu co cau truc thuoc QDMS, khong phai van ban. Xem DCS-1 muc 2.2.
    -- Khong them 'Spec'/'QualityPlan' vao day de "cho tien" — lam vay se tao
    -- hai nguon cung quyet dinh mot lo hang kiem theo nguong nao.
    doc_type        VARCHAR(20) NOT NULL
        CHECK (doc_type IN ('SOP', 'WI', 'Form', 'Policy', 'External')),
    origin          VARCHAR(10) NOT NULL DEFAULT 'noi_bo'
        CHECK (origin IN ('noi_bo', 'ngoai_bo')),
    -- Bon cap pham vi theo dac ta phan quyen QA. Quyet dinh ai xem duoc VA
    -- vai tro nao co quyen xac nhan (RELEASE__SITE / __BU / __GROUP).
    scope_level     VARCHAR(6) NOT NULL DEFAULT 'site'
        CHECK (scope_level IN ('group', 'bu', 'site', 'dept')),
    scope_bu_id     UUID REFERENCES org_bu(bu_id) ON DELETE RESTRICT,
    scope_site_id   UUID REFERENCES org_site(site_id) ON DELETE RESTRICT,
    scope_dept_id   UUID REFERENCES org_department(dept_id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Dung mot con tro pham vi, khop voi scope_level. Cap group khong can con tro.
    CONSTRAINT chk_scope_ref CHECK (
        (scope_level = 'group' AND scope_bu_id IS NULL AND scope_site_id IS NULL AND scope_dept_id IS NULL)
     OR (scope_level = 'bu'    AND scope_bu_id IS NOT NULL AND scope_site_id IS NULL AND scope_dept_id IS NULL)
     OR (scope_level = 'site'  AND scope_site_id IS NOT NULL AND scope_dept_id IS NULL)
     OR (scope_level = 'dept'  AND scope_dept_id IS NOT NULL))
);

-- ------------------------------------------------------------
-- GOI BAN HANH — nhieu tai lieu phu thuoc nhau cung len hieu luc.
-- CHI cho ban hanh phoi hop quy mo nho (2-5 tai lieu). Ban hanh lai
-- ca bo 30 tai lieu la bai toan KHAC, khong dung tinh nang nay —
-- gioi han 10 thanh vien la de ep dung ranh gioi do (DCS-1 muc 2.7).
-- ------------------------------------------------------------
CREATE TABLE release_packages (
    package_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_code    VARCHAR(30)  NOT NULL UNIQUE,
    title           VARCHAR(300) NOT NULL,       -- vi sao cac tai lieu nay di cung nhau
    -- NGUON SU THAT ve ngay hieu luc cho moi thanh vien. Dat o day thay vi tren
    -- tung phien ban de doi ngay goi KHONG dung toi ban ghi phien ban da xac nhan
    -- (giu tinh bat bien o DCS-3 muc B.4).
    effective_date  DATE NOT NULL,
    status          VARCHAR(15) NOT NULL DEFAULT 'dang_mo'
        CHECK (status IN ('dang_mo', 'da_kich_hoat', 'da_giai_the')),
    created_by      UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
                    -- Nguoi DANG KY tao goi. Admin KHONG tao goi: su phu thuoc
                    -- giua cac tai lieu la kien thuc nghiep vu cua bo phan so huu.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at    TIMESTAMPTZ,
    dissolve_reason TEXT,
    CONSTRAINT chk_dissolve_reason
        CHECK (status <> 'da_giai_the' OR coalesce(dissolve_reason,'') <> '')
);

CREATE INDEX idx_package_open ON release_packages(effective_date) WHERE status = 'dang_mo';

CREATE TABLE document_versions (
    version_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id                  VARCHAR(50) NOT NULL
        REFERENCES documents(doc_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    version_no              VARCHAR(20) NOT NULL,
    title                   VARCHAR(300) NOT NULL,

    -- ---- Hồ sơ phê duyệt (từ hệ ký duyệt, nhập tay) ----
    issued_date             DATE         NOT NULL,       -- ngày ban hành
    approver_name           VARCHAR(150) NOT NULL,       -- ngoại bộ: tổ chức phát hành
    approval_reference      VARCHAR(100),                -- số hồ sơ hệ ký duyệt
    approval_url            TEXT,                        -- trỏ sang hệ ký duyệt (REQ-G05)
    -- QDMS muc 11.1: ha tang ky so cho tai lieu QA co the chua co,
    -- phe duyet tam giu theo cach hien tai. Khong gia dinh chi co ky so.
    approval_method         VARCHAR(25) NOT NULL DEFAULT 'ky_so'
        CHECK (approval_method IN ('ky_so', 'ky_tay_so_hoa', 'thu_dien_tu_luu_vet')),
    external_effective_date DATE,                        -- ngoại bộ: ngày hiệu lực pháp lý

    -- ---- Hiệu lực (thuộc DCS) ----
    -- Rong khi thuoc goi — lay tu release_packages.effective_date (REQ-A14).
    -- Rang buoc chk_effective_or_package ep dung mot trong hai.
    effective_date          DATE,                        -- nguoi dang ky quyet (REQ-A09)
    package_id              UUID REFERENCES release_packages(package_id) ON DELETE RESTRICT,
    expiry_date             DATE,
    review_cycle_months     SMALLINT NOT NULL CHECK (review_cycle_months > 0),
    next_review_date        DATE,                        -- tính từ effective_date

    -- ---- Nhãn cấp tài liệu (thừa kế xuống mục và phân đoạn) ----
    scope                       TEXT,
    keywords                    TEXT[],
    applicable_site_ids         UUID[],
    applicable_product_groups   TEXT[],
    owner_department_id         UUID REFERENCES org_department(dept_id) ON DELETE RESTRICT,
    required_reader_dept_ids    UUID[],                  -- bo phan phai doc; nghia cua 'ai phai doc'

    -- ---- Tệp ----
    source_channel          VARCHAR(10) NOT NULL CHECK (source_channel IN ('api', 'thu_cong')),
    file_path               TEXT        NOT NULL,
    file_hash               VARCHAR(64) NOT NULL,        -- SHA-256, kiểm tra toàn vẹn định kỳ
    file_page_count         SMALLINT,

    -- ---- Luồng đăng ký ----
    status                  VARCHAR(20) NOT NULL DEFAULT 'cho_hoan_thien'
        CHECK (status IN ('cho_hoan_thien', 'cho_xac_nhan', 'tu_choi',
                          'da_dang_ky', 'hieu_luc', 'het_hieu_luc', 'thu_hoi')),
    registrant_user_id      UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
    admin_user_id           UUID          REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
    rejection_reason        TEXT,
    recall_reason           TEXT,
    supersedes_version_id   UUID          REFERENCES document_versions(version_id) ON DELETE RESTRICT,
    -- Quyet dinh CO dat lai xac nhan doc hay khong. Neu moi phien ban deu dat lai
    -- (ke ca sua loi chinh ta), nguoi dung se bam xac nhan theo phan xa va bang
    -- chung dao tao mat y nghia. Khai sai o day lam hong chinh bang chung do, nen
    -- day la mot muc Admin TU KIEM trong checklist (DCS-3 muc C.3, muc 9b).
    change_significance     VARCHAR(5)
        CHECK (change_significance IN ('lon', 'nho')),
    change_summary          TEXT,

    submitted_at            TIMESTAMPTZ,
    confirmed_at            TIMESTAMPTZ,   -- ĐÂY LÀ "NGÀY ĐĂNG KÝ" (quyết định đã chốt)
    effective_at            TIMESTAMPTZ,   -- thời điểm thực sự chuyển sang hieu_luc
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ---- Trạng thái xử lý nội dung: KHÔNG chặn hiệu lực (DCS-2 mục 4.6) ----
    parse_status            VARCHAR(20) NOT NULL DEFAULT 'chua_chay'
        CHECK (parse_status IN ('chua_chay', 'thanh_cong', 'kem_tin_cay', 'that_bai')),
    index_status            VARCHAR(20) NOT NULL DEFAULT 'chua_chay'
        CHECK (index_status IN ('chua_chay', 'dang_chay', 'xong', 'loi')),
    parse_note              TEXT,

    -- Chi muc van ban THUAN — KHONG dung embedding, KHONG doc index_status.
    -- Tim kiem phai chay duoc ca khi lop AI ngung hoat dong (DCS-1 phan 6).
    search_tsv              tsvector GENERATED ALWAYS AS (
        vn_tsv(doc_id, title, coalesce(scope,''), vn_join(keywords))
    ) STORED,

    -- ======== RÀNG BUỘC NGHIỆP VỤ (DCS-3 mục B.3) ========

    CONSTRAINT uq_doc_version UNIQUE (doc_id, version_no),

    -- Guard đã chốt: ngày hiệu lực >= ngày đăng ký, với ngày đăng ký =
    -- ngày Admin xác nhận. Đây là lớp phòng thủ cuối; tầng service phải
    -- kiểm tra TRƯỚC và tự chuyển 'tu_choi', không để rơi vào lỗi DB.
    CONSTRAINT chk_effective_after_confirm
        CHECK (confirmed_at IS NULL OR effective_date >= confirmed_at::date),

    CONSTRAINT chk_expiry_after_effective
        CHECK (expiry_date IS NULL OR expiry_date > effective_date),

    -- Kiểm soát hai lớp: người xác nhận khác người nộp (REQ-B02).
    -- KHÔNG ép khác bộ phận — DCS Admin là chức năng tập trung (DCS-1 mục 4.4).
    CONSTRAINT chk_admin_not_registrant
        CHECK (admin_user_id IS NULL OR admin_user_id <> registrant_user_id),

    CONSTRAINT chk_rejection_reason
        CHECK (status <> 'tu_choi' OR rejection_reason IS NOT NULL),

    CONSTRAINT chk_recall_reason
        CHECK (status <> 'thu_hoi' OR recall_reason IS NOT NULL),

    CONSTRAINT chk_confirmed_has_admin
        CHECK (confirmed_at IS NULL OR admin_user_id IS NOT NULL),

    -- Phien ban co ban goc thi bat buoc khai muc do thay doi; 'lon' phai co tom tat
    CONSTRAINT chk_change_significance CHECK (
        supersedes_version_id IS NULL OR change_significance IS NOT NULL),
    CONSTRAINT chk_change_summary CHECK (
        change_significance IS DISTINCT FROM 'lon' OR coalesce(change_summary,'') <> ''),

    -- Dung MOT trong hai: ngay rieng, hoac thuoc goi (khong duoc ca hai, khong duoc khong cai nao)
    CONSTRAINT chk_effective_or_package CHECK (
        (effective_date IS NOT NULL AND package_id IS NULL)
     OR (effective_date IS NULL     AND package_id IS NOT NULL))
);

-- RÀNG BUỘC QUAN TRỌNG NHẤT: mỗi doc_id chỉ một phiên bản Hiệu lực
-- tại một thời điểm. Ép ở tầng DB, không phó thác tầng ứng dụng (REQ-C01).
CREATE UNIQUE INDEX uq_one_effective_per_doc
    ON document_versions (doc_id)
    WHERE status = 'hieu_luc';

-- Tài liệu nội bộ bắt buộc có số hồ sơ phê duyệt để đối chiếu chéo khi
-- audit. Dùng partial index thay CHECK vì điều kiện nằm ở bảng documents.
CREATE OR REPLACE FUNCTION fn_validate_version()
RETURNS TRIGGER AS $$
DECLARE
    v_origin    VARCHAR(10);
    v_link_cnt  INTEGER;
BEGIN
    SELECT origin INTO v_origin FROM documents WHERE doc_id = NEW.doc_id;

    IF v_origin = 'noi_bo' AND coalesce(NEW.approval_reference, '') = '' THEN
        RAISE EXCEPTION 'Tài liệu nội bộ bắt buộc có approval_reference';
    END IF;

    IF v_origin = 'ngoai_bo' AND NEW.external_effective_date IS NULL THEN
        RAISE EXCEPTION 'Tài liệu ngoại bộ bắt buộc có external_effective_date';
    END IF;

    -- QDMS muc 1.4: ban ghi khong co ma lien ket la ban ghi mo coi.
    -- Chan khi roi trang thai cho_xac_nhan (DCS-3 kiem tra so 9, muc Chan).
    IF NEW.status IN ('da_dang_ky', 'hieu_luc')
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
        SELECT count(*) INTO v_link_cnt
          FROM document_links WHERE version_id = NEW.version_id;
        IF v_link_cnt = 0 THEN
            RAISE EXCEPTION 'Phiên bản phải có ít nhất một nhãn liên kết trước khi đăng ký';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_version
    BEFORE INSERT OR UPDATE ON document_versions
    FOR EACH ROW EXECUTE FUNCTION fn_validate_version();

CREATE INDEX idx_docver_doc            ON document_versions(doc_id);
CREATE INDEX idx_docver_status         ON document_versions(status);
CREATE INDEX idx_docver_effective_date ON document_versions(effective_date);
CREATE INDEX idx_docver_next_review    ON document_versions(next_review_date)
    WHERE status = 'hieu_luc';
CREATE INDEX idx_docver_registrant     ON document_versions(registrant_user_id);
CREATE INDEX idx_docver_admin          ON document_versions(admin_user_id);
CREATE INDEX idx_docver_supersedes     ON document_versions(supersedes_version_id);
CREATE INDEX idx_docver_tsv ON document_versions USING GIN (search_tsv);
-- Go thieu tien to so hieu van ra: 'HD-005' -> 'MML/QA/HD-005'
CREATE INDEX idx_doc_id_trgm ON documents USING GIN (doc_id gin_trgm_ops);

-- ============================================================
-- E. MỤC VÀ PHÂN ĐOẠN
-- ============================================================

-- Mục thuộc PHIÊN BẢN, không thuộc tài liệu. Phiên bản mới thì bóc tách lại
-- từ đầu, không tái sử dụng mục cũ (REQ-D06).
CREATE TABLE document_sections (
    section_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
    section_code    VARCHAR(30)  NOT NULL,               -- '6.2'
    section_title   VARCHAR(300) NOT NULL,
    section_type    VARCHAR(30)  NOT NULL DEFAULT 'khac'
        CHECK (section_type IN ('muc_dich', 'pham_vi', 'trach_nhiem', 'dinh_nghia',
                                'noi_dung', 'luu_do', 'bieu_mau', 'tai_lieu_vien_dan',
                                'ho_so', 'khac')),
    order_no        SMALLINT NOT NULL,
    page_from       SMALLINT,
    page_to         SMALLINT,
    raw_text        TEXT,
    search_tsv      tsvector GENERATED ALWAYS AS (
        vn_tsv(section_title, coalesce(raw_text,''))
    ) STORED,
    CONSTRAINT uq_section_per_version UNIQUE (version_id, section_code)
);

CREATE INDEX idx_section_version ON document_sections(version_id);
CREATE INDEX idx_section_tsv ON document_sections USING GIN (search_tsv);

-- Phân đoạn mang lặp doc_id/version_id CÓ CHỦ Ý để lọc nhanh không cần join.
-- is_current suy ra từ trạng thái phiên bản, do trigger duy trì.
CREATE TABLE document_chunks (
    chunk_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id      UUID NOT NULL REFERENCES document_sections(section_id) ON DELETE CASCADE,
    version_id      UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
    doc_id          VARCHAR(50) NOT NULL REFERENCES documents(doc_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    chunk_order     SMALLINT NOT NULL,
    content         TEXT     NOT NULL,
    content_type    VARCHAR(20) NOT NULL DEFAULT 'van_ban'
        CHECK (content_type IN ('van_ban', 'bang', 'danh_sach')),
    token_count     SMALLINT,
    is_current      BOOLEAN  NOT NULL DEFAULT FALSE,     -- chặn truy vấn bản hết hiệu lực
    embedding       vector(1536),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chỉ mục phục vụ lọc TRƯỚC khi tìm (DCS-2 mục 7.1) — không lọc sau.
CREATE INDEX idx_chunk_current   ON document_chunks(doc_id) WHERE is_current = TRUE;
CREATE INDEX idx_chunk_version   ON document_chunks(version_id);
CREATE INDEX idx_chunk_section   ON document_chunks(section_id);

-- ============================================================
-- D. NHÃN LIÊN KẾT
-- ============================================================

-- created_by LUÔN là người thật. Không có nhãn liên kết nào do máy tự tạo
-- (REQ-D04) — sai mã điều khoản làm hỏng cả chuỗi tra cứu khi audit.
-- Khong co ngoai le: moi nhan lien ket deu do mot nguoi that tao.
CREATE TABLE document_links (
    link_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
    section_id      UUID          REFERENCES document_sections(section_id) ON DELETE CASCADE,
                                  -- NULL = liên kết cấp tài liệu
    link_type       VARCHAR(20) NOT NULL
        CHECK (link_type IN ('dieu_khoan', 'cong_doan', 'diem_kiem_soat',
                             'moi_nguy', 'tai_lieu')),
    link_code       VARCHAR(50) NOT NULL,                -- mã trong hệ đích (QDMS)
    copied_from_previous BOOLEAN NOT NULL DEFAULT FALSE, -- nhãn chép từ bản trước
    confirmed_by_user    BOOLEAN NOT NULL DEFAULT FALSE, -- người đã xác nhận lại chưa
    created_by      UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_link UNIQUE (version_id, section_id, link_type, link_code)
);

CREATE INDEX idx_link_code    ON document_links(link_type, link_code);  -- tra cứu ngược
CREATE INDEX idx_link_version ON document_links(version_id);

-- ============================================================
-- F. PHÂN PHỐI, XÁC NHẬN ĐỌC, BẢN IN
-- ============================================================

-- Ma trận gắn với SỐ HIỆU (ổn định qua các phiên bản)...
-- Hai chieu, lay PHEP GIAO:
--   functional_group_id RONG  -> moi nguoi thuoc department_id
--   functional_group_id CO    -> nguoi thuoc department_id VA la thanh vien nhom
-- Neu cai phep HOP, khai them nhom se MO RONG danh sach nguoi nhan — nguoc
-- hoan toan voi muc dich cua nhom chuc nang la thu hep lai cho dung nguoi.
--
-- Khong co cot site_id: pham vi site nam o documents.scope_*, con bo phan da
-- ngam thuoc mot site trong cay to chuc cua L1. Luu them o day se tao noi thu
-- hai giu cung mot su that.
CREATE TABLE distribution_matrix (
    matrix_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id              VARCHAR(50) NOT NULL REFERENCES documents(doc_id) ON UPDATE CASCADE ON DELETE CASCADE,
    department_id       UUID NOT NULL REFERENCES org_department(dept_id) ON DELETE RESTRICT,
    functional_group_id UUID REFERENCES functional_groups(group_id) ON DELETE RESTRICT,
    require_ack         BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_matrix UNIQUE (doc_id, department_id, functional_group_id)
);

CREATE INDEX idx_matrix_dept ON distribution_matrix(department_id);
CREATE INDEX idx_matrix_fg   ON distribution_matrix(functional_group_id);

-- ...còn xác nhận đọc gắn với PHIÊN BẢN: đã đọc bản 1.0 không tính là
-- đã đọc bản 2.0, đồng hồ đặt lại mỗi phiên bản (DCS-2 mục 5.3).
CREATE TABLE read_acknowledgements (
    ack_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
    -- Boi canh TAI THOI DIEM xac nhan; nguoi doi bo phan hoac roi nhom sau do
    -- khong lam sai lech bang chung da co. Khong tra lai L1 khi lam bao cao.
    department_id       UUID REFERENCES org_department(dept_id) ON DELETE RESTRICT,
    functional_group_id UUID REFERENCES functional_groups(group_id) ON DELETE RESTRICT,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Khi ban moi khai 'nho', ban ghi xac nhan duoc SAO CHEP sang ban moi (khong
    -- tham chieu nguoc) de bao cao ton dong chi phai truy van theo version_id cua
    -- ban dang hieu luc. Co nay giu cho ghi vet van phan biet duoc dau la xac
    -- nhan that, dau la ke thua tu ban truoc.
    inherited_from_version_id UUID REFERENCES document_versions(version_id) ON DELETE SET NULL,
    CONSTRAINT uq_ack UNIQUE (version_id, user_id)   -- ON CONFLICT cua ke thua dua vao rang buoc nay
);

CREATE INDEX idx_ack_version ON read_acknowledgements(version_id);

CREATE TABLE printed_copies (
    print_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id          UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE RESTRICT,
    printed_by          UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
    printed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    intended_location   VARCHAR(200),
    recall_status       VARCHAR(20) NOT NULL DEFAULT 'dang_luu_hanh'
        CHECK (recall_status IN ('dang_luu_hanh', 'da_thu_hoi', 'khong_ro')),
    -- Noi dung ma QR. NGAU NHIEN, khong phai print_id tuan tu: trang tra cuu
    -- KHONG yeu cau dang nhap, nen ma tuan tu se cho phep do het danh sach
    -- tai lieu bang cach doan ma lien tiep (DCS-3 muc F.3).
    verify_token        VARCHAR(43) NOT NULL UNIQUE
        DEFAULT encode(gen_random_bytes(32), 'base64'),
    overlay_applied     BOOLEAN NOT NULL DEFAULT FALSE
        -- 'khong_ro' là trạng thái thật và cần thiết: sẽ có bản in không
        -- tìm lại được. Ghi nhận tốt hơn giả vờ mọi bản đều thu hồi được.
);

CREATE INDEX idx_print_version ON printed_copies(version_id)
    WHERE recall_status = 'dang_luu_hanh';
CREATE INDEX idx_print_token ON printed_copies(verify_token);

-- ============================================================
-- RA SOAT DINH KY
-- Ra soat la BAN GHI CO VONG DOI RIENG, khong phai mot truong ngay.
-- Ly do: ket luan "da xem xet, khong can sua" phai co bang chung (ai ra,
-- ngay nao) moi dat lai duoc dong ho chu ky — mot truong ngay khong luu
-- duoc dieu do.
-- ============================================================

CREATE TABLE periodic_reviews (
    review_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id          UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
    doc_id              VARCHAR(50) NOT NULL REFERENCES documents(doc_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    due_date            DATE NOT NULL,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_department_id UUID REFERENCES org_department(dept_id) ON DELETE RESTRICT,

    status              VARCHAR(20) NOT NULL DEFAULT 'dang_ra_soat'
        CHECK (status IN ('dang_ra_soat', 'treo_cho_ban_moi', 'da_dong', 'huy_bo')),
    verdict             VARCHAR(12)
        CHECK (verdict IN ('giu_nguyen', 'can_sua', 'huy_bo')),
    verdict_note        TEXT,
    reviewed_by         UUID REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,
    reviewed_at         TIMESTAMPTZ,
    resolved_by_version_id UUID REFERENCES document_versions(version_id) ON DELETE SET NULL,
    closed_at           TIMESTAMPTZ,

    -- Dang ra soat thi chua co ket luan; moi trang thai khac deu phai co
    CONSTRAINT chk_verdict_by_status CHECK (
        (status = 'dang_ra_soat' AND verdict IS NULL)
     OR (status <> 'dang_ra_soat' AND verdict IS NOT NULL)),

    -- Ket luan khac 'giu_nguyen' phai giai trinh
    CONSTRAINT chk_verdict_note CHECK (
        verdict IS NULL OR verdict = 'giu_nguyen' OR coalesce(verdict_note,'') <> '')
);

-- Moi phien ban chi co MOT ban ghi ra soat dang mo tai mot thoi diem
CREATE UNIQUE INDEX uq_one_open_review_per_version
    ON periodic_reviews (version_id)
    WHERE status IN ('dang_ra_soat', 'treo_cho_ban_moi');

CREATE INDEX idx_review_open ON periodic_reviews(due_date)
    WHERE status IN ('dang_ra_soat', 'treo_cho_ban_moi');
CREATE INDEX idx_review_doc  ON periodic_reviews(doc_id);

-- ============================================================
-- PHAT HIEN TU QDMS M18
-- DCS chi HIEN THI, khong cho dong phat hien — viec do thuoc M18,
-- tranh hai noi cung theo doi mot danh sach ton dong (DCS-2 muc 6.4).
-- ============================================================

CREATE TABLE m18_findings (
    finding_id      VARCHAR(40) PRIMARY KEY,             -- do M18 cap
    finding_type    VARCHAR(40) NOT NULL
        CHECK (finding_type IN ('thieu_dieu_khoan_bat_buoc', 'mau_thuan_giua_tai_lieu',
                                'vien_dan_loi_thoi', 'khong_nhat_quan_giua_nha_may',
                                'qua_han_xem_xet', 'diem_kiem_soat_mo_coi')),
    severity        VARCHAR(10) NOT NULL CHECK (severity IN ('thap', 'trung_binh', 'cao')),
    description     TEXT NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_in_m18 BOOLEAN NOT NULL DEFAULT FALSE       -- M18 bao ve khi da dong
);

CREATE TABLE m18_finding_targets (
    finding_id      VARCHAR(40) NOT NULL REFERENCES m18_findings(finding_id) ON DELETE CASCADE,
    version_id      UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
    section_id      UUID REFERENCES document_sections(section_id) ON DELETE CASCADE,
    PRIMARY KEY (finding_id, version_id, section_id)
);

CREATE INDEX idx_finding_open ON m18_findings(severity) WHERE resolved_in_m18 = FALSE;

-- ============================================================
-- LEO THANG
-- Bon loai ton dong deu co xu huong nam im vi moi loai nam tren ban mot
-- nguoi ban. Leo thang chi THONG BAO — khong tu doi trang thai gi
-- (DCS-2 muc 9.2).
-- ============================================================

CREATE TABLE escalation_rules (
    rule_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backlog_type    VARCHAR(25) NOT NULL
        CHECK (backlog_type IN ('cho_xac_nhan', 'ra_soat_qua_han',
                                'xac_nhan_doc_thieu', 'goi_treo')),
    level           SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 4),
    threshold_days  SMALLINT NOT NULL CHECK (threshold_days >= 0),
    notify_target   VARCHAR(20) NOT NULL
        CHECK (notify_target IN ('nguoi_giu_viec', 'quan_ly_bo_phan',
                                 'dcs_admin', 'cap_tren')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_rule UNIQUE (backlog_type, level)
);

-- Nguong la DU LIEU CAU HINH, khong phai ma nguon: nguong hop ly phu thuoc
-- khoi luong thuc te, ma khoi luong do chi biet sau vai thang van hanh.
INSERT INTO escalation_rules (backlog_type, level, threshold_days, notify_target) VALUES
    ('cho_xac_nhan',       1,  3, 'nguoi_giu_viec'),
    ('cho_xac_nhan',       2,  7, 'quan_ly_bo_phan'),
    ('cho_xac_nhan',       4, 14, 'cap_tren'),
    ('ra_soat_qua_han',    1,  0, 'nguoi_giu_viec'),
    ('ra_soat_qua_han',    2, 15, 'quan_ly_bo_phan'),
    ('ra_soat_qua_han',    3, 30, 'dcs_admin'),
    ('ra_soat_qua_han',    4, 60, 'cap_tren'),
    ('xac_nhan_doc_thieu', 1,  7, 'nguoi_giu_viec'),
    ('xac_nhan_doc_thieu', 2, 21, 'quan_ly_bo_phan'),
    ('goi_treo',           1,  5, 'nguoi_giu_viec'),
    ('goi_treo',           2, 10, 'quan_ly_bo_phan'),
    ('goi_treo',           3, 20, 'dcs_admin');
-- Luu y: 'cho_xac_nhan' khong co bac 3 vi bac 1 da la DCS Admin —
-- leo thang thang len bac 4 (DCS-2 muc 9.2).

CREATE TABLE escalations_sent (
    escalation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backlog_type    VARCHAR(25) NOT NULL,
    object_id       VARCHAR(64) NOT NULL,
    level           SMALLINT NOT NULL,
    sent_to_user_id UUID REFERENCES app_user_ref(user_id) ON DELETE SET NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- RANG BUOC QUAN TRONG NHAT cua ca co che: moi bac chi gui DUNG MOT LAN.
    -- Thieu no, job chay hang ngay se gui lai moi ngay va nguoi nhan se hoc
    -- duoc rang canh bao nay bo qua duoc — luc do ca co che mat tac dung.
    CONSTRAINT uq_escalation UNIQUE (backlog_type, object_id, level)
);

CREATE INDEX idx_escalation_obj ON escalations_sent(backlog_type, object_id);

-- ============================================================
-- G. GHI VẾT — APPEND ONLY
-- ============================================================

CREATE TABLE audit_log (
    log_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id   UUID REFERENCES app_user_ref(user_id) ON DELETE RESTRICT,  -- NULL khi là hệ thống
    actor_type      VARCHAR(10) NOT NULL DEFAULT 'nguoi'
        CHECK (actor_type IN ('nguoi', 'he_thong', 'api')),
    event_type      VARCHAR(30) NOT NULL
        CHECK (event_type IN (
            'nop_dang_ky', 'rut_lai', 'sua_truoc_khi_nop',
            'xac_nhan', 'tu_choi_boi_admin', 'tu_choi_tu_dong', 'tich_checklist',
            'chuyen_hieu_luc', 'chuyen_het_hieu_luc', 'thu_hoi',
            'khai_nhan', 'sua_nhan', 'xac_nhan_nhan_chep',
            'xem', 'tai', 'in', 'tra_cuu_qr', 'xac_nhan_doc', 'hoi_ai',
            'xem_so_sanh', 'tim_kiem',
            'sua_ma_tran', 'gui_thong_bao',
            'sinh_ra_soat', 'ket_luan_ra_soat', 'dong_ra_soat_theo_ban_moi',
            'tao_goi', 'gan_vao_goi', 'doi_ngay_goi', 'thao_thanh_vien',
            'giai_the_goi', 'kich_hoat_goi', 'leo_thang')),
    object_type     VARCHAR(40) NOT NULL,
    object_id       VARCHAR(64) NOT NULL,
    before_state    JSONB,
    after_state     JSONB,
    context         JSONB        -- ip, thiết bị, phiên; với hoi_ai: chunk_ids_used
);

CREATE INDEX idx_audit_object   ON audit_log(object_type, object_id);
CREATE INDEX idx_audit_time     ON audit_log(occurred_at);
CREATE INDEX idx_audit_actor    ON audit_log(actor_user_id);
CREATE INDEX idx_audit_event    ON audit_log(event_type);

-- Ghi vết bất biến: chặn UPDATE và DELETE ở tầng DB, kể cả Super Admin.
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ============================================================
-- TRIGGER VÀ HÀM NGHIỆP VỤ
-- ============================================================

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    IF NEW.effective_date IS DISTINCT FROM OLD.effective_date
       OR NEW.review_cycle_months IS DISTINCT FROM OLD.review_cycle_months THEN
        NEW.next_review_date = NEW.effective_date
            + (NEW.review_cycle_months || ' months')::INTERVAL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_docver_updated
    BEFORE UPDATE ON document_versions
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE OR REPLACE FUNCTION fn_set_next_review()
RETURNS TRIGGER AS $$
DECLARE v_eff DATE;
BEGIN
    -- Thanh vien goi lay ngay tu goi (effective_date cua chinh no la NULL)
    v_eff := coalesce(NEW.effective_date,
                      (SELECT effective_date FROM release_packages WHERE package_id = NEW.package_id));
    IF v_eff IS NOT NULL THEN
        NEW.next_review_date = v_eff + (NEW.review_cycle_months || ' months')::INTERVAL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_docver_next_review
    BEFORE INSERT ON document_versions
    FOR EACH ROW EXECUTE FUNCTION fn_set_next_review();

-- Rang buoc goi ban hanh: so thanh vien, trang thai goi, va quy tac doi ngay.
CREATE OR REPLACE FUNCTION fn_validate_package_member()
RETURNS TRIGGER AS $$
DECLARE v_status VARCHAR(15); v_count INTEGER;
BEGIN
    IF NEW.package_id IS NULL THEN RETURN NEW; END IF;

    SELECT status INTO v_status FROM release_packages WHERE package_id = NEW.package_id;

    -- Chi gan duoc vao goi dang mo; goi da kich hoat khong them bot thanh vien
    IF v_status <> 'dang_mo'
       AND (TG_OP = 'INSERT' OR OLD.package_id IS DISTINCT FROM NEW.package_id) THEN
        RAISE EXCEPTION 'Chỉ gắn được vào gói đang mở (gói hiện ở trạng thái %)', v_status;
    END IF;

    -- Toi da 10 thanh vien — gioi han CO CHU Y, khong phai gioi han ky thuat
    IF TG_OP = 'INSERT' OR OLD.package_id IS DISTINCT FROM NEW.package_id THEN
        SELECT count(*) INTO v_count FROM document_versions WHERE package_id = NEW.package_id;
        IF v_count >= 10 THEN
            RAISE EXCEPTION 'Gói ban hành tối đa 10 thành viên. Nhu cầu lớn hơn là bài toán khác (DCS-1 mục 2.7)';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_package_member
    BEFORE INSERT OR UPDATE ON document_versions
    FOR EACH ROW EXECUTE FUNCTION fn_validate_package_member();

-- Ngay goi CHI DOI RA XA khi da co thanh vien duoc xac nhan.
-- Ly do: Admin da xac nhan dua tren guard "ngay hieu luc >= ngay xac nhan",
-- kiem theo ngay CU. Doi ra xa thi guard van thoa. Keo gan lai co the lam ngay
-- moi nho hon ngay da xac nhan — tuc la hop thuc hoa nguoc mot thu dang le bi chan.
CREATE OR REPLACE FUNCTION fn_guard_package_date()
RETURNS TRIGGER AS $$
DECLARE v_confirmed INTEGER;
BEGIN
    IF NEW.effective_date < OLD.effective_date THEN
        SELECT count(*) INTO v_confirmed
          FROM document_versions
         WHERE package_id = NEW.package_id AND confirmed_at IS NOT NULL;
        IF v_confirmed > 0 THEN
            RAISE EXCEPTION 'Gói đã có thành viên được xác nhận — ngày hiệu lực chỉ dời ra xa được';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_package_date
    BEFORE UPDATE OF effective_date ON release_packages
    FOR EACH ROW EXECUTE FUNCTION fn_guard_package_date();

-- Đồng bộ is_current của phân đoạn theo trạng thái phiên bản.
-- Đây là cơ chế chặn máy trả lời từ tài liệu hết hiệu lực (REQ-D07, REQ-H01).
CREATE OR REPLACE FUNCTION fn_sync_chunk_current()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        UPDATE document_chunks
           SET is_current = (NEW.status = 'hieu_luc')
         WHERE version_id = NEW.version_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_chunk_current
    AFTER UPDATE ON document_versions
    FOR EACH ROW EXECUTE FUNCTION fn_sync_chunk_current();

-- Chuyển hiệu lực theo lịch. Phiên bản mới có hiệu lực VÀ phiên bản cũ
-- hết hiệu lực phải xảy ra trong CÙNG MỘT giao dịch — nếu tách rời sẽ có
-- khoảng thời gian hai bản cùng hiệu lực hoặc không bản nào hiệu lực.
CREATE OR REPLACE FUNCTION fn_activate_due_versions()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    r RECORD;
    p RECORD;
BEGIN
    -- Duong 1: cac ban KHONG thuoc goi, kich hoat doc lap tung ban.
    -- Ban thuoc goi di duong 2 ben duoi — ca goi cung len hoac khong ai len.
    FOR r IN
        SELECT version_id, doc_id, change_significance, supersedes_version_id
          FROM document_versions
         WHERE status = 'da_dang_ky'
           AND package_id IS NULL
           AND effective_date <= CURRENT_DATE
         ORDER BY doc_id, effective_date, version_no
         FOR UPDATE
    LOOP
        -- Hết hiệu lực bản cũ TRƯỚC, để không vi phạm uq_one_effective_per_doc
        UPDATE document_versions
           SET status = 'het_hieu_luc'
         WHERE doc_id = r.doc_id AND status = 'hieu_luc';

        UPDATE document_versions
           SET status = 'hieu_luc', effective_at = now()
         WHERE version_id = r.version_id;

        INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
        VALUES ('he_thong', 'chuyen_hieu_luc', 'document_versions',
                r.version_id::TEXT, jsonb_build_object('status', 'hieu_luc'));

        -- Ban ghi ra soat dang treo cho ban moi cua CUNG doc_id nay -> dong lai.
        -- Day la nhanh 'can_sua': treo tu luc ket luan cho toi khi ban moi that su
        -- len hieu luc, de khong co chuyen ket luan can sua roi khong ai sua ma
        -- dong ho chu ky van duoc dat lai.
        UPDATE periodic_reviews
           SET status = 'da_dong', resolved_by_version_id = r.version_id, closed_at = now()
         WHERE doc_id = r.doc_id AND status = 'treo_cho_ban_moi';

        -- Ke thua xac nhan doc khi la thay doi NHO: sao chep sang ban moi.
        -- Thay doi LON thi khong ke thua — moi nguoi phai xac nhan lai.
        IF r.change_significance = 'nho' AND r.supersedes_version_id IS NOT NULL THEN
            INSERT INTO read_acknowledgements
                (version_id, user_id, department_id, functional_group_id, acknowledged_at, inherited_from_version_id)
            SELECT r.version_id, a.user_id, a.department_id, a.functional_group_id, a.acknowledged_at, a.version_id
              FROM read_acknowledgements a
             WHERE a.version_id = r.supersedes_version_id
            ON CONFLICT (version_id, user_id) DO NOTHING;
        END IF;

        v_count := v_count + 1;
    END LOOP;

    -- Duong 2: GOI BAN HANH — nguyen tu. Chi kich hoat khi MOI thanh vien da
    -- 'da_dang_ky'. Thieu mot thanh vien thi khong thanh vien nao len (REQ-C12).
    -- Ca vong lap nay nam trong cung mot giao dich voi duong 1, nen khong co
    -- khoang thoi gian nao goi len nua chung nua.
    FOR p IN
        SELECT pk.package_id
          FROM release_packages pk
         WHERE pk.status = 'dang_mo'
           AND pk.effective_date <= CURRENT_DATE
           AND EXISTS (SELECT 1 FROM document_versions m WHERE m.package_id = pk.package_id)
           AND NOT EXISTS (
               SELECT 1 FROM document_versions m
                WHERE m.package_id = pk.package_id
                  AND m.status <> 'da_dang_ky')     -- con thanh vien chua san sang -> ca goi dung
         FOR UPDATE
    LOOP
        FOR r IN
            SELECT version_id, doc_id, change_significance, supersedes_version_id
              FROM document_versions
             WHERE package_id = p.package_id
             ORDER BY doc_id, version_no
             FOR UPDATE
        LOOP
            UPDATE document_versions
               SET status = 'het_hieu_luc'
             WHERE doc_id = r.doc_id AND status = 'hieu_luc';

            UPDATE document_versions
               SET status = 'hieu_luc', effective_at = now()
             WHERE version_id = r.version_id;

            INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
            VALUES ('he_thong', 'chuyen_hieu_luc', 'document_versions',
                    r.version_id::TEXT, jsonb_build_object('status','hieu_luc','package_id',p.package_id));

            UPDATE periodic_reviews
               SET status = 'da_dong', resolved_by_version_id = r.version_id, closed_at = now()
             WHERE doc_id = r.doc_id AND status = 'treo_cho_ban_moi';

            IF r.change_significance = 'nho' AND r.supersedes_version_id IS NOT NULL THEN
                INSERT INTO read_acknowledgements
                    (version_id, user_id, department_id, functional_group_id, acknowledged_at, inherited_from_version_id)
                SELECT r.version_id, a.user_id, a.department_id, a.functional_group_id, a.acknowledged_at, a.version_id
                  FROM read_acknowledgements a
                 WHERE a.version_id = r.supersedes_version_id
                ON CONFLICT (version_id, user_id) DO NOTHING;
            END IF;

            v_count := v_count + 1;
        END LOOP;

        UPDATE release_packages
           SET status = 'da_kich_hoat', activated_at = now()
         WHERE package_id = p.package_id;

        INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
        VALUES ('he_thong', 'kich_hoat_goi', 'release_packages', p.package_id::TEXT,
                jsonb_build_object('status','da_kich_hoat'));
    END LOOP;

    -- Hết hiệu lực theo expiry_date (không có bản thay thế)
    UPDATE document_versions
       SET status = 'het_hieu_luc'
     WHERE status = 'hieu_luc'
       AND expiry_date IS NOT NULL
       AND expiry_date < CURRENT_DATE;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Job sinh ban ghi ra soat cho tai lieu toi han. Chay hang ngay cung
-- fn_activate_due_versions. Khong sinh trung nho uq_one_open_review_per_version.
CREATE OR REPLACE FUNCTION fn_generate_due_reviews()
RETURNS INTEGER AS $$
DECLARE v_count INTEGER := 0;
BEGIN
    INSERT INTO periodic_reviews (version_id, doc_id, due_date, assigned_department_id)
    SELECT v.version_id, v.doc_id, v.next_review_date, v.owner_department_id
      FROM document_versions v
     WHERE v.status = 'hieu_luc'
       AND v.next_review_date IS NOT NULL
       AND v.next_review_date <= CURRENT_DATE
       AND NOT EXISTS (
           SELECT 1 FROM periodic_reviews p
            WHERE p.version_id = v.version_id
              AND p.status IN ('dang_ra_soat', 'treo_cho_ban_moi'));
    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
    SELECT 'he_thong', 'sinh_ra_soat', 'periodic_reviews', p.review_id::TEXT,
           jsonb_build_object('doc_id', p.doc_id, 'due_date', p.due_date)
      FROM periodic_reviews p
     WHERE p.generated_at > now() - interval '1 minute';

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Ghi ket luan ra soat. DAY LA DUONG DUY NHAT dat lai next_review_date sau khi
-- tai lieu da hieu luc — khong co giao dien nao khac sua duoc truong do, ke ca Admin.
CREATE OR REPLACE FUNCTION fn_record_review_verdict(
    p_review_id UUID, p_verdict VARCHAR, p_note TEXT, p_user UUID)
RETURNS VOID AS $$
DECLARE r periodic_reviews%ROWTYPE;
BEGIN
    SELECT * INTO r FROM periodic_reviews WHERE review_id = p_review_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy bản ghi rà soát'; END IF;
    IF r.status <> 'dang_ra_soat' THEN
        RAISE EXCEPTION 'Bản ghi rà soát không còn ở trạng thái đang rà soát';
    END IF;

    UPDATE periodic_reviews
       SET verdict = p_verdict, verdict_note = p_note,
           reviewed_by = p_user, reviewed_at = now(),
           status = CASE p_verdict
                      WHEN 'giu_nguyen' THEN 'da_dong'
                      WHEN 'can_sua'    THEN 'treo_cho_ban_moi'
                      WHEN 'huy_bo'     THEN 'huy_bo' END,
           closed_at = CASE WHEN p_verdict = 'giu_nguyen' THEN now() ELSE NULL END
     WHERE review_id = p_review_id;

    -- CHI 'giu_nguyen' moi dat lai dong ho chu ky. 'can_sua' phai cho ban moi
    -- len hieu luc (xu ly trong fn_activate_due_versions), neu khong se co
    -- truong hop ket luan can sua nhung khong ai sua ma tai lieu van trong
    -- nhu da ra soat xong.
    IF p_verdict = 'giu_nguyen' THEN
        UPDATE document_versions
           SET next_review_date = CURRENT_DATE + (review_cycle_months || ' months')::INTERVAL
         WHERE version_id = r.version_id;
    END IF;

    INSERT INTO audit_log (actor_user_id, actor_type, event_type, object_type, object_id, after_state)
    VALUES (p_user, 'nguoi', 'ket_luan_ra_soat', 'periodic_reviews', p_review_id::TEXT,
            jsonb_build_object('verdict', p_verdict, 'note', p_note));
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SO SANH PHIEN BAN
--
-- KHONG co bang luu ket qua: ket qua suy ra duoc tu document_sections cua hai
-- phien ban, nen luu rieng se tao noi thu hai giu cung mot su that.
-- Cai DUOC luu la viec Admin da xem — su kien 'xem_so_sanh' trong audit_log.
--
-- KHONG so sanh tep PDF: tep co the la anh quet, so sanh anh cho ket qua
-- vo nghia. So sanh MUC DA BOC TACH luon o cung muc chat luong voi phan
-- con lai cua he thong.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_diff_versions(p_from UUID, p_to UUID)
RETURNS TABLE (
    section_code  VARCHAR(30),
    change_type   TEXT,
    old_title     VARCHAR(300),
    new_title     VARCHAR(300),
    old_text      TEXT,
    new_text      TEXT
) AS $$
    SELECT
        coalesce(n.section_code, o.section_code),
        CASE
            WHEN o.section_id IS NULL THEN 'them'
            WHEN n.section_id IS NULL THEN 'xoa'
            WHEN o.raw_text IS DISTINCT FROM n.raw_text THEN 'doi_noi_dung'
            -- Doi tieu de nhung giu ma: neu rieng vi DE BO SOT nhat
            WHEN o.section_title IS DISTINCT FROM n.section_title THEN 'doi_tieu_de'
            ELSE 'khong_doi'
        END,
        o.section_title, n.section_title, o.raw_text, n.raw_text
      FROM (SELECT * FROM document_sections WHERE version_id = p_from) o
      FULL OUTER JOIN
           (SELECT * FROM document_sections WHERE version_id = p_to) n
        ON n.section_code = o.section_code    -- ghep theo MA MUC: khoa on dinh nhat
     WHERE o.section_id IS NULL
        OR n.section_id IS NULL
        OR o.raw_text IS DISTINCT FROM n.raw_text
        OR o.section_title IS DISTINCT FROM n.section_title;
$$ LANGUAGE sql STABLE;

-- So sanh chi dang tin bang chat luong boc tach. Ba truong hop phai CANH BAO
-- ro thay vi hien mot ket qua trong co ve day du.
CREATE OR REPLACE FUNCTION fn_diff_reliability(p_from UUID, p_to UUID)
RETURNS TEXT AS $$
DECLARE f RECORD; t RECORD; n_from INT; n_to INT;
BEGIN
    IF p_from IS NULL THEN RETURN 'la_phien_ban_dau_tien'; END IF;
    SELECT parse_status INTO f FROM document_versions WHERE version_id = p_from;
    SELECT parse_status INTO t FROM document_versions WHERE version_id = p_to;
    IF f.parse_status <> 'thanh_cong' OR t.parse_status <> 'thanh_cong'
       THEN RETURN 'boc_tach_kem_tin_cay'; END IF;
    SELECT count(*) INTO n_from FROM document_sections WHERE version_id = p_from;
    SELECT count(*) INTO n_to   FROM document_sections WHERE version_id = p_to;
    IF n_from = 0 OR n_to = 0 THEN RETURN 'khong_co_muc_de_so'; END IF;
    RETURN 'dang_tin';
END;
$$ LANGUAGE plpgsql STABLE;

-- Dieu kien mo o tich muc 9b trong checklist xac nhan: nguoi DANG xac nhan
-- phai da mo so sanh it nhat mot lan cho dung cap phien ban nay.
-- Khong ep duoc nguoi ta doc, nhung ep duoc viec noi dung phai hien ra truoc mat.
CREATE OR REPLACE FUNCTION fn_has_viewed_diff(p_user UUID, p_version UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM audit_log
         WHERE event_type = 'xem_so_sanh'
           AND actor_user_id = p_user
           AND object_id = p_version::TEXT);
$$ LANGUAGE sql STABLE;

-- ============================================================
-- KHUNG NHÌN PHỤC VỤ TRUY VẤN
-- ============================================================

-- Phiên bản đang hiệu lực của mỗi tài liệu. KHÔNG lưu thành cột trên
-- documents — suy ra ở đây để tránh hai nơi cùng giữ một sự thật.
CREATE VIEW v_current_documents AS
SELECT d.doc_id, d.doc_type, d.origin,
       v.version_id, v.version_no, v.title,
       v.effective_date, v.next_review_date, v.expiry_date,
       v.owner_department_id, v.applicable_site_ids, v.required_reader_dept_ids,
       v.approval_reference, v.approval_url,
       (v.next_review_date < CURRENT_DATE) AS qua_han_xem_xet
  FROM documents d
  JOIN document_versions v ON v.doc_id = d.doc_id AND v.status = 'hieu_luc';

-- Tra cứu ngược theo mã điều khoản — dùng bởi QDMS khi điều khoản đổi
-- trạng thái (REQ-I02).
CREATE VIEW v_clause_references AS
SELECT l.link_type, l.link_code,
       d.doc_id, v.version_no, v.title, v.status, v.effective_date,
       v.next_review_date, v.owner_department_id,
       CASE WHEN l.section_id IS NULL THEN 'document' ELSE 'section' END AS link_level,
       s.section_code, s.section_title
  FROM document_links l
  JOIN document_versions v ON v.version_id = l.version_id
  JOIN documents d         ON d.doc_id = v.doc_id
  LEFT JOIN document_sections s ON s.section_id = l.section_id
 WHERE v.status IN ('hieu_luc', 'da_dang_ky');

-- Nguon tim kiem hop nhat: cap tai lieu + cap muc, gop mot cho de xep hang.
-- CHI dung search_tsv va pg_trgm — KHONG dung embedding, KHONG doc index_status.
CREATE VIEW v_search_index AS
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
  JOIN documents d ON d.doc_id = v.doc_id;

-- Tim kiem. Loc pham vi/hieu luc la DIEU KIEN cua truy van, khong phai bo loc
-- ap len ket qua — neu tim truoc roi loc sau, he thong da doc noi dung ngoai
-- pham vi nguoi dung duoc xem (cung nguyen tac voi hoi dap AI).
CREATE OR REPLACE FUNCTION fn_search(
    p_user UUID, p_q TEXT, p_include_historical BOOLEAN DEFAULT FALSE)
RETURNS TABLE (
    doc_id VARCHAR(50), version_id UUID, version_no VARCHAR(20), title VARCHAR(300),
    status VARCHAR(20), section_code VARCHAR(30), section_title VARCHAR(300),
    snippet TEXT, match_level TEXT, rank REAL
) AS $$
DECLARE q TEXT := vn_unaccent(coalesce(p_q,''));
BEGIN
    RETURN QUERY
    SELECT si.doc_id, si.version_id, si.version_no, si.title, si.status,
           si.section_code, si.section_title, si.snippet,
           CASE
               WHEN lower(si.doc_id) = lower(p_q)        THEN 'doc_id'
               WHEN si.doc_id ILIKE '%'||p_q||'%'        THEN 'doc_id_partial'
               ELSE si.match_level
           END,
           -- Uu tien khop so hieu len dau: go mot chuoi trong giong so hieu thi
           -- gan nhu chac chan dang tim dung tai lieu do, khong phai moi tai lieu
           -- co nhac toi no.
           (CASE WHEN lower(si.doc_id) = lower(p_q) THEN 100.0
                 WHEN si.doc_id ILIKE '%'||p_q||'%' THEN 50.0
                 ELSE 0.0 END
            + ts_rank(si.search_tsv, plainto_tsquery('simple', q)))::REAL
      FROM v_search_index si
     WHERE (p_include_historical OR si.status = 'hieu_luc')
       AND (si.search_tsv @@ plainto_tsquery('simple', q)
            OR si.doc_id ILIKE '%'||p_q||'%')
       AND (si.scope_level = 'group'
            OR EXISTS (
                SELECT 1 FROM app_user_dept ud
                  JOIN org_department dp ON dp.dept_id = ud.dept_id
                  JOIN org_site st ON st.site_id = dp.site_id
                 WHERE ud.user_id = p_user AND ud.is_active
                   AND (  (si.scope_level='bu'   AND st.bu_id      = si.scope_bu_id)
                       OR (si.scope_level='site' AND st.site_id    = si.scope_site_id)
                       OR (si.scope_level='dept' AND dp.dept_id    = si.scope_dept_id))))
     ORDER BY 10 DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Ton dong ra soat dinh ky — bao gom ca nhanh 'can_sua' dang treo
CREATE VIEW v_review_backlog AS
SELECT p.review_id, p.doc_id, v.version_no, v.title, p.due_date, p.status, p.verdict,
       p.verdict_note, d.name AS department_name,
       (CURRENT_DATE - p.due_date) AS so_ngay_qua_han
  FROM periodic_reviews p
  JOIN document_versions v ON v.version_id = p.version_id
  LEFT JOIN org_department d ON d.dept_id = p.assigned_department_id
 WHERE p.status IN ('dang_ra_soat', 'treo_cho_ban_moi');

-- Bon loai ton dong gop mot cho, de leo thang chi phai duyet mot nguon (REQ-J01)
CREATE VIEW v_backlog_all AS
SELECT 'cho_xac_nhan'::VARCHAR(25) AS backlog_type,
       v.version_id::TEXT          AS object_id,
       v.owner_department_id       AS department_id,
       v.registrant_user_id        AS holder_user_id,
       (CURRENT_DATE - v.submitted_at::date) AS days_overdue
  FROM document_versions v
 WHERE v.status = 'cho_xac_nhan'
UNION ALL
SELECT 'ra_soat_qua_han', p.review_id::TEXT, p.assigned_department_id, NULL,
       (CURRENT_DATE - p.due_date)
  FROM periodic_reviews p
 WHERE p.status IN ('dang_ra_soat', 'treo_cho_ban_moi')
UNION ALL
SELECT 'goi_treo', pk.package_id::TEXT, NULL, pk.created_by,
       (CURRENT_DATE - pk.effective_date)
  FROM release_packages pk
 WHERE pk.status = 'dang_mo' AND pk.effective_date < CURRENT_DATE;

-- Job leo thang, chay hang ngay. CHI GUI THONG BAO — khong doi trang thai gi.
CREATE OR REPLACE FUNCTION fn_run_escalations()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    b RECORD;
    v_target UUID;
BEGIN
    FOR b IN
        SELECT bl.*, er.level, er.notify_target
          FROM v_backlog_all bl
          JOIN escalation_rules er
            ON er.backlog_type = bl.backlog_type
           AND er.is_active
           AND bl.days_overdue >= er.threshold_days
         WHERE NOT EXISTS (
               SELECT 1 FROM escalations_sent es
                WHERE es.backlog_type = bl.backlog_type
                  AND es.object_id    = bl.object_id
                  AND es.level        = er.level)
    LOOP
        v_target := CASE b.notify_target
            WHEN 'nguoi_giu_viec'   THEN b.holder_user_id
            WHEN 'quan_ly_bo_phan'  THEN (SELECT manager_user_id FROM org_department
                                           WHERE dept_id = b.department_id)
            WHEN 'dcs_admin'        THEN (SELECT user_id FROM users
                                           WHERE role = 'dcs_admin' AND is_active LIMIT 1)
            -- Cay to chuc moi khong co parent_department_id tren Department:
            -- cap tren cua mot bo phan la nguoi giu vai tro Group Owner.
            WHEN 'cap_tren'         THEN (SELECT user_id FROM app_user_role
                                           WHERE role_code = 'DC_GROUP_OWNER' LIMIT 1)
        END;

        -- Khong tim duoc nguoi nhan (chua khai manager_user_id / parent_department_id)
        -- thi bo qua bac nay, KHONG ghi escalations_sent — de khi khai xong se gui duoc.
        CONTINUE WHEN v_target IS NULL;

        INSERT INTO escalations_sent (backlog_type, object_id, level, sent_to_user_id)
        VALUES (b.backlog_type, b.object_id, b.level, v_target)
        ON CONFLICT (backlog_type, object_id, level) DO NOTHING;

        INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
        VALUES ('he_thong', 'leo_thang', b.backlog_type, b.object_id,
                jsonb_build_object('level', b.level, 'sent_to', v_target,
                                   'days_overdue', b.days_overdue));
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Giai ma tran phan phoi ra danh sach NGUOI cu the — PHEP GIAO:
--   functional_group_id RONG -> moi nguoi thuoc bo phan
--   functional_group_id CO   -> nguoi thuoc bo phan VA la thanh vien nhom
CREATE VIEW v_distribution_resolved AS
SELECT m.doc_id, m.matrix_id, m.department_id, m.functional_group_id,
       m.require_ack, ud.user_id
  FROM distribution_matrix m
  JOIN app_user_dept ud ON ud.dept_id = m.department_id AND ud.is_active
 WHERE m.functional_group_id IS NULL
    OR EXISTS (SELECT 1 FROM functional_group_members fm
                WHERE fm.group_id = m.functional_group_id
                  AND fm.user_id  = ud.user_id);

-- Tồn đọng xác nhận đọc theo tài liệu (REQ-E04)
CREATE VIEW v_ack_pending AS
SELECT v.version_id, v.doc_id, v.version_no, v.title,
       d.department_id, dep.name AS department_name,
       d.functional_group_id, fg.name AS functional_group_name,
       COUNT(DISTINCT d.user_id)                             AS so_nguoi_phai_doc,
       COUNT(DISTINCT a.user_id)                             AS so_nguoi_da_xac_nhan,
       COUNT(DISTINCT d.user_id) - COUNT(DISTINCT a.user_id) AS con_lai
  FROM document_versions v
  JOIN v_distribution_resolved d ON d.doc_id = v.doc_id AND d.require_ack
  JOIN org_department dep ON dep.dept_id = d.department_id
  LEFT JOIN functional_groups fg ON fg.group_id = d.functional_group_id
  LEFT JOIN read_acknowledgements a
         ON a.version_id = v.version_id AND a.user_id = d.user_id
 WHERE v.status = 'hieu_luc'
 GROUP BY v.version_id, v.doc_id, v.version_no, v.title,
          d.department_id, dep.name, d.functional_group_id, fg.name;

-- Nhom chuc nang dang chua nguoi da roi to chuc hoac doi bo phan.
-- Day la CO CHE TU DONG DUY NHAT chong viec nhom chuc nang lac hau am tham —
-- kieu sai te nhat vi moi chi so van xanh trong khi gui nham nguoi.
CREATE VIEW v_functional_group_stale AS
SELECT fg.group_id, fg.code, fg.name, fg.owner_user_id,
       fm.user_id AS thanh_vien_can_ra_soat,
       CASE WHEN u.user_id IS NULL THEN 'khong con trong L1'
            ELSE 'khong con thuoc bo phan nao dang hoat dong' END AS ly_do
  FROM functional_groups fg
  JOIN functional_group_members fm ON fm.group_id = fg.group_id
  LEFT JOIN app_user_ref u ON u.user_id = fm.user_id
  LEFT JOIN app_user_dept ud ON ud.user_id = fm.user_id AND ud.is_active
 WHERE fg.is_active
   AND (u.user_id IS NULL OR ud.user_id IS NULL);

