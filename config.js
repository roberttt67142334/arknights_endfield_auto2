"use strict";

/*
 * UBAH apiBase setelah backend selesai di-deploy ke Render.
 * Contoh:
 * apiBase: "https://endfield-live-api.onrender.com"
 */
window.ENDFIELD_CONFIG = Object.freeze({
  apiBase: "https://YOUR-END-FIELD-API.onrender.com",

  checkinUrl:
    "https://script.google.com/macros/s/AKfycbwveP6XYC6ygqYXKqRQalQ-EEb3xJq-QCF09Ifk6RVbRdKABafKHcOZa5RgBcdcY7tl/exec",

  // PIN default: 123456
  pinSha256:
    "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",

  sseReconnectDelayMs: 5000
});
