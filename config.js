"use strict";

window.ENDFIELD_CONFIG = Object.freeze({
  /*
   * Gunakan URL deployment Google Apps Script milikmu.
   * Bila kamu membuat deployment baru dengan URL berbeda,
   * cukup ganti nilai ini.
   */
  gasUrl:
    "https://script.google.com/macros/s/AKfycbx0RBYVU_CzWHEV9T3LHmFsmL-iB3Ty10eL5udosmW1zatxuOtupPl6dUias8DUsfAiFA/exec",

  /*
   * Browser memeriksa snapshot setiap 30 detik.
   * Ini bukan menekan tombol Refresh secara otomatis.
   */
  autoSyncMs: 30000,

  requestTimeoutMs: 90000,

  // PIN default: 123456
  pinSha256:
    "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
});
