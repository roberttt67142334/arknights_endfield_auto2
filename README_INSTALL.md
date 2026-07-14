# END FIELD GAS REALTIME DASHBOARD

Versi ini tidak membutuhkan Render, Python, kartu, atau verifikasi pembayaran.

## Cara kerja

```text
Game / SKPORT
      ↓
Google Apps Script mengambil card/detail
      ↓
Google Apps Script menyimpan snapshot
      ↓
GitHub Pages meminta action=state setiap 30 detik
      ↓
Dashboard hanya berubah bila data game berubah
```

Data yang diambil langsung dari `card/detail`:

- Nickname
- Level
- Exploration Level
- Jumlah Operator
- Stamina saat ini dan maksimum
- Waktu sampai stamina penuh
- Activity Points
- Weekly Routine
- Protocol Pass

Tombol Refresh tidak ditekan otomatis. Tombol hanya menjalankan `action=sync`
ketika pengguna benar-benar mengkliknya.

---

## BAGIAN A — GOOGLE APPS SCRIPT

1. Buka project Google Apps Script lama.
2. Backup `Code.gs`.
3. Ganti seluruh isi `Code.gs` dengan:

```text
google-apps-script/Code.gs
```

4. Klik **Save**.
5. Jalankan fungsi berikut satu kali dari editor:

```javascript
setupRealtimeTrigger()
```

6. Berikan izin ketika diminta.

Trigger ini menyimpan snapshot baru setiap satu menit ketika website tidak dibuka.
Ketika website sedang dibuka, browser memeriksa data setiap 30 detik.

7. Buka:

```text
Deploy → Manage deployments
```

8. Edit deployment Web App yang lama.
9. Pilih **New version**.
10. Pastikan:

```text
Execute as: Me
Who has access: Anyone
```

11. Deploy.

Bila URL `/exec` berubah, salin URL baru ke `config.js`.

### Tes endpoint

Buka:

```text
URL_APPS_SCRIPT?action=sync
```

Hasil harus memiliki:

```json
{
  "success": true,
  "state": {
    "accounts": {}
  }
}
```

---

## BAGIAN B — GITHUB PAGES

Upload ke root repository:

```text
index.html
dashboard.css
dashboard.js
config.js
.github/workflows/deploy-pages.yml
```

Hapus workflow Python lama:

```text
.github/workflows/generate-cards.yml
```

Folder berikut tidak dipakai lagi dan boleh dihapus:

```text
backend/
scripts/
data/
cards/
requirements.txt
render.yaml
```

Buka `config.js` dan pastikan `gasUrl` sama dengan URL deployment Apps Script.

Kemudian:

```text
Settings → Pages → Source: GitHub Actions
Actions → Deploy Endfield GAS Dashboard → Run workflow
```

Setelah hijau, tekan:

```text
Ctrl + Shift + R
```

---

## INTERVAL

Default browser:

```javascript
autoSyncMs: 30000
```

Google Apps Script hanya meminta data baru jika snapshot lebih lama dari 25 detik.
OAuth `cred` dan `salt` di-cache server-side selama 25 menit agar request lebih ringan.

Apps Script time trigger memiliki interval satu menit.

---

## KEAMANAN

Token akun dan Discord webhook yang pernah dibagikan sebaiknya dirotasi setelah
konfigurasi selesai. Repository GitHub jangan berisi `Code.gs` apabila repository
bersifat public, karena file tersebut menyimpan token.

Folder `google-apps-script` hanya untuk diunduh dan ditempel ke Apps Script.
Jangan upload folder itu ke repository public.
