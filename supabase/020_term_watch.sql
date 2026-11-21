-- Điều khoản 'chỉ nhắc': không đổi trả, không giảm giá, nhắc khi HSD còn N ngày.
alter type term_action add value if not exists 'watch';
