/**
 * GENERATED FILE — do not edit by hand.
 * Source: chrome-extension/skills/bundled.json
 * Regenerate: python3 scripts/sync-skills.py
 */

const BUNDLED_SKILLS = [
  {
    "id": "scrape-tiktokshop",
    "name": "Scrape produk TikTok Shop",
    "description": "Buka halaman pencarian/kategori TikTok Shop, tunggu render, cek CAPTCHA, lalu kumpulkan data produk. Selector diambil dari skill custom \"tiktokshop-selectors\" kalau ada.",
    "params": [
      {
        "name": "url",
        "required": true,
        "description": "URL halaman TikTok Shop (search/kategori/toko)"
      },
      {
        "name": "items",
        "required": false,
        "default": 40,
        "description": "Berapa produk yang mau diambil"
      },
      {
        "name": "scroll",
        "required": false,
        "default": 8,
        "description": "Berapa kali scroll untuk memuat lazy-load"
      }
    ],
    "steps": [
      {
        "action": "navigate",
        "url": "{{url}}"
      },
      {
        "action": "wait",
        "ms": 3000
      },
      {
        "action": "assert",
        "assert": "noCaptcha",
        "selector": "",
        "text": ""
      },
      {
        "action": "wait",
        "ms": 2000
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1500
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1500
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1500
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1500
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1500
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1500
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1500
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1500
      },
      {
        "action": "collect",
        "selector": "[data-e2e*=\"product\"], a[href*=\"/product/\"], a[href*=\"/pdp/\"], div[class*=\"ProductCard\"]",
        "as": "produk",
        "limit": "{{items}}",
        "dedupe": true
      },
      {
        "action": "assert",
        "assert": "countAtLeast",
        "selector": "a[href*=\"/product/\"], a[href*=\"/pdp/\"], [data-e2e*=\"product\"]",
        "min": 1
      },
      {
        "action": "report",
        "template": "Scraping selesai.\n\nURL: {{url}}\nProduk terkumpul: {{produk.0.text}}\n\nCek hasil lengkap di data yang gw kirim."
      }
    ]
  },
  {
    "id": "check-captcha",
    "name": "Cek apakah halaman kena CAPTCHA",
    "description": "Buka URL lalu deteksi CAPTCHA. Berguna untuk memastikan sesi Chrome masih sehat sebelum scraping panjang.",
    "params": [
      {
        "name": "url",
        "required": true
      }
    ],
    "steps": [
      {
        "action": "navigate",
        "url": "{{url}}"
      },
      {
        "action": "wait",
        "ms": 3000
      },
      {
        "action": "assert",
        "assert": "noCaptcha"
      },
      {
        "action": "collect",
        "selector": "h1, h2, [data-e2e=\"page-title\"]",
        "as": "judul",
        "limit": 3
      },
      {
        "action": "report",
        "template": "Aman — tidak ada CAPTCHA.\nJudul halaman: {{judul.0.text}}"
      }
    ]
  },
  {
    "id": "page-audit",
    "name": "Audit halaman",
    "description": "Periksa satu halaman: judul, jumlah link, jumlah gambar, kemunculan CAPTCHA, dan screenshot. Pakai ini dulu sebelum menulis selector baru.",
    "params": [
      {
        "name": "url",
        "required": true
      }
    ],
    "steps": [
      {
        "action": "navigate",
        "url": "{{url}}"
      },
      {
        "action": "wait",
        "ms": 2500
      },
      {
        "action": "screenshot",
        "as": "gambar"
      },
      {
        "action": "collect",
        "selector": "a[href]",
        "as": "links",
        "limit": 500
      },
      {
        "action": "collect",
        "selector": "img[src]",
        "as": "gambarList",
        "limit": 200
      },
      {
        "action": "report",
        "template": "Audit {{url}}\n\nLink: {{links}} item\nGambar: {{gambarList}} item"
      }
    ]
  },
  {
    "id": "scroll-and-read",
    "name": "Scroll sampai bawah lalu baca teks",
    "description": "Untuk halaman dengan lazy-load: scroll bertahap sampai tinggi halaman tidak bertambah lagi, baru ambil teksnya.",
    "params": [
      {
        "name": "url",
        "required": true
      },
      {
        "name": "putaran",
        "required": false,
        "default": 10
      }
    ],
    "steps": [
      {
        "action": "navigate",
        "url": "{{url}}"
      },
      {
        "action": "wait",
        "ms": 2500
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1200
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1200
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1200
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1200
      },
      {
        "action": "scroll",
        "to": "bottom",
        "settle": 1200
      },
      {
        "action": "collect",
        "selector": "body",
        "as": "isi",
        "limit": 1
      },
      {
        "action": "report",
        "template": "Isi {{url}}:\n\n{{isi.0.text}}",
        "final": true
      }
    ]
  },
  {
    "id": "watch-element",
    "name": "Tunggu elemen tertentu muncul",
    "description": "Tunggu selector muncul (mis. tombol Generate selesai aktif), lalu screenshot. Berguna untuk alur video generator.",
    "params": [
      {
        "name": "selector",
        "required": true
      },
      {
        "name": "timeout",
        "required": false,
        "default": 30000
      }
    ],
    "steps": [
      {
        "action": "waitFor",
        "selector": "{{selector}}",
        "timeout": "{{timeout}}"
      },
      {
        "action": "screenshot",
        "as": "bukti"
      },
      {
        "action": "report",
        "template": "Elemen {{selector}} sudah muncul."
      }
    ]
  }
];
