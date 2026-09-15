-- 006_fix_verify_token_length.sql — BUG-002 (UAT 2026-09-15, mức Chặn).
--
-- Triệu chứng: POST /documents/:id/print trả 500 với Postgres 22001
--   "value too long for type character varying(43)".
--
-- Nguyên nhân: printed_copies.verify_token khai VARCHAR(43) nhưng giá trị mặc
--   định encode(gen_random_bytes(32),'base64') dài 44 ký tự (ceil(32/3)*4 = 44,
--   gồm 1 ký tự đệm '='). Mọi lần in đều tràn 1 ký tự -> 22001.
--
-- Sửa: nới cột lên VARCHAR(44). KHÔNG đổi DEFAULT (giữ token ngẫu nhiên chống
--   dò quét, DCS-3 §F.3), KHÔNG đụng dữ liệu bản in đã có. Idempotent: chỉ ALTER
--   khi độ dài hiện tại nhỏ hơn 44, nên chạy lại nhiều lần vô hại.

DO $$
DECLARE v_len INTEGER;
BEGIN
    SELECT character_maximum_length INTO v_len
      FROM information_schema.columns
     WHERE table_name = 'printed_copies'
       AND column_name = 'verify_token';

    IF v_len IS NULL THEN
        RAISE NOTICE 'Bỏ qua: không tìm thấy cột printed_copies.verify_token';
    ELSIF v_len < 44 THEN
        ALTER TABLE printed_copies
            ALTER COLUMN verify_token TYPE VARCHAR(44);
        RAISE NOTICE 'Đã nới printed_copies.verify_token từ VARCHAR(%) lên VARCHAR(44)', v_len;
    ELSE
        RAISE NOTICE 'Bỏ qua: printed_copies.verify_token đã là VARCHAR(%) (>= 44)', v_len;
    END IF;
END $$;
