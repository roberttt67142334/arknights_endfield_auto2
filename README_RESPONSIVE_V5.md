# END FIELD GAS REALTIME RESPONSIVE V5

## Perubahan

- Ikon kotak di kiri `Control Panel / Dashboard` dihapus.
- UID pada User Profile dapat diklik atau ditekan Enter untuk disalin.
- Sidebar mobile memakai tinggi `100dvh`.
- Area akun dapat di-scroll, tetapi tombol Logout selalu berada di bagian bawah.
- Layout dioptimalkan untuk layar sekitar 430 × 932 seperti Infinix Note 40.
- Video background dihapus.
- Tidak ada audio atau musik yang dijalankan oleh halaman.
- Background tetap memakai desain statis bergaya industrial Endfield.
- Sinkron profil tetap otomatis melalui Google Apps Script.
- Perubahan nama, UID, server, level, operator, exploration level,
  stamina, dan activity task masuk ke dashboard tanpa reload halaman.
- Lampu Global Network menjadi biru berkedip ketika nilai tersebut berubah.

## File GitHub yang ditimpa

```text
index.html
dashboard.css
dashboard.js
config.js
.github/workflows/deploy-pages.yml
```

`Code.gs` tidak wajib diganti bila versi Theme V4 sebelumnya sudah aktif.

## Deploy

```text
Actions
→ Deploy Endfield GAS Dashboard
→ Run workflow
```

Setelah deployment hijau:

```text
Ctrl + Shift + R
```
