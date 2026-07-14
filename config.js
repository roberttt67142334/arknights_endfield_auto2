"use strict";

window.ENDFIELD_CONFIG = Object.freeze({
  /*
   * Gunakan URL deployment Google Apps Script milikmu.
   * Bila kamu membuat deployment baru dengan URL berbeda,
   * cukup ganti nilai ini.
   */
  gasUrl:
    "https://script.google.com/macros/s/AKfycbxn6_yR0B6jCrX6FhuK7L4qA02FX4LkFK8I5NHvtsd9KbdKNIjn36DzZ6bNlmyC5uRbQg/exec",

  /*
   * Browser meminta profil, stamina, dan Activity Tasks terbaru
   * setiap 5 detik ketika tab sedang terlihat.
   * Ini bukan menekan tombol Refresh secara otomatis.
   */
  autoSyncMs: 5000,

  requestTimeoutMs: 90000,

  // PIN default: 123456
  pinSha256:
    "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
});
