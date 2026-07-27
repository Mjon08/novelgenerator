/*
 * PERPUSTAKAAN SETTING INDONESIA
 * Database latar tempat yang autentik untuk novel Indonesia.
 */

const SETTING_INDONESIA = {
  romance_kantoran: [
    'Gedung pencakar langit di kawasan SCBD Jakarta Selatan, lift kaca dengan pemandangan kota',
    'Ruang rapat kaca lantai 30 dengan pemandangan Semanggi yang macet di bawah',
    'Kafe estetik di Kemang, meja pojok dekat jendela, hujan rintik-rintik di luar',
    'Pantry kantor yang sepi saat jam makan siang, mesin kopi yang mendengung',
    'Lobby mewah hotel bintang lima di bilangan Sudirman, marmer putih dan bunga segar',
    'Parkiran bawah tanah gedung perkantoran, lampu neon kuning dan suara langkah sepatu',
    'Rooftop restoran di Menteng dengan lampu kota Jakarta yang berkelap-kelip',
    'Koridor kantor yang sepi pukul sembilan malam, hanya suara AC dan langkah berdua'
  ],
  romance_kampus: [
    'Perpustakaan UI yang sejuk dengan bau buku tua, rak kayu berdebu dan cahaya jendela',
    'Kantin Teknik yang ramai saat jam makan siang, antre panjang warteg depan gedung',
    'Danau UI saat senja, sepeda berjejer di tepiannya dan angsa putih yang malas',
    'Koridor gedung Rektorat tua dengan ubin teraso dan pohon rindang di halaman',
    'Lapangan basket kampus di sore hari, keringat dan teriakan yang berbaur angin',
    'Kos-kosan gang sempit dekat kampus, jemuran baju dan aroma masakan tetangga',
    'Warung kopi depan gerbang kampus, kursi plastik dan wifi lemot yang dimaafkan',
    'Aula mahasiswa yang pengap saat presentasi, proyektor berkedip dan AC rusak'
  ],
  romance_pernikahan: [
    'Rumah mertua di perumahan Pondok Indah yang luas dan dingin',
    'Dapur bersama yang menjadi medan pertempuran ibu mertua dan menantu',
    'Kamar pengantin yang masih berbau cat baru di apartemen Kuningan',
    'Balkon apartemen lantai 25 dengan pemandangan lampu Jakarta malam hari',
    'Meja makan keluarga yang sunyi, suara sendok dan keheningan yang menusuk',
    'Ruang tamu rumah orang tua, foto pernikahan di dinding dan ibu yang diam'
  ],
  horor_desa: [
    'Desa terpencil di lereng Gunung Merapi, kabut tebal dan jalan berbatu',
    'Sawah membentang dengan orang-orangan sawah yang terlalu mirip manusia',
    'Pohon beringin tua di tengah alun-alun desa, akar menjalar ke mana-mana',
    'Rumah kosong bekas tragedi, cat mengelupas dan jendela yang selalu terbuka',
    'Sumur tua di sudut pekarangan, airnya gelap dan berbau tanah basah',
    'Warung kopi pinggir jalan yang tutup mendadak saat makhluk itu lewat',
    'Kuburan desa di bawah rumpun bambu, angin mendesis di antara batu nisan',
    'Sungai bawah jembatan tua, air hitam dan bunyi gemericik yang aneh di malam hari',
    'Lorong rumah tua Belanda peninggalan era kolonial, lantai kayu berderak',
    'Sawah di belakang rumah saat tengah malam, bulan purnama dan suara gamelan jauh'
  ],
  horor_kota: [
    'Apartemen tua di Manggarai yang menyimpan rahasia puluhan tahun',
    'Terowongan rel kereta yang gelap dan panjang di tengah Jakarta',
    'Ruko kosong di mall yang bangkrut, escalator rusak dan toko terkunci',
    'Kamar kos mati yang tak pernah kosong meski papan "disewakan" terpasang',
    'Taman kota setelah tengah malam, lampu berkedip dan bangku taman yang basah',
    'Basement rumah sakit lama yang sudah tidak beroperasi, koridor putih tanpa akhir'
  ],
  fantasi_nusantara: [
    'Kerajaan Majapahit yang masih berjaya, pendopo besar dan gamelan mengalun',
    'Pasar malam di tepi Bengawan Solo, lampu blencong dan pedagang jamu',
    'Hutan pinus di pegunungan Dieng, kabut biru dan situs candi yang terlupakan',
    'Pelabuhan Sunda Kelapa di abad lampau, kapal pinisi dan bau rempah yang menyengat',
    'Keraton Yogyakarta di masa kejayaan, batik emas dan tari bedhaya di pendopo agung',
    'Laut Banda biru kehijauan, pulau rempah dan kapal VOC di cakrawala',
    'Hutan rimba Kalimantan yang belum terjamah, sungai dan suara alam yang hidup',
    'Gunung berapi yang dipercaya bersemayam dewa, lerengnya dihuni pertapa sakti'
  ],
  kampus_islami: [
    'Masjid kampus yang sejuk, sajadah tebal dan suara murottal setelah zuhur',
    'Pesantren modern di pinggiran Jombang, asrama putri dan pagar bambu',
    'Taman halaqah di bawah pohon mangga, kitab kuning dan diskusi sore',
    'Kantin halal kampus Islam, antrian panjang nasi padang dan suara adzan',
    'Ruang baca perpustakaan pesantren, buku Arab gundul dan lampu temaram'
  ],
  slice_of_life: [
    'Pasar tradisional subuh yang ramai, pedagang sayur dan embun masih menempel',
    'Stasiun MRT Blok M jam rush hour, manusia berdesakan dan alunan earphone',
    'Warteg Ibu Yati di pojok gang, nasi uduk dan teh manis yang tak pernah habis',
    'Halte TransJakarta yang hujan, orang-orang berdesak di bawah atap bocor',
    'Warung mie ayam depan sekolah SMA, tukang ojek dan siswa seragam putih abu',
    'Kos putri gang Mawar nomor 5, cuci piring bersama dan gosip tengah malam',
    'Minimarket 24 jam dekat kampus, roti tawar dan indomie jam 2 pagi',
    'Taman RT yang remaja-nya suka nongkrong, ayunan berkarat dan lampu jalan kuning'
  ]
};

const SETTING_TIPS = {
  'Romance Kantoran (CEO/Boss)': 'Setting kantor mewah dan apartemen premium menciptakan kontras kelas sosial yang kuat.',
  'Romance Kampus': 'Kampus UI, ITB, atau Undip sangat familiar di pembaca muda Indonesia.',
  'Horor Kuntilanak': 'Desa Jawa atau Sunda memberikan nuansa horor yang sangat autentik bagi pembaca Indonesia.',
  'Horor Pesugihan': 'Hutan jati atau perkebunan di Jawa Tengah adalah setting klasik untuk pesugihan.',
  'Fantasi Kerajaan Nusantara': 'Majapahit dan Sriwijaya memberi landasan sejarah yang kaya untuk fantasi.',
  'Romance Islami (Halal)': 'Pesantren modern dan kampus Islam menjadi setting yang relevan dan aman.',
  'Teenlit SMA': 'Sekolah negeri di kota menengah adalah setting paling relatable untuk pembaca remaja.'
};

/**
 * Ambil setting yang relevan berdasarkan genre
 * @param {string} genre
 * @param {number} jumlah - jumlah setting yang diinginkan
 * @returns {string[]}
 */
function getSettingByGenre(genre, jumlah = 3) {
  const g = (genre || '').toLowerCase();
  let kategori = 'slice_of_life';

  if (g.includes('kantoran') || g.includes('ceo') || g.includes('boss')) kategori = 'romance_kantoran';
  else if (g.includes('kampus') || g.includes('mahasiswa')) kategori = 'romance_kampus';
  else if (g.includes('pernikahan') || g.includes('nikah')) kategori = 'romance_pernikahan';
  else if (g.includes('kuntilanak') || g.includes('pesugihan') || g.includes('horor desa')) kategori = 'horor_desa';
  else if (g.includes('horor') || g.includes('thriller')) kategori = 'horor_kota';
  else if (g.includes('fantasi') || g.includes('kerajaan') || g.includes('nusantara')) kategori = 'fantasi_nusantara';
  else if (g.includes('islami') || g.includes('pesantren') || g.includes('hijrah')) kategori = 'kampus_islami';
  else if (g.includes('sma') || g.includes('teenlit') || g.includes('slice')) kategori = 'slice_of_life';
  else if (g.includes('romance')) kategori = 'romance_kantoran';

  const pool = SETTING_INDONESIA[kategori] || SETTING_INDONESIA.slice_of_life;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, jumlah);
}

/**
 * Ambil tips setting untuk genre tertentu
 */
function getSettingTips(genre) {
  for (const [key, tip] of Object.entries(SETTING_TIPS)) {
    if ((genre || '').toLowerCase().includes(key.toLowerCase().split(' ')[0])) return tip;
  }
  return 'Gunakan detail lokal yang familiar — tempat makan, transportasi, dan bahasa sehari-hari Indonesia.';
}

/**
 * Buat deskripsi setting lengkap untuk diinjeksikan ke prompt
 */
function buildSettingContext(genre) {
  const settings = getSettingByGenre(genre, 3);
  const tips = getSettingTips(genre);
  return {
    contoh_setting: settings,
    tips,
    instruksi_prompt: `Gunakan setting berikut sebagai referensi latar cerita yang autentik:\n${settings.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nTips: ${tips}`
  };
}

module.exports = { SETTING_INDONESIA, getSettingByGenre, getSettingTips, buildSettingContext };
