# SAUDIO BOT

## Instalasi di GitHub Codespaces
1. Upload/ekstrak isi folder ini ke folder proyek Codespaces (timpa `index.js` dan `package.json`).
2. Jangan hapus folder `session` jika ingin mempertahankan tautan WhatsApp yang sudah ada.
3. Di Terminal jalankan:
   ```bash
   npm install
   npm start
   ```
4. Jika `session` belum ada, masukkan nomor WhatsApp bot dalam format 62xxxxxxxx saat diminta, lalu masukkan kode pairing di WhatsApp > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon.

Saat pertama kali berjalan, masukkan juga nomor pemilik bot format 62xxxxxxxx. Nomor pemilik disimpan di `owner.json`.

## Perintah
- `!menu`
- `!public` dan `!self` (khusus owner)
- `!sticker` (kirim/balas gambar atau video maksimal 10 detik)
- `!toaudio` (balas video/audio untuk ekstrak MP3)
- `!tomp3` (balas video/audio untuk MP3)
- `!saudio --crop 00:00:05 00:00:15` (balas audio/video)
- `!crop 00:00:05 00:00:15` (balas video)

Untuk crop, format waktu HH:MM:SS. Bot membalas chat biasa di mode public, dibatasi satu balasan per chat tiap 30 detik. Mode self mengabaikan pesan dari non-owner.

Gunakan bot secara wajar dan hanya pada percakapan yang mengharapkan balasan otomatis. Baileys adalah library tidak resmi dan penggunaan otomatis dapat melanggar ketentuan WhatsApp atau menyebabkan pembatasan akun.
