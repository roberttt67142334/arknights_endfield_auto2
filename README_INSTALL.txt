END FIELD PROTOCOL DASHBOARD
============================

Isi paket:
- index.html
- dashboard.css
- dashboard.js
- .github/workflows/generate-cards.yml

Pemasangan:
1. Backup index.html dan workflow lama.
2. Upload index.html, dashboard.css, dan dashboard.js ke root repository.
3. Ganti .github/workflows/generate-cards.yml dengan versi dari ZIP.
4. Jangan hapus folder cards/, requirements.txt, atau scripts/generate_cards.py.
5. Pastikan Settings → Pages → Source menggunakan GitHub Actions.
6. Jalankan Actions → Generate Endfield Profile Cards → Run workflow.
7. Setelah deployment selesai, tekan Ctrl + F5.

PIN default: 123456

Fitur:
- Dashboard baru dengan sidebar.
- Tombol Check-in dan Refresh di kiri atas dashboard.
- Pop-up status check-in seperti referensi.
- Pemilih akun Muzaka, Orion, dan Naskara.
- Profile Card dan Live Stats Card.
- Auto-refresh semua card setiap 10 detik.
- View semua operator.
- Responsif desktop dan mobile.

File github-profile-static.js dan dashboard-ui-fix.js lama boleh dihapus atau
dibiarkan. Dashboard baru tidak lagi memakainya.

Catatan:
Refresh 10 detik mengambil file gambar terbaru yang sudah tersedia di GitHub
Pages. Ia tidak menjalankan workflow GitHub Actions setiap 10 detik.
