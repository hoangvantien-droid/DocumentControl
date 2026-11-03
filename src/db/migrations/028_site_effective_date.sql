-- 028_site_effective_date.sql — NGÀY HIỆU LỰC PER-SITE (phương án 2a).
--
-- BỐI CẢNH: một tài liệu ban hành ở site A rồi sau đó ban hành & hiệu lực ở
-- site B vào một ngày khác. Giữ document_versions.effective_date làm NGÀY GỐC
-- (ngày hiệu lực khai lúc đăng ký cho tập site đầu); mỗi receipt (một site)
-- có thể khai NGÀY HIỆU LỰC RIÊNG qua document_receipt.site_effective_date.
--   • site_effective_date NULL  -> coalesce về effective_date gốc.
--   • apply_date (ghi khi chấp nhận) = coalesce(site_effective_date, effective_date).
--
-- RÀNG BUỘC DB: ngày hiệu lực của site KHÔNG được sớm hơn issued_date của phiên
-- bản (ngày ban hành). KHÔNG đặt CHECK "không về quá khứ" ở DB — ràng buộc đó
-- phụ thuộc thời điểm hiện tại, thuộc tầng domain (todayVN), không bỏ vào DB.
--
-- Chạy theo trình chạy src/db/migrate.ts: mỗi file một giao dịch, theo thứ tự
-- số (028 kế sau 027). KHÔNG sửa 001-027. Theo mẫu 017/026/027: KHÔNG dùng
-- IF NOT EXISTS cho cột (để lỗi trùng lộ sớm).

-- ============================================================
-- 1. Cột ngày hiệu lực riêng của site trên receipt.
-- ============================================================
ALTER TABLE document_receipt
    ADD COLUMN site_effective_date DATE;

COMMENT ON COLUMN document_receipt.site_effective_date IS
    'Ngày hiệu lực riêng khai cho site này (phương án 2a). NULL = dùng ngày hiệu lực gốc document_versions.effective_date. apply_date khi chấp nhận = coalesce(site_effective_date, effective_date).';

-- ============================================================
-- 2. Chặn ngày hiệu lực của site sớm hơn ngày ban hành (issued_date) của phiên
--    bản. Chỉ kiểm khi site_effective_date NOT NULL. Dùng trigger plpgsql để
--    tra issued_date theo version_id của chính dòng receipt.
-- ============================================================
CREATE FUNCTION fn_check_site_effective() RETURNS trigger AS $$
DECLARE
    v_issued DATE;
BEGIN
    IF NEW.site_effective_date IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT issued_date INTO v_issued
      FROM document_versions
     WHERE version_id = NEW.version_id;
    IF v_issued IS NOT NULL AND NEW.site_effective_date < v_issued THEN
        RAISE EXCEPTION 'site_effective_date (%) khong duoc som hon issued_date (%) cua phien ban',
            NEW.site_effective_date, v_issued;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_site_effective
    BEFORE INSERT OR UPDATE OF site_effective_date ON document_receipt
    FOR EACH ROW EXECUTE FUNCTION fn_check_site_effective();
