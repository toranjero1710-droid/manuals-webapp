import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const indexFile = path.join(appRoot, "data", "search-index.json");

const representativeQueries = [
  { query: "水垢", minCount: 8, expectedTop: ["浴室鏡", "浴室", "キッチン", "ベランダ"] },
  { query: "ウロコ", minCount: 8, expectedTop: ["浴室鏡", "浴室", "キッチン", "ベランダ"] },
  { query: "鱗", minCount: 8, expectedTop: ["浴室鏡", "浴室", "キッチン", "ベランダ"] },
  { query: "カビ", minCount: 6, expectedTop: ["浴室", "エアコン", "壁紙"] },
  { query: "油よごれ", minCount: 5, expectedTop: ["キッチン", "レンジフード", "ガスコンロ", "油"] },
  { query: "メラミン", minCount: 1, expectedTop: ["メラミン", "道具", "スポンジ"] },
  { query: "サッシブラシ", minCount: 1, expectedTop: ["サッシ", "隙間", "ブラシ", "道具"] },
  { query: "フィルター", minCount: 3, expectedTop: ["エアコン", "レンジフード", "フィルター"] }
];

const normalizationCases = [
  ["ウロコ", "水垢"],
  ["鱗", "水垢"],
  ["うろこ", "水垢"],
  ["黒カビ", "カビ"],
  ["油よごれ", "油汚れ"],
  ["メラミン", "メラミンスポンジ"],
  ["サッシブラシ", "隙間ブラシ"],
  ["加圧スプレー", "園芸用加圧スプレー"],
  ["フィルター", "エアコンフィルター"]
];

const payload = JSON.parse(await readFile(indexFile, "utf8"));
const items = payload.items || [];
const failures = [];
const report = {
  index: {
    version: payload.version,
    items: items.length,
    generatedAt: payload.generatedAt
  },
  queries: [],
  normalization: [],
  relatedLinks: {},
  zeroSuggestions: {}
};

for (const test of representativeQueries) {
  const results = search(test.query).slice(0, 5);
  const allResults = search(test.query);
  const topText = results.map((item) => `${item.title} ${item.guideLabel} ${item.area?.join(" ")} ${item.dirtTypes?.join(" ")} ${item.tools?.join(" ")}`).join(" ");
  const topPractical = results.slice(0, 3).some((item) => item.pdfPath);
  const hasPracticalResult = allResults.some((item) => item.pdfPath);
  const expectedHit = test.expectedTop.some((term) => topText.includes(term));
  report.queries.push({
    query: test.query,
    count: allResults.length,
    top: results.map((item) => item.title),
    topPractical,
    hasPracticalResult
  });
  if (allResults.length < test.minCount) {
    failures.push(`${test.query}: expected at least ${test.minCount} results`);
  }
  if (!expectedHit) {
    failures.push(`${test.query}: top results do not contain expected practical terms`);
  }
  if (hasPracticalResult && !topPractical) {
    failures.push(`${test.query}: PDF-linked practical material is not in top 3`);
  }
}

for (const [alias, expected] of normalizationCases) {
  const actual = normalizeSearchTerm(alias);
  report.normalization.push({ alias, expected, actual });
  if (actual !== expected) failures.push(`${alias}: expected normalization to ${expected}, got ${actual}`);
}

const ids = new Set(items.map((item) => item.id));
const brokenRelated = [];
let linkedRelated = 0;
let textOnlyRelated = 0;
for (const item of items) {
  for (const related of item.relatedGuideLinks || []) {
    if (related.linked) linkedRelated += 1;
    else textOnlyRelated += 1;
    if (related.linked && !ids.has(related.id)) brokenRelated.push({ item: item.id, related });
  }
}
report.relatedLinks = {
  linkedRelated,
  textOnlyRelated,
  broken: brokenRelated.length
};
if (brokenRelated.length) failures.push(`related links broken: ${brokenRelated.length}`);

for (const [alias, expected] of normalizationCases.slice(0, 6)) {
  const noisy = `${alias}zzz`;
  const suggestions = suggestionTerms(noisy);
  report.zeroSuggestions[noisy] = suggestions;
  if (!suggestions.includes(alias) || !suggestions.includes(expected)) {
    failures.push(`${noisy}: zero-result suggestions should include ${alias} and ${expected}`);
  }
  if (suggestions.length > 8) {
    failures.push(`${noisy}: too many suggestions (${suggestions.length})`);
  }
}

console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error("\nSearch QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nSearch QA passed.");
}

function search(query) {
  const tokenGroups = queryTokenGroups(query);
  return items
    .map((item) => ({ item, score: scoreItem(item, tokenGroups) }))
    .filter(({ score }) => !tokenGroups.length || score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, "ja"))
    .map(({ item }) => item);
}

function queryTokenGroups(query) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const canonical = normalizeSearchTerm(token);
      return [...new Set([token, canonical, ...aliasesForCanonical(canonical)].filter(Boolean).map((value) => value.toLowerCase()))];
    });
}

function normalizeSearchTerm(token) {
  const aliases = payload.normalization?.aliases || {};
  return aliases[token] || aliases[token.trim()] || token;
}

function aliasesForCanonical(canonical) {
  const aliases = payload.normalization?.aliases || {};
  return Object.entries(aliases)
    .filter(([, mapped]) => mapped === canonical)
    .map(([alias]) => alias);
}

function scoreItem(item, tokenGroups) {
  if (!tokenGroups.length) return item.pdfPath ? 5 : 1;
  let score = 0;
  for (const group of tokenGroups) {
    const tokenScore = scoreTokenGroup(item, group);
    if (tokenScore <= 0) return 0;
    score += tokenScore;
  }
  if (item.pdfPath) score += 10;
  if (item.chapterNo) score += 4;
  return score;
}

function scoreTokenGroup(item, group) {
  const fields = {
    title: item.title || "",
    chapter: [item.chapterNo, item.title].join(" "),
    tags: [
      ...(item.area || []),
      ...(item.dirtTypes || []),
      ...(item.materials || []),
      ...(item.chemicals || []),
      ...(item.tools || [])
    ].join(" "),
    summary: item.summary || "",
    normalized: [
      item.rawTerms ? Object.values(item.rawTerms).flat().join(" ") : "",
      item.area?.join(" "),
      item.dirtTypes?.join(" "),
      item.materials?.join(" "),
      item.chemicals?.join(" "),
      item.tools?.join(" ")
    ].join(" "),
    body: item.searchableText || ""
  };
  const lowerFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value).toLowerCase()]));
  let bestScore = 0;
  for (const token of group) {
    let tokenScore = 0;
    if (lowerFields.title === token) tokenScore += 140;
    else if (lowerFields.title.includes(token)) tokenScore += 110;
    if (lowerFields.chapter.includes(token)) tokenScore += 55;
    if (lowerFields.tags.split(/\s+/).includes(token)) tokenScore += 80;
    else if (lowerFields.tags.includes(token)) tokenScore += 60;
    if (lowerFields.summary.includes(token)) tokenScore += 35;
    if (lowerFields.normalized.includes(token)) tokenScore += 26;
    if (lowerFields.body.includes(token)) tokenScore += 10;
    bestScore = Math.max(bestScore, tokenScore);
  }
  return bestScore;
}

function suggestionTerms(query) {
  const aliases = payload.normalization?.aliases || {};
  const values = [];
  for (const group of queryTokenGroups(query)) {
    for (const token of group) {
      const canonical = aliases[token] || token;
      if (canonical && canonical !== token) values.push(canonical);
      for (const [alias, mapped] of Object.entries(aliases)) {
        if (mapped === canonical || alias.includes(token) || token.includes(alias)) values.push(alias, mapped);
      }
    }
  }
  return [...new Set(values.filter(Boolean))].slice(0, 8);
}
