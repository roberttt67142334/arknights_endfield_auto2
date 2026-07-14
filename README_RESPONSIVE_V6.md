# END FIELD GAS REALTIME RESPONSIVE V6

## Perbaikan

- Jika API menyediakan URL avatar, gambar profil akun sekarang akan tampil.
- Google Apps Script mencari avatar dari Player Binding dan Card Detail.
- Jika API tidak menyediakan gambar, huruf nama tidak digunakan lagi;
  dashboard menampilkan ikon operator generik.
- Sidebar mobile menyediakan ruang tambahan 82px di atas navigation bar Android.
- Konten utama menyediakan ruang bawah tambahan agar tidak tertutup tombol sistem.
- Label `TERSALIN` pada UID hanya muncul setelah UID diklik dan berhasil disalin.
- Label tersebut otomatis hilang setelah 5 detik.
- Hover mouse tidak lagi menampilkan label salin.

## GitHub

Timpa:

```text
index.html
dashboard.css
dashboard.js
config.js
.github/workflows/deploy-pages.yml
```

## Google Apps Script

Agar avatar API dapat dicoba, timpa Code.gs dengan:

```text
google-apps-script/Code.gs
```

Kemudian buat versi deployment Web App baru:

```text
Deploy → Manage deployments → Edit → New version → Deploy
```

## Deploy Pages

```text
Actions → Deploy Endfield GAS Dashboard → Run workflow
```

Setelah hijau:

```text
Ctrl + Shift + R
```
