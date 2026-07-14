# END FIELD GAS REALTIME — ENDFIELD THEME V4

## Perubahan

1. Nama, UID, server, dan Username pada Account Sync Status berasal dari API.
   Sebelum data API berhasil dimuat, nilainya tampil `—`.
2. User Profile sekarang memiliki keterangan Server.
3. Logo sidebar memakai Endfield Industries.
4. Brand menjadi `Endfield // Protocol` dengan label `BETA` kecil.
5. Background memakai tema industrial Endfield: video, grid teknis,
   garis diagonal kuning/cyan, dan panel transparan.
6. `Bound accounts 1` dihapus.
7. Icon Check-in diganti menjadi kalender dengan tanda centang.
8. Icon Sanity dan Activity Tasks dari versi sebelumnya tetap dipertahankan.
9. Tidak ada aset foto profil lokal.

## File GitHub yang ditimpa

```text
index.html
dashboard.css
dashboard.js
config.js
.github/workflows/deploy-pages.yml
```

## Google Apps Script

Timpa isi Apps Script menggunakan:

```text
google-apps-script/Code.gs
```

Lalu:

```text
Deploy → Manage deployments → Edit → New version → Deploy
```

Tidak perlu membuat trigger baru bila `setupRealtimeTrigger()` sudah pernah
dijalankan sebelumnya.

## Deployment GitHub Pages

```text
Actions → Deploy Endfield GAS Dashboard → Run workflow
```

Setelah hijau:

```text
Ctrl + Shift + R
```

PENTING: Jangan upload folder `google-apps-script` ke repository public karena
berisi token akun dan Discord webhook.
