# END FIELD GAS + ENDFIELD-CARDS AVATAR V7

Versi ini memakai dua sumber:

```text
Google Apps Script
→ nama, UID, server, level, operator, exploration, stamina, activity

GitHub Actions + endfield-cards
→ foto/icon profile akun
```

Tidak membutuhkan Render, server berbayar, atau token akun di GitHub.

## Cara avatar bekerja

1. Workflow mengambil profil publik berdasarkan UID melalui `endfield-cards`.
2. Workflow terlebih dahulu mencoba `PlayerProfile.avatar_url`.
3. Jika URL avatar tidak dapat diunduh, workflow membuat Profile Card.
4. Avatar dipotong dari posisi asli renderer Profile Card:
   `(57, 61)` dengan ukuran `325 × 325`.
5. Hasil disimpan menjadi:

```text
assets/avatars/muzaka.png
assets/avatars/orion.png
assets/avatars/naskara.png
```

6. Dashboard membaca `avatar-manifest.json`.
7. Jika foto profil game berubah dan workflow mendeteksinya, gambar web ikut berubah.

## Batas waktu pembaruan avatar

Data statistik dari Google Apps Script tetap diperiksa sekitar 30 detik.

Foto profil diperiksa oleh GitHub Actions setiap 15 menit. Jadwal GitHub dapat
mengalami keterlambatan, sehingga avatar bukan realtime per detik.

Tombol Refresh tetap manual. Tombol tersebut memperbarui data Google Apps Script
dan memuat ulang manifest avatar terbaru, tetapi tidak memulai GitHub Actions.

## File yang diunggah ke repository

Upload dan timpa semua file dari paket, khususnya:

```text
index.html
dashboard.css
dashboard.js
config.js
requirements.txt
avatar-manifest.json

scripts/
└── generate_profile_avatars.py

assets/
└── avatars/
    └── .gitkeep

.github/
└── workflows/
    └── deploy-pages.yml
```

`google-apps-script/Code.gs` tetap disertakan. Jika Code.gs v6 sebelumnya sudah
aktif, kamu tidak wajib menggantinya lagi.

## Menjalankan pertama kali

```text
Actions
→ Deploy Endfield Dashboard + Profile Avatars
→ Run workflow
```

Tunggu seluruh langkah hijau, terutama:

```text
Generate Endfield profile avatars
Build static site
Deploy GitHub Pages
```

Setelah deploy:

```text
Ctrl + Shift + R
```

## Pemeriksaan

Buka:

```text
https://roberttt67142334.github.io/arknights_endfield_auto2/avatar-manifest.json
```

Contoh hasil:

```json
{
  "accounts": {
    "muzaka": {
      "available": true,
      "source": "avatar_url",
      "sha256": "..."
    }
  }
}
```

Nilai `source` dapat berupa:

```text
avatar_url
profile_card_crop
previous_cache
generic_fallback
```

`generic_fallback` berarti API dan Profile Card gagal menghasilkan avatar asli.
