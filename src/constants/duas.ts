/**
 * Authentic supplications, bundled.
 *
 * ON "AUTHENTIC": every duʿāʾ here is either Qurʾānic or from Ṣaḥīḥ al-Bukhārī,
 * Ṣaḥīḥ Muslim or Abū Dāwūd, and each carries its reference so it can be
 * checked. That reference is the point — a duʿāʾ without a source is exactly
 * what people are trying to avoid when they look for authentic ones.
 *
 * Bundled rather than fetched because the free Arabic datasets (Ḥiṣn al-Muslim
 * and the rest) carry no translation at all, and because a supplication you
 * reach for on waking or in distress should not need a connection.
 *
 * THE ARABIC IS THE SUPPLICATION. The transliteration is an aid to pronouncing
 * it and the translation conveys its meaning; neither replaces the Arabic, and
 * the screen presents them in that order for that reason.
 */

export type DuaCategory =
  | 'daily'
  | 'prayer'
  | 'food'
  | 'travel'
  | 'distress'
  | 'protection';

export interface Dua {
  id: string;
  category: DuaCategory;
  /** What it is for. Translated through `titleKey`. */
  titleKey: string;
  arabic: string;
  transliteration: string;
  /** Meaning, translated per language through the locale files. */
  meaningKey: string;
  /** Qurʾān `surah:ayah`, or collection and number. */
  reference: string;
  /** How many times it is said, where the narration specifies one. */
  repeat?: number;
}

export const DUA_CATEGORY_KEYS: Record<DuaCategory, string> = {
  daily: 'dua.categoryDaily',
  prayer: 'dua.categoryPrayer',
  food: 'dua.categoryFood',
  travel: 'dua.categoryTravel',
  distress: 'dua.categoryDistress',
  protection: 'dua.categoryProtection',
};

export const DUAS: Dua[] = [
  // --- Daily ---------------------------------------------------------------
  {
    id: 'waking',
    category: 'daily',
    titleKey: 'dua.waking',
    arabic: 'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ',
    transliteration:
      'Al-ḥamdu lillāhi alladhī aḥyānā baʿda mā amātanā wa ilayhi al-nushūr',
    meaningKey: 'dua.wakingMeaning',
    reference: 'Bukhārī 6312',
  },
  {
    id: 'sleeping',
    category: 'daily',
    titleKey: 'dua.sleeping',
    arabic: 'بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا',
    transliteration: 'Bismika Allāhumma amūtu wa aḥyā',
    meaningKey: 'dua.sleepingMeaning',
    reference: 'Bukhārī 6324',
  },
  {
    id: 'leavingHome',
    category: 'daily',
    titleKey: 'dua.leavingHome',
    arabic: 'بِسْمِ اللَّهِ، تَوَكَّلْتُ عَلَى اللَّهِ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',
    transliteration: 'Bismillāh, tawakkaltu ʿalā Allāh, wa lā ḥawla wa lā quwwata illā billāh',
    meaningKey: 'dua.leavingHomeMeaning',
    reference: 'Abū Dāwūd 5095',
  },
  {
    id: 'enteringMasjid',
    category: 'daily',
    titleKey: 'dua.enteringMasjid',
    arabic: 'اللَّهُمَّ افْتَحْ لِي أَبْوَابَ رَحْمَتِكَ',
    transliteration: 'Allāhumma iftaḥ lī abwāba raḥmatik',
    meaningKey: 'dua.enteringMasjidMeaning',
    reference: 'Muslim 713',
  },
  {
    id: 'leavingMasjid',
    category: 'daily',
    titleKey: 'dua.leavingMasjid',
    arabic: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ مِنْ فَضْلِكَ',
    transliteration: 'Allāhumma innī asʾaluka min faḍlik',
    meaningKey: 'dua.leavingMasjidMeaning',
    reference: 'Muslim 713',
  },

  // --- Around prayer -------------------------------------------------------
  {
    id: 'afterAdhan',
    category: 'prayer',
    titleKey: 'dua.afterAdhan',
    arabic:
      'اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ وَالصَّلَاةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ',
    transliteration:
      'Allāhumma rabba hādhihi al-daʿwati al-tāmmah wa al-ṣalāti al-qāʾimah, āti Muḥammadan al-wasīlata wa al-faḍīlah',
    meaningKey: 'dua.afterAdhanMeaning',
    reference: 'Bukhārī 614',
  },
  {
    id: 'afterPrayerTasbih',
    category: 'prayer',
    titleKey: 'dua.afterPrayerTasbih',
    arabic: 'سُبْحَانَ اللَّهِ، وَالْحَمْدُ لِلَّهِ، وَاللَّهُ أَكْبَرُ',
    transliteration: 'Subḥān Allāh, wa al-ḥamdu lillāh, wa Allāhu akbar',
    meaningKey: 'dua.afterPrayerTasbihMeaning',
    reference: 'Muslim 595',
    repeat: 33,
  },
  {
    id: 'istighfar',
    category: 'prayer',
    titleKey: 'dua.istighfar',
    arabic: 'أَسْتَغْفِرُ اللَّهَ',
    transliteration: 'Astaghfirullāh',
    meaningKey: 'dua.istighfarMeaning',
    reference: 'Muslim 591',
    repeat: 3,
  },

  // --- Food ----------------------------------------------------------------
  {
    id: 'beforeEating',
    category: 'food',
    titleKey: 'dua.beforeEating',
    arabic: 'بِسْمِ اللَّهِ',
    transliteration: 'Bismillāh',
    meaningKey: 'dua.beforeEatingMeaning',
    reference: 'Abū Dāwūd 3767',
  },
  {
    id: 'afterEating',
    category: 'food',
    titleKey: 'dua.afterEating',
    arabic:
      'الْحَمْدُ لِلَّهِ الَّذِي أَطْعَمَنِي هَذَا وَرَزَقَنِيهِ مِنْ غَيْرِ حَوْلٍ مِنِّي وَلَا قُوَّةٍ',
    transliteration:
      'Al-ḥamdu lillāhi alladhī aṭʿamanī hādhā wa razaqanīhi min ghayri ḥawlin minnī wa lā quwwah',
    meaningKey: 'dua.afterEatingMeaning',
    reference: 'Abū Dāwūd 4023',
  },

  // --- Travel --------------------------------------------------------------
  {
    id: 'travel',
    category: 'travel',
    titleKey: 'dua.travel',
    arabic: 'سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ وَإِنَّا إِلَى رَبِّنَا لَمُنْقَلِبُونَ',
    transliteration:
      'Subḥāna alladhī sakhkhara lanā hādhā wa mā kunnā lahu muqrinīn, wa innā ilā rabbinā lamunqalibūn',
    meaningKey: 'dua.travelMeaning',
    reference: 'Qurʾān 43:13–14 · Muslim 1342',
  },

  // --- Distress ------------------------------------------------------------
  {
    id: 'distress',
    category: 'distress',
    titleKey: 'dua.distress',
    arabic: 'لَا إِلَهَ إِلَّا اللَّهُ الْعَظِيمُ الْحَلِيمُ، لَا إِلَهَ إِلَّا اللَّهُ رَبُّ الْعَرْشِ الْعَظِيمِ',
    transliteration:
      'Lā ilāha illā Allāhu al-ʿAẓīmu al-Ḥalīm, lā ilāha illā Allāhu rabbu al-ʿarshi al-ʿaẓīm',
    meaningKey: 'dua.distressMeaning',
    reference: 'Bukhārī 6346',
  },
  {
    id: 'anxiety',
    category: 'distress',
    titleKey: 'dua.anxiety',
    arabic: 'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ',
    transliteration: 'Ḥasbunā Allāhu wa niʿma al-wakīl',
    meaningKey: 'dua.anxietyMeaning',
    reference: 'Qurʾān 3:173 · Bukhārī 4563',
  },
  {
    id: 'illness',
    category: 'distress',
    titleKey: 'dua.illness',
    arabic: 'اللَّهُمَّ رَبَّ النَّاسِ، أَذْهِبِ الْبَأْسَ، اشْفِ أَنْتَ الشَّافِي',
    transliteration: 'Allāhumma rabba al-nās, adhhib al-baʾs, ishfi anta al-shāfī',
    meaningKey: 'dua.illnessMeaning',
    reference: 'Bukhārī 5675',
  },

  // --- Protection ----------------------------------------------------------
  {
    id: 'morningEvening',
    category: 'protection',
    titleKey: 'dua.morningEvening',
    arabic:
      'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',
    transliteration:
      'Bismillāhi alladhī lā yaḍurru maʿa ismihi shayʾun fī al-arḍi wa lā fī al-samāʾi wa huwa al-Samīʿu al-ʿAlīm',
    meaningKey: 'dua.morningEveningMeaning',
    reference: 'Abū Dāwūd 5088',
    repeat: 3,
  },
  {
    id: 'sayyidulIstighfar',
    category: 'protection',
    titleKey: 'dua.sayyidulIstighfar',
    arabic:
      'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ',
    transliteration:
      'Allāhumma anta rabbī lā ilāha illā ant, khalaqtanī wa anā ʿabduk, wa anā ʿalā ʿahdika wa waʿdika mā istaṭaʿt',
    meaningKey: 'dua.sayyidulIstighfarMeaning',
    reference: 'Bukhārī 6306',
  },
  {
    id: 'refuge',
    category: 'protection',
    titleKey: 'dua.refuge',
    arabic: 'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ',
    transliteration: 'Aʿūdhu bikalimāti Allāhi al-tāmmāti min sharri mā khalaq',
    meaningKey: 'dua.refugeMeaning',
    reference: 'Muslim 2708',
    repeat: 3,
  },
];
