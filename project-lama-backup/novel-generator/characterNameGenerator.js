/*
 * GENERATOR NAMA KARAKTER INDONESIA
 * Menghasilkan nama karakter yang autentik sesuai latar belakang daerah dan kelas sosial.
 */

const NAMA_JAWA = {
  elite: {
    laki: ['Raden Arjuna', 'Raden Satria', 'Raden Bagus', 'Prabu Andika', 'Raden Mas Dimas'],
    perempuan: ['Raden Ayu Sekar', 'Raden Roro Ayu', 'Raden Ajeng Sari', 'Raden Galuh', 'Raden Ayu Kinasih']
  },
  menengah: {
    laki: ['Bagas', 'Wahyu', 'Fajar', 'Rizky', 'Dimas', 'Bima', 'Galang', 'Aryo', 'Surya', 'Adi'],
    perempuan: ['Sekar', 'Ayu', 'Sari', 'Wulan', 'Dewi', 'Putri', 'Kinanti', 'Laras', 'Nisa', 'Hana']
  },
  bawah: {
    laki: ['Paijo', 'Parno', 'Slamet', 'Budiman', 'Warno', 'Sukarno', 'Tarno', 'Parmin'],
    perempuan: ['Mbok Sari', 'Juminten', 'Lastri', 'Sumiati', 'Parti', 'Sukinah', 'Rukem']
  }
};

const NAMA_SUNDA = {
  elite: {
    laki: ['Raden Asep', 'Raden Dedi', 'Raden Yana', 'Raden Tatang'],
    perempuan: ['Neng Geulis', 'Raden Alit Siti', 'Raden Euis', 'Raden Neneng']
  },
  menengah: {
    laki: ['Asep', 'Dedi', 'Yana', 'Ujang', 'Ade', 'Riki', 'Agus', 'Hendri'],
    perempuan: ['Euis', 'Siti', 'Neng', 'Yani', 'Tika', 'Desi', 'Ai', 'Rani']
  },
  bawah: {
    laki: ['Ujang', 'Aceng', 'Entis', 'Maman', 'Yoyo', 'Dudung'],
    perempuan: ['Eneng', 'Cicih', 'Iyah', 'Omah', 'Nyi Sari']
  }
};

const NAMA_BATAK = {
  elite: {
    laki: ['Raja Hasibuan', 'Tuan Siahaan', 'Raja Pangaribuan', 'Tuan Nasution'],
    perempuan: ['Boru Hasibuan', 'Boru Simatupang', 'Boru Panjaitan', 'Nona Nasution']
  },
  menengah: {
    laki: ['Benny', 'Hotman', 'Fredy', 'Jonatan', 'Rudi', 'Parlin', 'Rikson'],
    perempuan: ['Rotua', 'Sondang', 'Rahel', 'Tiurma', 'Mariana', 'Nurlela']
  },
  bawah: {
    laki: ['Patar', 'Togap', 'Lamhot', 'Ansen', 'Binsar'],
    perempuan: ['Mida', 'Roida', 'Neria', 'Tinta']
  }
};

const NAMA_BUGIS = {
  elite: {
    laki: ['Andi Ahmad', 'Andi Baso', 'Andi Makkasau', 'Andi Tenri'],
    perempuan: ['I Tenri Bali', 'Andi Fatimah', 'Andi Suryani', 'I Besse']
  },
  menengah: {
    laki: ['Aco', 'Reza', 'Fauzi', 'Akbar', 'Ruslan', 'Hairul'],
    perempuan: ['Suri', 'Hasna', 'Nur', 'Rahma', 'Suci', 'Hafsa']
  },
  bawah: {
    laki: ['Daeng Malewa', 'Daeng Parani', 'Ambe Siri'],
    perempuan: ['Indo Sari', 'Puang Besse', 'Nene Sari']
  }
};

const NAMA_MINANG = {
  elite: {
    laki: ['Datuk Sutan', 'Bagindo Rahman', 'Sutan Hamzah', 'Datuk Marajo'],
    perempuan: ['Puti Rahmah', 'Puti Salma', 'Bundo Kandung', 'Puti Helmi']
  },
  menengah: {
    laki: ['Reza', 'Hendra', 'Fadly', 'Wendi', 'Aldi', 'Arif'],
    perempuan: ['Seli', 'Veni', 'Elsa', 'Dina', 'Nisa', 'Fitri']
  },
  bawah: {
    laki: ['Buyuang', 'Ajo', 'Mak Itam', 'Panjang'],
    perempuan: ['Piak', 'Upiak', 'Mak Intan']
  }
};

const NAMA_BETAWI = {
  elite: {
    laki: ['Haji Baba', 'Tuan Ridwan', 'Haji Salim', 'Mas Beye'],
    perempuan: ['Hajah Ratu', 'Mpok Inah', 'Nyak Sari', 'Tuan Putri']
  },
  menengah: {
    laki: ['Jamal', 'Hasan', 'Ridwan', 'Udin', 'Jali', 'Dul', 'Robi'],
    perempuan: ['Mpok Siti', 'Iyem', 'Rohani', 'Sari', 'Ipah', 'Romlah']
  },
  bawah: {
    laki: ['Bang Jali', 'Si Doel', 'Babe Saman', 'Encang', 'Haji Item'],
    perempuan: ['Emak Tini', 'Nyak Mah', 'Abang Doel Putri']
  }
};

const NAMA_UMUM = {
  elite: {
    laki: ['Adrian', 'Kevin', 'Rafael', 'Gabriel', 'Nathan', 'Alexander', 'Christian'],
    perempuan: ['Natasha', 'Vanessa', 'Jessica', 'Anastasia', 'Clarissa', 'Priscilla']
  },
  menengah: {
    laki: ['Rizki', 'Aldi', 'Fajar', 'Dani', 'Evan', 'Rafi', 'Naufal', 'Irfan', 'Gilang'],
    perempuan: ['Aulia', 'Indah', 'Amelia', 'Putri', 'Sarah', 'Tiara', 'Lestari', 'Nadia', 'Zahra']
  },
  bawah: {
    laki: ['Agus', 'Eko', 'Seto', 'Heri', 'Tono', 'Budi', 'Wahyu'],
    perempuan: ['Yuli', 'Rina', 'Tini', 'Wati', 'Susi', 'Dewi']
  }
};

const MARGA = {
  jawa: ['Santoso', 'Wijaya', 'Kusuma', 'Saputra', 'Wibowo', 'Sutanto', 'Hartono', 'Nugroho'],
  sunda: ['Rahayu', 'Supriatna', 'Kusumah', 'Somantri', 'Permana', 'Suryana'],
  batak: ['Siahaan', 'Nasution', 'Hasibuan', 'Panjaitan', 'Sitompul', 'Siregar', 'Tobing'],
  bugis: ['Mattulada', 'Amir', 'Malik', 'Rahman', 'Hamid', 'Rahim'],
  minang: ['Datuak', 'Sutan', 'Katik', 'Bagindo', 'Marah', 'Sidi'],
  betawi: ['Bin Saman', 'Binti Maryam', 'Saputra', 'Wahid', 'Karim'],
  umum: ['Pratama', 'Sanjaya', 'Purnama', 'Utama', 'Putra', 'Mahardika', 'Perdana']
};

const NAMA_PANGGILAN = {
  laki: ['Mas', 'Bang', 'Kak', 'Bro', 'Om', 'Pak'],
  perempuan: ['Mbak', 'Kak', 'Neng', 'Mpok', 'Teh', 'Sis']
};

function acak(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Hasilkan nama karakter Indonesia yang autentik
 * @param {string} gender - 'laki-laki' | 'perempuan'
 * @param {string} daerah - 'jawa'|'sunda'|'batak'|'bugis'|'minang'|'betawi'|'umum'
 * @param {string} kelas_sosial - 'elite'|'menengah'|'bawah'
 * @returns {{ nama_depan: string, nama_belakang: string, nama_lengkap: string, nama_panggilan: string }}
 */
function generateNamaIndonesia(gender = 'laki-laki', daerah = 'umum', kelas_sosial = 'menengah') {
  const genderKey = gender === 'perempuan' ? 'perempuan' : 'laki';
  const kelasKey = ['elite', 'menengah', 'bawah'].includes(kelas_sosial) ? kelas_sosial : 'menengah';
  const daerahKey = ['jawa', 'sunda', 'batak', 'bugis', 'minang', 'betawi'].includes(daerah) ? daerah : 'umum';

  const bankNama = {
    jawa: NAMA_JAWA, sunda: NAMA_SUNDA, batak: NAMA_BATAK,
    bugis: NAMA_BUGIS, minang: NAMA_MINANG, betawi: NAMA_BETAWI, umum: NAMA_UMUM
  };

  const namaBank = bankNama[daerahKey];
  const namaDepan = acak(namaBank[kelasKey][genderKey]);
  const namaBelakang = acak(MARGA[daerahKey] || MARGA.umum);
  const sapaan = acak(NAMA_PANGGILAN[genderKey]);
  const namaLengkap = `${namaDepan} ${namaBelakang}`;

  // Nama panggilan: ambil kata pertama yang bukan gelar
  const namaWords = namaDepan.split(' ');
  const gelar = ['Raden', 'Mas', 'Bang', 'Tuan', 'Andi', 'Haji', 'Boru', 'Puti', 'Datuk', 'Bagindo', 'Mpok'];
  const namaPanggilanBase = namaWords.find(w => !gelar.includes(w)) || namaWords[namaWords.length - 1];

  const namaPanggilan = kelas_sosial === 'bawah'
    ? namaDepan
    : `${sapaan} ${namaPanggilanBase}`;

  return {
    nama_depan: namaDepan,
    nama_belakang: namaBelakang,
    nama_lengkap: namaLengkap,
    nama_panggilan: namaPanggilan,
    daerah: daerahKey,
    kelas_sosial: kelasKey
  };
}

/**
 * Hasilkan set karakter lengkap untuk novel
 * @param {string} genre - genre novel
 * @param {string} daerah - latar daerah dominan
 * @returns {Array<object>} array karakter
 */
function generateSetKarakter(genre = 'romance', daerah = 'umum') {
  const isRomance = genre.toLowerCase().includes('romance') || genre.toLowerCase().includes('islami');
  const isHoror = genre.toLowerCase().includes('horor');
  const isFantasi = genre.toLowerCase().includes('fantasi') || genre.toLowerCase().includes('kerajaan');

  const karakter = [];

  if (isFantasi || daerah === 'jawa') {
    karakter.push({
      ...generateNamaIndonesia('laki-laki', 'jawa', 'elite'),
      peran: 'Protagonis Utama'
    });
    karakter.push({
      ...generateNamaIndonesia('perempuan', 'jawa', 'menengah'),
      peran: 'Tokoh Utama Wanita'
    });
    karakter.push({
      ...generateNamaIndonesia('laki-laki', 'jawa', 'elite'),
      peran: 'Antagonis'
    });
  } else if (isRomance) {
    const daerahPria = daerah !== 'umum' ? daerah : 'umum';
    karakter.push({
      ...generateNamaIndonesia('laki-laki', daerahPria, 'elite'),
      peran: 'Male Lead'
    });
    karakter.push({
      ...generateNamaIndonesia('perempuan', daerah, 'menengah'),
      peran: 'Female Lead'
    });
    karakter.push({
      ...generateNamaIndonesia('perempuan', daerah, 'menengah'),
      peran: 'Sahabat Female Lead'
    });
  } else {
    karakter.push({
      ...generateNamaIndonesia('laki-laki', daerah, 'menengah'),
      peran: 'Protagonis'
    });
    karakter.push({
      ...generateNamaIndonesia('perempuan', daerah, 'menengah'),
      peran: 'Karakter Pendukung'
    });
  }

  return karakter;
}

module.exports = { generateNamaIndonesia, generateSetKarakter };
