/**
 * The ninety-nine names, as text.
 *
 * WHAT IS BUNDLED AND WHAT IS NOT, deliberately. The Arabic, the
 * transliteration and the short meaning are here: they are settled, they are
 * the same in every printed list, and an app that made a reader fetch them
 * would be worse for no gain. Anything longer than a few words is NOT here.
 *
 * A paragraph explaining a name of Allah is teaching, and teaching in a dawah
 * centre's app should come from that centre's teachers rather than from
 * whoever assembled a data file. So the explanation is a field an admin fills
 * in — the same rule the rest of this app follows for religious prose, and the
 * same reason the Seerah chapters were never shipped with the build.
 *
 * The transliterations use a light scheme rather than a strict academic one:
 * they exist to help somebody say the name, not to encode the Arabic
 * reversibly. The Arabic beside them is the text that matters.
 */

export interface DivineName {
  /** 1-99, the conventional ordering. */
  number: number;
  arabic: string;
  transliteration: string;
  /** The short English gloss, as it appears in the standard lists. */
  meaning: string;
}

export const ASMA_UL_HUSNA: DivineName[] = [
  { number: 1, arabic: 'الرَّحْمَٰن', transliteration: 'Ar-Rahman', meaning: 'The Most Compassionate' },
  { number: 2, arabic: 'الرَّحِيم', transliteration: 'Ar-Raheem', meaning: 'The Most Merciful' },
  { number: 3, arabic: 'الْمَلِك', transliteration: 'Al-Malik', meaning: 'The King, The Sovereign' },
  { number: 4, arabic: 'الْقُدُّوس', transliteration: 'Al-Quddus', meaning: 'The Most Holy' },
  { number: 5, arabic: 'السَّلَام', transliteration: 'As-Salam', meaning: 'The Source of Peace' },
  { number: 6, arabic: 'الْمُؤْمِن', transliteration: "Al-Mu'min", meaning: 'The Giver of Security' },
  { number: 7, arabic: 'الْمُهَيْمِن', transliteration: 'Al-Muhaymin', meaning: 'The Guardian' },
  { number: 8, arabic: 'الْعَزِيز', transliteration: 'Al-Azeez', meaning: 'The Almighty' },
  { number: 9, arabic: 'الْجَبَّار', transliteration: 'Al-Jabbar', meaning: 'The Compeller' },
  { number: 10, arabic: 'الْمُتَكَبِّر', transliteration: 'Al-Mutakabbir', meaning: 'The Supreme in Greatness' },
  { number: 11, arabic: 'الْخَالِق', transliteration: 'Al-Khaliq', meaning: 'The Creator' },
  { number: 12, arabic: 'الْبَارِئ', transliteration: "Al-Bari'", meaning: 'The Originator' },
  { number: 13, arabic: 'الْمُصَوِّر', transliteration: 'Al-Musawwir', meaning: 'The Fashioner of Forms' },
  { number: 14, arabic: 'الْغَفَّار', transliteration: 'Al-Ghaffar', meaning: 'The Repeatedly Forgiving' },
  { number: 15, arabic: 'الْقَهَّار', transliteration: 'Al-Qahhar', meaning: 'The Subduer' },
  { number: 16, arabic: 'الْوَهَّاب', transliteration: 'Al-Wahhab', meaning: 'The Bestower' },
  { number: 17, arabic: 'الرَّزَّاق', transliteration: 'Ar-Razzaq', meaning: 'The Provider' },
  { number: 18, arabic: 'الْفَتَّاح', transliteration: 'Al-Fattah', meaning: 'The Opener, The Judge' },
  { number: 19, arabic: 'الْعَلِيم', transliteration: 'Al-Aleem', meaning: 'The All-Knowing' },
  { number: 20, arabic: 'الْقَابِض', transliteration: 'Al-Qabid', meaning: 'The Withholder' },
  { number: 21, arabic: 'الْبَاسِط', transliteration: 'Al-Basit', meaning: 'The Extender' },
  { number: 22, arabic: 'الْخَافِض', transliteration: 'Al-Khafid', meaning: 'The Abaser' },
  { number: 23, arabic: 'الرَّافِع', transliteration: "Ar-Rafi'", meaning: 'The Exalter' },
  { number: 24, arabic: 'الْمُعِزّ', transliteration: "Al-Mu'izz", meaning: 'The Giver of Honour' },
  { number: 25, arabic: 'الْمُذِلّ', transliteration: 'Al-Muzill', meaning: 'The Giver of Dishonour' },
  { number: 26, arabic: 'السَّمِيع', transliteration: "As-Samee'", meaning: 'The All-Hearing' },
  { number: 27, arabic: 'الْبَصِير', transliteration: 'Al-Baseer', meaning: 'The All-Seeing' },
  { number: 28, arabic: 'الْحَكَم', transliteration: 'Al-Hakam', meaning: 'The Judge' },
  { number: 29, arabic: 'الْعَدْل', transliteration: 'Al-Adl', meaning: 'The Utterly Just' },
  { number: 30, arabic: 'اللَّطِيف', transliteration: 'Al-Lateef', meaning: 'The Subtle, The Gentle' },
  { number: 31, arabic: 'الْخَبِير', transliteration: 'Al-Khabeer', meaning: 'The All-Aware' },
  { number: 32, arabic: 'الْحَلِيم', transliteration: 'Al-Haleem', meaning: 'The Forbearing' },
  { number: 33, arabic: 'الْعَظِيم', transliteration: 'Al-Azeem', meaning: 'The Magnificent' },
  { number: 34, arabic: 'الْغَفُور', transliteration: 'Al-Ghafoor', meaning: 'The Much-Forgiving' },
  { number: 35, arabic: 'الشَّكُور', transliteration: 'Ash-Shakoor', meaning: 'The Most Appreciative' },
  { number: 36, arabic: 'الْعَلِيّ', transliteration: 'Al-Aliyy', meaning: 'The Most High' },
  { number: 37, arabic: 'الْكَبِير', transliteration: 'Al-Kabeer', meaning: 'The Most Great' },
  { number: 38, arabic: 'الْحَفِيظ', transliteration: 'Al-Hafeez', meaning: 'The Preserver' },
  { number: 39, arabic: 'الْمُقِيت', transliteration: 'Al-Muqeet', meaning: 'The Sustainer' },
  { number: 40, arabic: 'الْحَسِيب', transliteration: 'Al-Haseeb', meaning: 'The Reckoner' },
  { number: 41, arabic: 'الْجَلِيل', transliteration: 'Al-Jaleel', meaning: 'The Majestic' },
  { number: 42, arabic: 'الْكَرِيم', transliteration: 'Al-Kareem', meaning: 'The Most Generous' },
  { number: 43, arabic: 'الرَّقِيب', transliteration: 'Ar-Raqeeb', meaning: 'The Watchful' },
  { number: 44, arabic: 'الْمُجِيب', transliteration: 'Al-Mujeeb', meaning: 'The Responsive' },
  { number: 45, arabic: 'الْوَاسِع', transliteration: "Al-Wasi'", meaning: 'The All-Encompassing' },
  { number: 46, arabic: 'الْحَكِيم', transliteration: 'Al-Hakeem', meaning: 'The All-Wise' },
  { number: 47, arabic: 'الْوَدُود', transliteration: 'Al-Wadood', meaning: 'The Most Loving' },
  { number: 48, arabic: 'الْمَجِيد', transliteration: 'Al-Majeed', meaning: 'The Most Glorious' },
  { number: 49, arabic: 'الْبَاعِث', transliteration: "Al-Ba'ith", meaning: 'The Resurrector' },
  { number: 50, arabic: 'الشَّهِيد', transliteration: 'Ash-Shaheed', meaning: 'The Witness' },
  { number: 51, arabic: 'الْحَقّ', transliteration: 'Al-Haqq', meaning: 'The Absolute Truth' },
  { number: 52, arabic: 'الْوَكِيل', transliteration: 'Al-Wakeel', meaning: 'The Trustee' },
  { number: 53, arabic: 'الْقَوِيّ', transliteration: 'Al-Qawiyy', meaning: 'The All-Strong' },
  { number: 54, arabic: 'الْمَتِين', transliteration: 'Al-Mateen', meaning: 'The Firm, The Steadfast' },
  { number: 55, arabic: 'الْوَلِيّ', transliteration: 'Al-Waliyy', meaning: 'The Protecting Friend' },
  { number: 56, arabic: 'الْحَمِيد', transliteration: 'Al-Hameed', meaning: 'The Praiseworthy' },
  { number: 57, arabic: 'الْمُحْصِي', transliteration: 'Al-Muhsee', meaning: 'The Enumerator' },
  { number: 58, arabic: 'الْمُبْدِئ', transliteration: "Al-Mubdi'", meaning: 'The Originator' },
  { number: 59, arabic: 'الْمُعِيد', transliteration: "Al-Mu'eed", meaning: 'The Restorer' },
  { number: 60, arabic: 'الْمُحْيِي', transliteration: 'Al-Muhyee', meaning: 'The Giver of Life' },
  { number: 61, arabic: 'الْمُمِيت', transliteration: 'Al-Mumeet', meaning: 'The Bringer of Death' },
  { number: 62, arabic: 'الْحَيّ', transliteration: 'Al-Hayy', meaning: 'The Ever-Living' },
  { number: 63, arabic: 'الْقَيُّوم', transliteration: 'Al-Qayyoom', meaning: 'The Sustainer of All' },
  { number: 64, arabic: 'الْوَاجِد', transliteration: 'Al-Wajid', meaning: 'The Finder' },
  { number: 65, arabic: 'الْمَاجِد', transliteration: 'Al-Majid', meaning: 'The Noble' },
  { number: 66, arabic: 'الْوَاحِد', transliteration: 'Al-Wahid', meaning: 'The One' },
  { number: 67, arabic: 'الْأَحَد', transliteration: 'Al-Ahad', meaning: 'The Unique, The Indivisible' },
  { number: 68, arabic: 'الصَّمَد', transliteration: 'As-Samad', meaning: 'The Eternal Refuge' },
  { number: 69, arabic: 'الْقَادِر', transliteration: 'Al-Qadir', meaning: 'The Capable' },
  { number: 70, arabic: 'الْمُقْتَدِر', transliteration: 'Al-Muqtadir', meaning: 'The Omnipotent' },
  { number: 71, arabic: 'الْمُقَدِّم', transliteration: 'Al-Muqaddim', meaning: 'The Expediter' },
  { number: 72, arabic: 'الْمُؤَخِّر', transliteration: "Al-Mu'akhkhir", meaning: 'The Delayer' },
  { number: 73, arabic: 'الْأَوَّل', transliteration: 'Al-Awwal', meaning: 'The First' },
  { number: 74, arabic: 'الْآخِر', transliteration: 'Al-Akhir', meaning: 'The Last' },
  { number: 75, arabic: 'الظَّاهِر', transliteration: 'Az-Zahir', meaning: 'The Manifest' },
  { number: 76, arabic: 'الْبَاطِن', transliteration: 'Al-Batin', meaning: 'The Hidden' },
  { number: 77, arabic: 'الْوَالِي', transliteration: 'Al-Walee', meaning: 'The Governor' },
  { number: 78, arabic: 'الْمُتَعَالِي', transliteration: "Al-Muta'ali", meaning: 'The Most Exalted' },
  { number: 79, arabic: 'الْبَرّ', transliteration: 'Al-Barr', meaning: 'The Source of All Goodness' },
  { number: 80, arabic: 'التَّوَّاب', transliteration: 'At-Tawwab', meaning: 'The Ever-Accepting of Repentance' },
  { number: 81, arabic: 'الْمُنْتَقِم', transliteration: 'Al-Muntaqim', meaning: 'The Avenger' },
  { number: 82, arabic: 'الْعَفُوّ', transliteration: 'Al-Afuww', meaning: 'The Pardoner' },
  { number: 83, arabic: 'الرَّءُوف', transliteration: "Ar-Ra'oof", meaning: 'The Most Kind' },
  { number: 84, arabic: 'مَالِكُ الْمُلْك', transliteration: 'Malik-ul-Mulk', meaning: 'Master of the Kingdom' },
  { number: 85, arabic: 'ذُو الْجَلَالِ وَالْإِكْرَام', transliteration: 'Dhul-Jalali wal-Ikram', meaning: 'Lord of Majesty and Generosity' },
  { number: 86, arabic: 'الْمُقْسِط', transliteration: 'Al-Muqsit', meaning: 'The Equitable' },
  { number: 87, arabic: 'الْجَامِع', transliteration: "Al-Jami'", meaning: 'The Gatherer' },
  { number: 88, arabic: 'الْغَنِيّ', transliteration: 'Al-Ghaniyy', meaning: 'The Self-Sufficient' },
  { number: 89, arabic: 'الْمُغْنِي', transliteration: 'Al-Mughnee', meaning: 'The Enricher' },
  { number: 90, arabic: 'الْمَانِع', transliteration: "Al-Mani'", meaning: 'The Preventer' },
  { number: 91, arabic: 'الضَّارّ', transliteration: 'Ad-Darr', meaning: 'The Creator of Harm' },
  { number: 92, arabic: 'النَّافِع', transliteration: "An-Nafi'", meaning: 'The Creator of Good' },
  { number: 93, arabic: 'النُّور', transliteration: 'An-Noor', meaning: 'The Light' },
  { number: 94, arabic: 'الْهَادِي', transliteration: 'Al-Hadee', meaning: 'The Guide' },
  { number: 95, arabic: 'الْبَدِيع', transliteration: "Al-Badee'", meaning: 'The Incomparable Originator' },
  { number: 96, arabic: 'الْبَاقِي', transliteration: 'Al-Baqee', meaning: 'The Everlasting' },
  { number: 97, arabic: 'الْوَارِث', transliteration: 'Al-Warith', meaning: 'The Inheritor of All' },
  { number: 98, arabic: 'الرَّشِيد', transliteration: 'Ar-Rasheed', meaning: 'The Guide to the Right Path' },
  { number: 99, arabic: 'الصَّبُور', transliteration: 'As-Saboor', meaning: 'The Most Patient' },
];
