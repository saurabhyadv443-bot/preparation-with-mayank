const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve('quizzes/Medeival And Modern History.htm');
const outDir = path.resolve('data');
fs.mkdirSync(outDir, { recursive: true });

const html = fs.readFileSync(htmlPath, 'utf8');
const startMarker = 'const quizData =';
const startIndex = html.indexOf(startMarker);
if (startIndex === -1) {
  throw new Error('quizData block not found in the source HTML file.');
}

const objectStart = html.indexOf('{', startIndex);
let depth = 0;
let inString = false;
let escape = false;
let endIndex = -1;

for (let i = objectStart; i < html.length; i += 1) {
  const ch = html[i];

  if (inString) {
    if (escape) {
      escape = false;
    } else if (ch === '\\') {
      escape = true;
    } else if (ch === '"') {
      inString = false;
    }
    continue;
  }

  if (ch === '"') {
    inString = true;
    continue;
  }

  if (ch === '{') {
    depth += 1;
  } else if (ch === '}') {
    depth -= 1;
    if (depth === 0) {
      endIndex = i;
      break;
    }
  }
}

if (endIndex === -1) {
  throw new Error('Unable to locate the end of the quizData object.');
}

const source = html.slice(objectStart, endIndex + 1);
const quizData = Function(`"use strict"; return (${source});`)();

const normalized = {
  subject: 'Medieval and Modern History',
  quizType: 'practice',
  secondsPerQuestion: 40,
  chapters: {}
};

let questionTotal = 0;
for (const [chapterName, items] of Object.entries(quizData)) {
  const cleanedItems = (Array.isArray(items) ? items : []).map((item) => ({
    q: item?.q || item?.question || '',
    options: Array.isArray(item?.options) ? item.options : [],
    answer: typeof item?.answer === 'number' ? item.answer : 0,
    explanation: item?.explanation || ''
  }));

  normalized.chapters[chapterName] = cleanedItems;
  questionTotal += cleanedItems.length;
}

const maxPerFile = 2500;
const parts = [];
let current = {};
let currentCount = 0;

for (const [chapterName, chapterItems] of Object.entries(normalized.chapters)) {
  if (currentCount + chapterItems.length > maxPerFile && Object.keys(current).length > 0) {
    parts.push(current);
    current = {};
    currentCount = 0;
  }
  current[chapterName] = chapterItems;
  currentCount += chapterItems.length;
}

if (Object.keys(current).length > 0) {
  parts.push(current);
}

const created = [];
for (let idx = 0; idx < parts.length; idx += 1) {
  const payload = {
    subject: normalized.subject,
    quizType: normalized.quizType,
    secondsPerQuestion: normalized.secondsPerQuestion,
    chapters: parts[idx]
  };

  const outPath = path.join(outDir, `modern_part${idx + 1}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const validated = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const qCount = Object.values(validated.chapters).reduce((sum, chapter) => sum + chapter.length, 0);
  created.push({ name: path.basename(outPath), count: qCount });
}

console.log(`question_total=${questionTotal}`);
console.log(`parts_created=${created.length}`);
for (const { name, count } of created) {
  console.log(`${name}:${count}`);
}
