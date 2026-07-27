# 🎨 novelGENerator Web App - Design System & Google Stitch Redesign Guide

Folder ini berisi seluruh desain antarmuka (UI/UX), token desain, CSS layout, serta template HTML lengkap dari aplikasi **novelGENerator** untuk mempermudah Anda melakukan **Redesign di Google Stitch**.

---

## 📁 Struktur File Desain (`design-export/`)

| File / Folder | Fungsi & Deskripsi |
| :--- | :--- |
| 📄 `design-tokens.css` *(di shared/)* | **Color Palette, Typography, Border Radius, & Shadow Tokens**. |
| 📄 `shared.css` *(di shared/)* | CSS Global layout, Sidebar, Card, Inputs, Buttons, & Modal. |
| 🖥️ `index.html` | **Dashboard Utama**: Beranda, ringkasan statistik, novel terbaru. |
| ✍️ `generate.html` | **Halaman Generate AI**: Form input premis, **Model AI Dropdown Selector**, streaming bab. |
| 📖 `editor.html` & `editor.css` | **Rich Text Editor**: Interface tempat mengedit bab novel yang sudah digenerate. |
| 🧬 `mimicry.html` | **Profil DNA Penulis**: Interface ekstraksi gaya penulisan & gaya bahasa. |
| 📚 `library.html` | **Perpustakaan Novel / RAG**: Pengelolaan naskah referensi RAG. |
| 📊 `evaluasi.html` | **Halaman Evaluasi AI**: Laporan penilaian kualitas & gaya tulisan. |
| 📦 `ekspor.html` | **Ekspor Multi-Platform**: Wattpad, KBM, NovelToon, Storial, Google Docs. |
| ⚙️ `pengaturan.html` | **Pengaturan Sistem**: API Keys (Anthropic, OpenRouter) & Kuota. |

---

## 🎨 Token Desain Saat Ini (Material 3 - Pastel Literary Minimalist)

```css
/* Color System Tokens */
--color-bg: #f9f9ff;
--color-primary: #3b6662;            /* Deep Teal */
--color-primary-container: #8ebab5;  /* Soft Mint */
--color-on-primary-container: #1f4b47;
--color-surface-lowest: #ffffff;
--color-outline-variant: #c0c8c6;

/* Typography */
--font-serif: 'Source Serif 4', Georgia, serif;
--font-sans: 'Plus Jakarta Sans', sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

---

## 🚀 Panduan untuk Google Stitch Redesign:

1. Anda bisa menggunakan file **`shared/design-tokens.css`** dan **`shared/shared.css`** sebagai acuan utama sistem warna dan *component hierarchy*.
2. Seluruh file HTML di dalam folder ini menggunakan struktur **HTML5 Semantic** yang bersih sehingga sangat fleksibel untuk di-import atau disesuaikan dengan panduan Google Stitch.
