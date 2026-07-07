import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const manualsRoot = path.join(projectRoot, "manuals");
const appRoot = path.resolve(__dirname, "..");
const outputDir = path.join(appRoot, "data");
const outputFile = path.join(outputDir, "search-index.json");
const normalizationFile = path.join(appRoot, "config", "normalization-map.json");
const videoMetadataFile = path.join(appRoot, "config", "video-metadata.json");

const guideRoots = [
  "house-cleaning-manual",
  "cleaning-chemical-guide",
  "cleaning-tools-guide",
  "material-guide",
  "common"
];

const guideLabels = {
  "house-cleaning-manual": "実践マニュアル",
  "cleaning-chemical-guide": "洗剤・薬剤事典",
  "cleaning-tools-guide": "道具事典",
  "material-guide": "素材事典",
  common: "共通資料"
};

const practicalOnly = new Set(["house-cleaning-manual"]);

const detailSectionSpecs = [
  { key: "precheck", label: "作業前確認", patterns: [/作業前/, /安全確認/, /事前確認/] },
  { key: "tools", label: "必要な道具", patterns: [/必要な道具/, /使用する道具/, /道具/] },
  { key: "chemicals", label: "必要な洗剤", patterns: [/必要な洗剤/, /使用する洗剤/, /洗剤/, /薬剤/] },
  { key: "steps", label: "手順", patterns: [/作業手順/, /使用手順/, /基本の使い方/, /手順/, /STEP/i] },
  { key: "cautions", label: "注意事項", patterns: [/注意事項/, /使用上の注意/, /安全/, /注意が必要/] },
  { key: "ng", label: "NG事項", patterns: [/失敗例/, /やってはいけない/, /混ぜてはいけない/, /NG/] },
  { key: "finish", label: "仕上げ確認", patterns: [/仕上げ/, /最終確認/, /乾拭き/] },
  { key: "faq", label: "FAQ", patterns: [/FAQ/i, /よくある質問/] },
  { key: "checklist", label: "章末チェックリスト", patterns: [/チェックリスト/] }
];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

async function loadNormalizationMap() {
  try {
    return JSON.parse(await readFile(normalizationFile, "utf8"));
  } catch {
    return {};
  }
}

async function loadVideoMetadata() {
  try {
    return JSON.parse(await readFile(videoMetadataFile, "utf8"));
  } catch {
    return {};
  }
}

function stripFrontmatter(text) {
  if (!text.startsWith("---")) return { frontmatter: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: text };
  const raw = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  return { frontmatter: parseFrontmatter(raw), body };
}

function parseFrontmatter(raw) {
  const data = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    data[key] = parseYamlValue(rawValue);
  }
  return data;
}

function parseYamlValue(rawValue) {
  const value = rawValue.trim();
  if (value === "[]") return [];
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((part) => unquote(part.trim()))
      .filter(Boolean);
  }
  return unquote(value);
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

function firstHeading(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? cleanLine(match[1]) : "";
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  return [String(value)];
}

function normalizeList(values, field, normalizationMap) {
  const aliases = normalizationMap[field] || {};
  return uniqueSorted(asArray(values).map((value) => aliases[value] || value));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function normalizeBodyForSearch(body) {
  return body
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[|`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summaryFrom(body) {
  const withoutTitle = body.replace(/^#\s+.+$/m, "");
  const lines = withoutTitle
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("|") && !line.startsWith("!") && !line.startsWith("<"));
  return (lines.find((line) => line.length >= 24) || lines[0] || "").slice(0, 140);
}

function extractDetailSections(body) {
  return detailSectionSpecs
    .map((spec) => {
      const blocks = extractMatchingSections(body, spec.patterns);
      const items = blocks.flatMap((block) => compactLines(block.lines)).slice(0, spec.key === "steps" ? 34 : 18);
      return { ...spec, items };
    })
    .filter((section) => section.items.length);
}

function extractMatchingSections(body, patterns) {
  const headings = collectHeadings(body);
  const matches = headings.filter((heading) => patterns.some((pattern) => pattern.test(heading.title)));
  return matches.map((heading) => sectionBlock(body, headings, heading));
}

function collectHeadings(body) {
  const lines = body.split(/\r?\n/);
  const headings = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(#{2,4})\s+(.+)$/);
    if (!match) return;
    headings.push({
      index,
      level: match[1].length,
      title: cleanLine(match[2])
    });
  });
  return headings;
}

function sectionBlock(body, headings, heading) {
  const lines = body.split(/\r?\n/);
  const next = headings.find((candidate) => candidate.index > heading.index && candidate.level <= heading.level);
  return {
    title: heading.title,
    lines: lines.slice(heading.index + 1, next ? next.index : lines.length)
  };
}

function compactLines(lines) {
  return lines
    .map((line) => cleanLine(line))
    .filter((line) => {
      if (!line) return false;
      if (line === "</div>") return false;
      if (/^!\[/.test(line)) return false;
      if (/^<img\b/i.test(line)) return false;
      if (/^\|?\s*-{2,}/.test(line)) return false;
      return true;
    })
    .slice(0, 36);
}

function extractSteps(body) {
  const stepLines = body
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter((line) => /STEP\s*\d+|サビ STEP\s*\d+/i.test(line));
  if (stepLines.length) return stepLines.slice(0, 24);
  return sectionItems(extractDetailSections(body), "steps").slice(0, 24);
}

function extractWarnings(body) {
  const sections = extractDetailSections(body);
  const direct = body
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter((line) => /(注意|禁止|危険|混ぜない|電装部|ラベル|素材確認|強くこすらない)/.test(line))
    .filter((line) => !/^#{1,4}\s/.test(line))
    .slice(0, 18);
  return uniqueSorted([...sectionItems(sections, "cautions"), ...sectionItems(sections, "ng"), ...direct]).slice(0, 24);
}

function sectionItems(sections, key) {
  return sections.find((section) => section.key === key)?.items || [];
}

function cleanLine(value) {
  return String(value)
    .replace(/^!\s*(?![A-Za-z0-9_-])/, "")
    .replace(/^#{1,4}\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/!\[([^\]]*)]\([^)]+\)\s*/g, "$1 ")
    .replace(/\*\*/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

async function collectMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["backups", "archive", "exports", "assets", "qa"].includes(entry.name)) continue;
      files.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

function resolveRelatedGuides(item, items) {
  return (item.relatedGuides || []).map((value) => {
    const exact = items.find((candidate) => candidate.id === value || candidate.sourcePath === value || slugForItem(candidate) === value);
    const guideReadme = items.find((candidate) => candidate.guide === value && candidate.id.endsWith("/README"));
    const guideLabel = guideLabels[value] || value;
    const linked = exact || guideReadme;
    return linked
      ? { label: linked.title || guideLabel, id: linked.id, slug: slugForItem(linked), linked: true }
      : { label: guideLabel, id: "", slug: "", linked: false };
  });
}

function slugForItem(item) {
  return item.id.split("/").pop();
}

function aliasesForSearch(normalizationMap) {
  const aliases = {};
  for (const field of Object.keys(normalizationMap)) {
    for (const [alias, canonical] of Object.entries(normalizationMap[field] || {})) {
      aliases[alias] = canonical;
      if (!aliases[canonical]) aliases[canonical] = canonical;
    }
  }
  return aliases;
}

async function buildIndex() {
  const normalizationMap = await loadNormalizationMap();
  const videoMetadata = await loadVideoMetadata();
  const items = [];
  for (const guideRoot of guideRoots) {
    const root = path.join(manualsRoot, guideRoot);
    const files = await collectMarkdownFiles(root);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const { frontmatter, body } = stripFrontmatter(source);
      const relPath = toPosix(path.relative(projectRoot, file));
      const guide = guideRoot;
      const title = frontmatter.title || firstHeading(body) || path.basename(file, ".md");
      const id = relPath.replace(/\.md$/, "");
      const pdfPath = frontmatter.pdf_path
        ? toPosix(path.join(path.dirname(relPath), frontmatter.pdf_path))
        : "";

      const area = normalizeList(frontmatter.area, "area", normalizationMap);
      const dirtTypes = normalizeList(frontmatter.dirt_types, "dirtTypes", normalizationMap);
      const materials = normalizeList(frontmatter.materials, "materials", normalizationMap);
      const chemicals = normalizeList(frontmatter.chemicals, "chemicals", normalizationMap);
      const tools = normalizeList(frontmatter.tools, "tools", normalizationMap);
      const detailSections = extractDetailSections(body);
      const videos = normalizeVideos(videoMetadata[id] || videoMetadata[path.basename(relPath, ".md")] || [], id);

      const item = {
        id,
        slug: path.basename(relPath, ".md"),
        guide,
        guideLabel: guideLabels[guide] || guide,
        chapterNo: frontmatter.chapter_no || "",
        title,
        sourcePath: relPath,
        pdfPath,
        area,
        dirtTypes,
        materials,
        chemicals,
        tools,
        rawTerms: {
          area: asArray(frontmatter.area),
          dirtTypes: asArray(frontmatter.dirt_types),
          materials: asArray(frontmatter.materials),
          chemicals: asArray(frontmatter.chemicals),
          tools: asArray(frontmatter.tools)
        },
        riskLevel: frontmatter.risk_level || "medium",
        requiredIcons: asArray(frontmatter.required_icons),
        relatedGuides: asArray(frontmatter.related_guides),
        relatedGuideLinks: [],
        version: frontmatter.version || "1.0",
        lastReviewed: frontmatter.last_reviewed || "",
        summary: summaryFrom(body),
        detail: {
          tools,
          chemicals,
          steps: extractSteps(body),
          cautions: extractWarnings(body),
          sections: detailSections
        },
        videos,
        searchableText: normalizeBodyForSearch([
          title,
          frontmatter.chapter_no || "",
          area.join(" "),
          dirtTypes.join(" "),
          materials.join(" "),
          chemicals.join(" "),
          tools.join(" "),
          asArray(frontmatter.area).join(" "),
          asArray(frontmatter.dirt_types).join(" "),
          asArray(frontmatter.materials).join(" "),
          asArray(frontmatter.chemicals).join(" "),
          asArray(frontmatter.tools).join(" "),
          videos.map((video) => video.title).join(" "),
          body
        ].join("\n"))
      };
      items.push(item);
    }
  }

  for (const item of items) {
    item.relatedGuideLinks = resolveRelatedGuides(item, items);
  }

  const practicalItems = items.filter((item) => practicalOnly.has(item.guide) && item.pdfPath);
  const filters = {
    area: uniqueSorted(items.flatMap((item) => item.area)),
    dirtTypes: uniqueSorted(items.flatMap((item) => item.dirtTypes)),
    materials: uniqueSorted(items.flatMap((item) => item.materials)),
    chemicals: uniqueSorted(items.flatMap((item) => item.chemicals)),
    tools: uniqueSorted(items.flatMap((item) => item.tools)),
    guides: guideRoots.map((id) => ({ id, label: guideLabels[id] || id }))
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    version: "2.0-detail-links-normalized",
    counts: {
      items: items.length,
      practicalItems: practicalItems.length,
      pdfs: practicalItems.length
    },
    normalization: {
      fields: normalizationMap,
      aliases: aliasesForSearch(normalizationMap)
    },
    filters,
    items
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function normalizeVideos(videos, itemId) {
  const list = Array.isArray(videos) ? videos : videos ? [videos] : [];
  return list
    .filter((video) => video && typeof video === "object")
    .map((video) => ({
      chapter: video.chapter || itemId,
      title: String(video.title || "実演動画"),
      description: String(video.description || ""),
      youtubeUrl: String(video.youtubeUrl || ""),
      youtubeId: String(video.youtubeId || ""),
      fallbackUrl: String(video.fallbackUrl || video.youtubeUrl || ""),
      provider: String(video.provider || "youtube"),
      source: String(video.source || "YouTube")
    }))
    .filter((video) => video.provider === "youtube" && /^[A-Za-z0-9_-]{6,}$/.test(video.youtubeId));
}

buildIndex()
  .then((payload) => {
    console.log(`Generated ${toPosix(path.relative(projectRoot, outputFile))}`);
    console.log(`Items: ${payload.counts.items}`);
    console.log(`PDF-linked practical chapters: ${payload.counts.pdfs}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
