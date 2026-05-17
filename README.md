# SuperCZ Bot

## 📂 Struktur Folder
```
supercz-bot/
├── .gitignore
├── ecosystem.config.cjs
├── index.js
├── package-lock.json
├── package.json
├── src/
    ├── bot.js
    ├── db.js
    ├── handlers/
    │   ├── login.js
    │   ├── start.js
    │   └── track.js
    ├── notifier/
    │   ├── handler.js
    │   ├── index.js
    │   ├── messages.js
    │   ├── state.js
    │   └── trending.js
    └── utils/
        └── format.js
```

## 🗂️ Penjelasan File

### Root Directory

#### 1. `.gitignore`
- Mengabaikan file atau folder tertentu agar tidak di-tracking oleh Git.

#### 2. `ecosystem.config.cjs`
- Konfigurasi aplikasi untuk **PM2**, seperti restart otomatis dan manajemen proses aplikasi.

#### 3. `index.js`
- Entry point bot SuperCZ.
- Mengimpor modul utama (`bot.js`, `db.js`) serta handler dan notifikasi.
- Menangani signal untuk menutup koneksi database dengan aman sebelum aplikasi berhenti.

#### 4. `package.json`
- Informasi tentang proyek dan manajemen dependensi.
- Dependensi utama:
  - `dotenv`: Mengelola variabel lingkungan.
  - `axios`: Permintaan HTTP.
  - `node-telegram-bot-api`: API untuk bot Telegram.
  - `pg`: PostgreSQL.
  - `ws`: WebSocket.

### Folder `src`

#### `src/bot.js`
- Menginisialisasi instance utama Telegram bot menggunakan library **node-telegram-bot-api**.
- Token bot diatur melalui variabel lingkungan `BOT_TOKEN`.

#### `src/db.js`
- Mengatur koneksi dengan database PostgreSQL menggunakan **pg**.
- URL koneksi diambil dari variabel lingkungan `DATABASE_URL`.

#### `src/handlers/`
- **`login.js`**: Menangani login user melalui bot Telegram.
- **`start.js`**: Mengatur respons ketika bot dijalankan oleh pengguna untuk pertama kali.
- **`track.js`**: Fitur untuk melacak data atau event tertentu.

#### `src/notifier/`
- **`handler.js`**: Meng-handle pembaruan data dari channel WebSocket.
- **`index.js`**: Mengelola inisialisasi WebSocket dan fitur notifikasi.
- **`messages.js`**: Library untuk mengelola pesan yang dikirimkan melalui notifikasi.
- **`state.js`**: Menyimpan status runtime atau data penting lainnya.
- **`trending.js`**: Menangani fitur untuk menampilkan data tren tertentu.

#### `src/utils/`
- **`format.js`**: Library untuk format output atau data lainnya.