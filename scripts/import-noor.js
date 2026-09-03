#!/usr/bin/env node
/**
 * Imports the Noor ʿalā al-Darb fatwa series from binbaz.org.sa into Firestore.
 *
 * LICENCE. The site's own footer reads:
 *
 *   جميع الحقوق محفوظة والنقل متاح لكل مسلم بشرط ذكر المصدر
 *   "All rights reserved; copying is permitted for every Muslim, on condition
 *    that the source is cited."
 *
 * That is an explicit permission to redistribute with attribution, and it is the
 * only reason this script exists. Every record it writes therefore carries
 * `sourceUrl` and `sourceName`, and the app shows them — the attribution is not
 * optional and must not be stripped. `robots.txt` disallows only /index.php.
 *
 * NO TRANSLATION IS GENERATED. The source is Arabic and these are scholarly
 * rulings: a translation that is merely plausible is worse than none. Imported
 * episodes land with their Arabic text and empty translation fields, for a
 * person who knows the material to fill in from the app.
 *
 * The importer is polite: one page at a time, with a pause between requests, and
 * it skips anything already imported so a second run costs almost nothing.
 *
 * USAGE (Cloud Shell, where you are already authenticated):
 *   npm install --no-save firebase-admin
 *   node import-noor.js --project weeklyclass-lms --pages 3
 *
 * Options
 *   --pages N     how many listing pages to walk (15 episodes each). Default 2.
 *   --start N     first listing page. Default 1.
 *   --dry         print what would be written and write nothing.
 */

const SOURCE_NAME = 'binbaz.org.sa — موقع الشيخ ابن باز';
const LIST_URL = 'https://binbaz.org.sa/fatwas/kind/2';
const DELAY_MS = 1200;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      // Identifies the importer honestly rather than pretending to be a browser.
      'User-Agent': 'WeeklyClassLMS-NoorImporter/1.0 (+educational use, source cited)',
      'Accept-Language': 'ar',
    },
  });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.text();
}

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Drops the "السؤال:" / "الجواب:" labels — they are chrome, not content. */
function withoutLabel(text) {
  return text.replace(/^\s*(السؤال|الجواب)\s*:\s*/u, '').trim();
}

function extractEpisode(html, url) {
  const titleMatch = html.match(/<title>(.*?)<\/title>/s);
  const title = titleMatch
    ? stripTags(titleMatch[1]).replace(/\s*-\s*موقع الشيخ ابن باز\s*$/u, '').trim()
    : null;

  const questionMatch = html.match(/article-title__question[^>]*>(.*?)<\/div>/s);
  const answerMatch = html.match(/class="article-content">(.*?)<\/div>\s*<\/div>/s);
  const audioMatch = html.match(/https:\/\/files\.zadapps\.info\/[^"'\s]+\.mp3/);

  if (!title) return null;

  const question = questionMatch ? withoutLabel(stripTags(questionMatch[1])) : '';
  const answer = answerMatch ? withoutLabel(stripTags(answerMatch[1])) : '';

  return {
    title,
    question,
    answer,
    audioUrl: audioMatch ? audioMatch[0] : null,
    sourceUrl: url,
  };
}

/** Episode ids from one listing page, as `/fatwas/<id>/<slug>` links. */
function extractLinks(html) {
  const found = new Map();
  const pattern = /https:\/\/binbaz\.org\.sa\/fatwas\/(\d+)\/[^"'\s]*/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    found.set(match[1], match[0]);
  }
  return [...found.entries()];
}

async function main() {
  const args = parseArgs(process.argv);
  const pages = Number(args.pages ?? 2);
  const start = Number(args.start ?? 1);
  const dry = Boolean(args.dry);

  let db = null;
  let FieldValue = null;
  if (!dry) {
    const { initializeApp, applicationDefault } = require('firebase-admin/app');
    const firestore = require('firebase-admin/firestore');
    FieldValue = firestore.FieldValue;
    initializeApp({
      credential: applicationDefault(),
      projectId: args.project || process.env.GOOGLE_CLOUD_PROJECT,
    });
    db = firestore.getFirestore();
  }

  let imported = 0;
  let skipped = 0;

  for (let page = start; page < start + pages; page += 1) {
    const listUrl = page === 1 ? LIST_URL : `${LIST_URL}?page=${page}`;
    process.stdout.write(`\n  page ${page}: `);

    let listHtml;
    try {
      listHtml = await fetchText(listUrl);
    } catch (error) {
      console.error(`could not load listing (${error.message})`);
      continue;
    }

    const links = extractLinks(listHtml);
    process.stdout.write(`${links.length} episode(s)\n`);

    for (const [id, url] of links) {
      const docId = `noor-${id}`;

      if (db) {
        const existing = await db.collection('videos').doc(docId).get();
        if (existing.exists) {
          skipped += 1;
          continue;
        }
      }

      await sleep(DELAY_MS);

      let episode;
      try {
        episode = extractEpisode(await fetchText(url), url);
      } catch (error) {
        console.error(`    ✗ ${id}: ${error.message}`);
        continue;
      }
      if (!episode) {
        console.error(`    ✗ ${id}: could not parse`);
        continue;
      }

      const record = {
        kind: 'noor',
        title: episode.title,
        // The question and answer together are the episode. Kept as the
        // description so the existing video screens show something sensible too.
        description: [episode.question, episode.answer].filter(Boolean).join('\n\n'),
        videoUrl: episode.audioUrl ?? episode.sourceUrl,
        speaker: 'الشيخ عبد العزيز بن باز',
        language: 'ar',
        status: 'published',
        classId: null,
        branchId: null,
        isFeatured: false,
        deleted: false,
        // Attribution, as the licence requires. Do not remove.
        sourceUrl: episode.sourceUrl,
        sourceName: SOURCE_NAME,
        // Left empty on purpose — a person writes these, not a machine.
        translations: {},
      };

      if (dry) {
        console.log(`    ${docId}: ${record.title.slice(0, 60)}`);
        console.log(`      audio: ${record.videoUrl}`);
        console.log(`      text : ${record.description.length} chars`);
      } else {
        await db
          .collection('videos')
          .doc(docId)
          .set(
            {
              ...record,
              date: FieldValue.serverTimestamp(),
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              createdBy: 'import-noor',
            },
            { merge: true }
          );
        process.stdout.write(`    ✓ ${record.title.slice(0, 55)}\n`);
      }
      imported += 1;
    }
  }

  console.log(
    `\n  ${dry ? 'Would import' : 'Imported'} ${imported} episode(s); skipped ${skipped} already present.\n` +
      `  Source: ${SOURCE_NAME}\n` +
      '  Translations are intentionally empty — add them from the app.\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
