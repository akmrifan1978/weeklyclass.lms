/**
 * Tajweed rules, as reference material.
 *
 * Bundled rather than fetched: these are settled, centuries-old rules that do
 * not change, and a reference someone opens mid-recitation should not depend on
 * a connection.
 *
 * Described as taught for the recitation of Hafs 'an 'Asim, which is the reading
 * in the overwhelming majority of printed mushafs and the one this app's text
 * uses. Other authentic readings differ in some durations and details, so the
 * screen says which reading these describe rather than presenting them as the
 * only correct form.
 *
 * `descriptionKey` points at a translated sentence; the Arabic name, the letters
 * and the example are the same in every language and live here.
 */

export type TajweedCategory = 'noonSakinah' | 'meemSakinah' | 'madd' | 'other';

export interface TajweedRule {
  id: string;
  /** The Arabic name, as it is known in every language. */
  arabic: string;
  /** Transliteration, used as the heading everywhere. */
  name: string;
  category: TajweedCategory;
  descriptionKey: string;
  /** The letters that trigger the rule, where it is letter-driven. */
  letters?: string;
  /** A short Qur'anic example, with its reference. */
  example?: { text: string; reference: string };
}

export const TAJWEED_RULES: TajweedRule[] = [
  // --- Noon sakinah and tanween -------------------------------------------
  {
    id: 'izhar',
    arabic: 'إظهار',
    name: 'Iẓhār',
    category: 'noonSakinah',
    descriptionKey: 'tajweed.izhar',
    letters: 'ء ه ع ح غ خ',
    example: { text: 'مَنْ آمَنَ', reference: '2:62' },
  },
  {
    id: 'idgham',
    arabic: 'إدغام',
    name: 'Idghām',
    category: 'noonSakinah',
    descriptionKey: 'tajweed.idgham',
    letters: 'ي ر م ل و ن',
    example: { text: 'مِنْ رَّبِّهِمْ', reference: '2:5' },
  },
  {
    id: 'iqlab',
    arabic: 'إقلاب',
    name: 'Iqlāb',
    category: 'noonSakinah',
    descriptionKey: 'tajweed.iqlab',
    letters: 'ب',
    example: { text: 'مِنْ بَعْدِ', reference: '2:27' },
  },
  {
    id: 'ikhfa',
    arabic: 'إخفاء',
    name: 'Ikhfā’',
    category: 'noonSakinah',
    descriptionKey: 'tajweed.ikhfa',
    letters: 'ت ث ج د ذ ز س ش ص ض ط ظ ف ق ك',
    example: { text: 'مِنْ قَبْلِ', reference: '2:25' },
  },

  // --- Meem sakinah --------------------------------------------------------
  {
    id: 'idghamShafawi',
    arabic: 'إدغام شفوي',
    name: 'Idghām Shafawī',
    category: 'meemSakinah',
    descriptionKey: 'tajweed.idghamShafawi',
    letters: 'م',
    example: { text: 'لَهُمْ مَّا', reference: '2:80' },
  },
  {
    id: 'ikhfaShafawi',
    arabic: 'إخفاء شفوي',
    name: 'Ikhfā’ Shafawī',
    category: 'meemSakinah',
    descriptionKey: 'tajweed.ikhfaShafawi',
    letters: 'ب',
    example: { text: 'تَرْمِيهِمْ بِحِجَارَةٍ', reference: '105:4' },
  },
  {
    id: 'izharShafawi',
    arabic: 'إظهار شفوي',
    name: 'Iẓhār Shafawī',
    category: 'meemSakinah',
    descriptionKey: 'tajweed.izharShafawi',
    example: { text: 'هُمْ فِيهَا', reference: '2:25' },
  },

  // --- Madd ----------------------------------------------------------------
  {
    id: 'maddAsli',
    arabic: 'مد أصلي',
    name: 'Madd Aṣlī',
    category: 'madd',
    descriptionKey: 'tajweed.maddAsli',
    letters: 'ا و ي',
    example: { text: 'قَالَ', reference: '2:30' },
  },
  {
    id: 'maddMuttasil',
    arabic: 'مد متصل',
    name: 'Madd Muttaṣil',
    category: 'madd',
    descriptionKey: 'tajweed.maddMuttasil',
    example: { text: 'جَاءَ', reference: '4:43' },
  },
  {
    id: 'maddMunfasil',
    arabic: 'مد منفصل',
    name: 'Madd Munfaṣil',
    category: 'madd',
    descriptionKey: 'tajweed.maddMunfasil',
    example: { text: 'يَا أَيُّهَا', reference: '2:21' },
  },
  {
    id: 'maddLazim',
    arabic: 'مد لازم',
    name: 'Madd Lāzim',
    category: 'madd',
    descriptionKey: 'tajweed.maddLazim',
    example: { text: 'الضَّالِّينَ', reference: '1:7' },
  },

  // --- Other ---------------------------------------------------------------
  {
    id: 'qalqalah',
    arabic: 'قلقلة',
    name: 'Qalqalah',
    category: 'other',
    descriptionKey: 'tajweed.qalqalah',
    letters: 'ق ط ب ج د',
    example: { text: 'قُلْ أَعُوذُ', reference: '113:1' },
  },
  {
    id: 'ghunnah',
    arabic: 'غنة',
    name: 'Ghunnah',
    category: 'other',
    descriptionKey: 'tajweed.ghunnah',
    letters: 'نّ مّ',
    example: { text: 'إِنَّ', reference: '2:6' },
  },
  {
    id: 'lamShamsiyyah',
    arabic: 'لام شمسية',
    name: 'Lām Shamsiyyah',
    category: 'other',
    descriptionKey: 'tajweed.lamShamsiyyah',
    example: { text: 'الشَّمْسُ', reference: '91:1' },
  },
  {
    id: 'lamQamariyyah',
    arabic: 'لام قمرية',
    name: 'Lām Qamariyyah',
    category: 'other',
    descriptionKey: 'tajweed.lamQamariyyah',
    example: { text: 'الْقَمَرُ', reference: '91:2' },
  },
];

export const TAJWEED_CATEGORY_KEYS: Record<TajweedCategory, string> = {
  noonSakinah: 'tajweed.categoryNoonSakinah',
  meemSakinah: 'tajweed.categoryMeemSakinah',
  madd: 'tajweed.categoryMadd',
  other: 'tajweed.categoryOther',
};
