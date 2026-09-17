-- 007_draft_mien_kiem_truoc_khi_nop.sql — Lưu nháp được miễn kiểm đủ trước khi nộp.
--
-- Lỗi UAT D.13: bấm "Lưu nháp" luôn 500 P0001
-- "Tài liệu nội bộ bắt buộc có approval_reference" dù đã điền đủ form.
-- Nguyên nhân: trigger trg_validate_version bắn trên mọi INSERT, kể cả bản
-- nháp (cho_hoan_thien) vốn sinh ra để CHƯA đầy đủ (T-024).
-- Sửa: bản nháp được miễn hai kiểm tra "đủ hồ sơ" (approval_reference nội bộ,
-- external_effective_date ngoại bộ). Kiểm tra nhãn liên kết giữ nguyên — nó vốn
-- chỉ bắn khi sang da_dang_ky/hieu_luc.

CREATE OR REPLACE FUNCTION fn_validate_version()
RETURNS TRIGGER AS $$
DECLARE
    v_origin    VARCHAR(10);
    v_link_cnt  INTEGER;
BEGIN
    SELECT origin INTO v_origin FROM documents WHERE doc_id = NEW.doc_id;

    -- Bản nháp (cho_hoan_thien) CHƯA phải nộp: miễn kiểm đủ hồ sơ.
    IF NEW.status IS DISTINCT FROM 'cho_hoan_thien' THEN
        IF v_origin = 'noi_bo' AND coalesce(NEW.approval_reference, '') = '' THEN
            RAISE EXCEPTION 'Tài liệu nội bộ bắt buộc có approval_reference';
        END IF;

        IF v_origin = 'ngoai_bo' AND NEW.external_effective_date IS NULL THEN
            RAISE EXCEPTION 'Tài liệu ngoại bộ bắt buộc có external_effective_date';
        END IF;
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
