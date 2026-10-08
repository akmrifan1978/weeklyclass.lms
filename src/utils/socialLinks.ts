/**
 * Turning what somebody typed into a link, or admitting it is not one.
 *
 * WHY THIS EXISTS. The Facebook field held "WeeklyClass Lms Jdc" and the
 * Instagram field held "WeeklyClassLMS" — a page name and a handle, neither of
 * them a link. With no scheme in front, a browser reads the text as a path on
 * the site it is already on, so pressing Facebook opened
 * weeklyclass-lms.web.app/WeeklyClass%20Lms%20Jdc and reported that the page
 * could not be found. The app looked broken; the values were simply not links.
 *
 * Three cases, and the third is the one that matters:
 *
 *   A LINK is used as it stands, and a bare domain gets its https.
 *   A HANDLE becomes the platform's own address for that handle. "@name",
 *     "name", and a profile path all resolve the same way.
 *   A NAME — anything with a space in it — is NOT a link and cannot be turned
 *     into one without guessing which page somebody meant. It returns null,
 *     the icon does not appear, and the settings screen says what to paste
 *     instead. A missing icon is a smaller failure than one that leads
 *     somewhere wrong, and far smaller than one that leads nowhere at all.
 *
 * No imports: the checks run this file directly under Node.
 */

export type SocialPlatform = 'facebook' | 'instagram' | 'youtube' | 'website' | 'whatsapp';

/** Where a bare handle lives, per platform. */
const HOME: Partial<Record<SocialPlatform, string>> = {
  facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/',
  youtube: 'https://www.youtube.com/@',
};

/** A handle: letters, digits, dots, dashes, underscores — and no spaces. */
const HANDLE = /^@?[A-Za-z0-9._-]{2,60}\/?$/;

/**
 * The address to open for what somebody typed, or null when it is not a link
 * and cannot honestly be made into one.
 */
export function socialUrl(platform: SocialPlatform, value?: string | null): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  // WhatsApp is a phone number, and has its own rules; it is not a profile.
  if (platform === 'whatsapp') {
    const digits = text.replace(/[^0-9]/g, '');
    return digits.length >= 8 ? `https://wa.me/${digits}` : null;
  }

  /*
   * A SPACE MEANS IT IS NOT AN ADDRESS, scheme or no scheme.
   *
   * Checked before anything else, because the obvious repair for a page name
   * is to put https://www.facebook.com/ in front of it - which produces
   * "https://www.facebook.com/WeeklyClass Lms Jdc", a thing that looks like a
   * link, passes any test that only asks about the scheme, and lands on
   * Facebook's own "page not found". Nothing here can know which page was
   * meant, so this says plainly that it is not a link rather than shipping a
   * handsome dead end.
   */
  if (/\s/.test(text)) return null;
  if (/^https?:\/\//i.test(text)) return text;

  /*
   * An address missing only its scheme: it says www., or it names a site with
   * a path, or it names one of the platforms outright.
   *
   * Checked before handles but kept narrow, because a Facebook username may
   * contain dots - "weekly.class.jdc" is a person's page, not a domain, and an
   * earlier version of this sent them to https://weekly.class.jdc.
   */
  const looksAddressed =
    /^www\./i.test(text) ||
    text.includes('/') ||
    /(facebook|instagram|youtube|youtu|fb)\.(com|be|me)$/i.test(text);
  if (looksAddressed) return `https://${text}`;

  const home = HOME[platform];
  if (home && HANDLE.test(text)) {
    return `${home}${text.replace(/^@/, '').replace(/\/$/, '')}`;
  }

  // No platform home to fall back on — a website field, where a bare domain is
  // exactly what somebody would type.
  if (/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/.test(text)) {
    return `https://${text}`;
  }

  // A name, a sentence, or anything else somebody typed in good faith that
  // does not identify a page. Not a link, and not guessed at.
  return null;
}

/** True when what was typed cannot be opened — what the settings screen warns on. */
export function isUnusableSocial(platform: SocialPlatform, value?: string | null): boolean {
  return Boolean(String(value ?? '').trim()) && socialUrl(platform, value) === null;
}
