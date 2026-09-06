#!/usr/bin/env node
/**
 * Imports the Noor ʿalā al-Darb audio archive from alandals.net.
 *
 * WHY THIS SOURCE. It carries the series far more completely than binbaz does —
 * roughly eighteen thousand fatwas, organised into 364 topics, each with its own
 * MP3. Where the binbaz importer gets fifteen text fatwas per listing page, this
 * one gets a whole topic at a time.
 *
 * WHAT IT DOES NOT CARRY: any translation. The site is Arabic throughout — no
 * English, no Tamil, and no written answers either; the answer IS the shaykh's
 * recording. So this script imports the Arabic question, the topic it sits under
 * and the audio, and leaves every translation field empty for a person to fill.
 * Nothing here is machine-translated: these are scholarly rulings, and a
 * translation that is merely plausible is worse than none.
 *
 * Attribution is written onto every record and shown in the app.
 *
 * USAGE (Cloud Shell)
 *   npm install --no-save firebase-admin
 *   node import-noor-alandals.js --project weeklyclass-lms --topics 20
 *
 * Options
 *   --topics N   how many topics to import. Default 10. Use `all` for every one.
 *   --topic FID  import one topic by its id, e.g. --topic 282 for the section on
 *                IVF and related questions. Takes precedence over --topics.
 *   --dry        print what would be written and write nothing.
 */

const SOURCE_NAME = 'alandals.net — فتاوى نور على الدرب الصوتية';
const BASE = 'https://alandals.net';
const DELAY_MS = 900;

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
      'User-Agent': 'WeeklyClassLMS-NoorImporter/1.0 (+educational use, source cited)',
      'Accept-Language': 'ar',
    },
  });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  // The site is served as UTF-8 but declares it inconsistently; decoding
  // explicitly avoids mojibake in the Arabic titles.
  return Buffer.from(await response.arrayBuffer()).toString('utf8');
}

function decode(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every topic on the index: `NodeSection.aspx?fid=<id>` plus its Arabic name. */
function extractTopics(html) {
  const topics = new Map();
  const pattern = /NodeSection\.aspx\?fid=(\d+)[^>]*>(.*?)<\/a>/gs;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const name = decode(match[2]);
    if (name) topics.set(match[1], name);
  }
  return [...topics.entries()];
}

/** Every fatwa in one topic: id, Arabic question, audio file. */
function extractFatwas(html) {
  const found = new Map();
  const pattern = /Node\.php\?fid=(\d+)&(?:amp;)?id=(\d+)[^>]*>(.*?)<\/a>/gs;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const question = decode(match[3]);
    if (question) {
      found.set(match[2], { topicId: match[1], id: match[2], question });
    }
  }
  return [...found.values()];
}

async function main() {
  const args = parseArgs(process.argv);
  const limit = args.topics === 'all' ? Infinity : Number(args.topics ?? 10);
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

  console.log('\n  Reading the topic index…');
  const allTopics = extractTopics(await fetchText(`${BASE}/`));

  // One topic by id, for importing a single section rather than walking the
  // index from the top. The name still comes from the index, so the record is
  // filed under the same subject a reader would browse to.
  const only = args.topic && args.topic !== true ? String(args.topic) : null;
  const topics = only
    ? allTopics.filter(([id]) => id === only)
    : allTopics.slice(0, limit);

  if (only && topics.length === 0) {
    console.error(`  No topic with id ${only} on the index.`);
    process.exit(1);
  }
  console.log(`  ${allTopics.length} topic(s) found; importing ${topics.length}.`);

  let imported = 0;
  let skipped = 0;

  for (const [topicId, topicName] of topics) {
    await sleep(DELAY_MS);

    let fatwas;
    try {
      fatwas = extractFatwas(await fetchText(`${BASE}/NodeSection.aspx?fid=${topicId}`));
    } catch (error) {
      console.error(`  ✗ topic ${topicId}: ${error.message}`);
      continue;
    }

    process.stdout.write(`  ${topicName.slice(0, 44)} — ${fatwas.length}\n`);

    // One batch per topic. Firestore caps a batch at 500, and no topic here
    // comes close, so a topic is a natural and safe unit of work.
    const batch = db ? db.batch() : null;
    let queued = 0;

    for (const fatwa of fatwas) {
      const docId = `noor-ad-${fatwa.id}`;

      if (db) {
        const existing = await db.collection('videos').doc(docId).get();
        if (existing.exists) {
          skipped += 1;
          continue;
        }
      }

      const record = {
        kind: 'noor',
        title: fatwa.question,
        description: '',
        // The answer is the recording. There is no transcript to import.
        videoUrl: `${BASE}/noormedia/${fatwa.id}.mp3`,
        speaker: 'الشيخ عبد العزيز بن باز',
        // The topic it was filed under, kept so the app can group by subject.
        venue: topicName,
        language: 'ar',
        status: 'published',
        classId: null,
        branchId: null,
        isFeatured: false,
        deleted: false,
        sourceUrl: `${BASE}/Node.php?fid=${fatwa.topicId}&id=${fatwa.id}`,
        sourceName: SOURCE_NAME,
        // Empty on purpose. A person writes these, not a machine.
        translations: {},
      };

      if (dry) {
        if (queued < 3) console.log(`      ${docId}: ${record.title.slice(0, 60)}`);
      } else {
        batch.set(
          db.collection('videos').doc(docId),
          {
            ...record,
            date: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            createdBy: 'import-noor-alandals',
          },
          { merge: true }
        );
      }
      queued += 1;
      imported += 1;
    }

    if (batch && queued > 0) await batch.commit();
  }

  console.log(
    `\n  ${dry ? 'Would import' : 'Imported'} ${imported} fatwa(s); skipped ${skipped} already present.\n` +
      `  Source: ${SOURCE_NAME}\n` +
      '  The site has no translations — every translation field is empty by design.\n' +
      '  Add them from the app, or ask for help translating the question titles.\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
