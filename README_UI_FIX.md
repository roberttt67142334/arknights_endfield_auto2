# END FIELD GAS REALTIME — UI FIX

Perubahan pada paket ini:

- Logo petir Stamina diganti ke:
  https://endfield.wiki.gg/images/Sanity.png
- Avatar Muzaka, Orion, dan Naskara dipulihkan sebagai aset lokal.
- Tulisan sinkronisasi otomatis di samping tombol dihilangkan.
- Pop-up `Game data updated` dihilangkan.
- Titik Global Network Online tetap hijau ketika tidak ada perubahan.
- Jika nilai game benar-benar berubah, titik menjadi biru dan berkedip
  selama sekitar 4,2 detik, lalu kembali hijau.
- Perubahan dideteksi berdasarkan isi Level, Operator, Exploration,
  Stamina, Daily Activity, Weekly Routine, dan Protocol Pass—not revision
  atau timestamp semata.

## FILE GITHUB YANG DIGANTI

Upload dan timpa:

```text
index.html
dashboard.css
dashboard.js
config.js
.github/workflows/deploy-pages.yml
assets/avatars/muzaka.png
assets/avatars/orion.png
assets/avatars/naskara.png
```

`google-apps-script/Code.gs` tetap disertakan sebagai versi lengkap, tetapi
tidak wajib diganti lagi apabila versi GAS realtime sebelumnya sudah berjalan.

## DEPLOY

```text
Actions
→ Deploy Endfield GAS Dashboard
→ Run workflow
```

Setelah hijau:

```text
Ctrl + Shift + R
```


## PERUBAHAN V3

- Folder `assets/avatars` dihapus.
- Fallback foto profil lokal dihapus.
- Jika API tidak memberikan avatar, dashboard menampilkan huruf awal nama akun.
- Workflow tidak lagi menyalin folder `assets`.


Versi V4 menggantikan instruksi sebelumnya. Lihat README_THEME_V4.md.
