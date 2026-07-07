const state = {
  index: null,
  items: [],
  filtered: [],
  selectedId: "",
  query: "",
  routeMode: "search",
  suppressRouteSync: false,
  filters: {
    area: "",
    dirtTypes: "",
    materials: "",
    chemicals: "",
    tools: ""
  }
};

const els = {
  keyword: document.querySelector("#keywordInput"),
  area: document.querySelector("#areaFilter"),
  dirt: document.querySelector("#dirtFilter"),
  material: document.querySelector("#materialFilter"),
  chemical: document.querySelector("#chemicalFilter"),
  tool: document.querySelector("#toolFilter"),
  resultCount: document.querySelector("#resultCount"),
  resultList: document.querySelector("#resultList"),
  detail: document.querySelector("#detailPanel"),
  activeFilters: document.querySelector("#activeFilterChips"),
  reset: document.querySelector("#resetButton")
};

const filterMap = {
  area: els.area,
  dirtTypes: els.dirt,
  materials: els.material,
  chemicals: els.chemical,
  tools: els.tool
};

const urlParams = {
  query: "q",
  area: "area",
  dirtTypes: "dirt",
  materials: "material",
  chemicals: "chemical",
  tools: "tool"
};

init();

async function init() {
  try {
    const response = await fetch("data/search-index.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`index fetch failed: ${response.status}`);
    state.index = await response.json();
    state.items = state.index.items || [];
    populateFilters(state.index.filters || {});
    bindEvents();
    applyRouteFromHash({ replaceIfEmpty: true });
  } catch (error) {
    els.resultCount.textContent = "読み込み失敗";
    els.resultList.innerHTML = `<div class="empty-results">検索インデックスを読み込めませんでした。<br>${escapeHtml(error.message)}</div>`;
  }
}

function bindEvents() {
  els.keyword.addEventListener("input", () => {
    state.query = els.keyword.value.trim();
    state.routeMode = "search";
    applyFilters({ syncRoute: true });
  });

  for (const [key, select] of Object.entries(filterMap)) {
    select.addEventListener("change", () => {
      state.filters[key] = select.value;
      state.routeMode = "search";
      applyFilters({ syncRoute: true });
    });
  }

  document.querySelectorAll("[data-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      els.keyword.value = button.dataset.quick || "";
      state.query = els.keyword.value;
      state.routeMode = "search";
      applyFilters({ syncRoute: true });
    });
  });

  els.reset.addEventListener("click", () => {
    els.keyword.value = "";
    state.query = "";
    state.selectedId = "";
    state.routeMode = "search";
    for (const [key, select] of Object.entries(filterMap)) {
      select.value = "";
      state.filters[key] = "";
    }
    applyFilters({ syncRoute: true });
  });

  window.addEventListener("hashchange", () => {
    if (!state.suppressRouteSync) applyRouteFromHash();
  });
}

function populateFilters(filters) {
  setOptions(els.area, "すべての場所", filters.area || []);
  setOptions(els.dirt, "すべての汚れ", filters.dirtTypes || []);
  setOptions(els.material, "すべての素材", filters.materials || []);
  setOptions(els.chemical, "すべての洗剤", filters.chemicals || []);
  setOptions(els.tool, "すべての道具", filters.tools || []);
}

function setOptions(select, label, values) {
  select.innerHTML = [
    `<option value="">${escapeHtml(label)}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
  ].join("");
}

function applyRouteFromHash(options = {}) {
  const route = parseRoute();
  state.routeMode = route.mode;
  state.query = route.query;
  state.filters = { ...state.filters, ...route.filters };
  normalizeFilterState();
  syncControlsFromState();

  if (route.mode === "manual") {
    const item = findItemBySlug(route.slug);
    state.selectedId = item?.id || "";
    applyFilters({ keepSelected: true });
    if (item) {
      state.selectedId = item.id;
      renderResults();
      renderDetail();
      scrollDetailIntoView();
    }
  } else {
    applyFilters();
  }

  if (options.replaceIfEmpty && !window.location.hash) {
    syncRoute({ replace: true });
  }
}

function parseRoute() {
  const rawHash = window.location.hash.replace(/^#/, "");
  if (!rawHash) return { mode: "search", query: "", filters: emptyFilters() };

  const [path = "", queryString = ""] = rawHash.split("?");
  const params = new URLSearchParams(queryString);
  const filters = {
    area: params.get(urlParams.area) || "",
    dirtTypes: params.get(urlParams.dirtTypes) || "",
    materials: params.get(urlParams.materials) || "",
    chemicals: params.get(urlParams.chemicals) || "",
    tools: params.get(urlParams.tools) || ""
  };
  const query = params.get(urlParams.query) || "";

  if (path.startsWith("/manual/")) {
    return {
      mode: "manual",
      slug: decodeURIComponent(path.replace("/manual/", "")),
      query,
      filters
    };
  }

  return { mode: "search", query, filters };
}

function emptyFilters() {
  return { area: "", dirtTypes: "", materials: "", chemicals: "", tools: "" };
}

function normalizeFilterState() {
  for (const key of Object.keys(state.filters)) {
    state.filters[key] = normalizeFieldValue(key, state.filters[key]);
  }
}

function normalizeFieldValue(field, value) {
  if (!value) return "";
  return state.index?.normalization?.fields?.[field]?.[value] || value;
}

function syncControlsFromState() {
  els.keyword.value = state.query;
  for (const [key, select] of Object.entries(filterMap)) {
    select.value = state.filters[key] || "";
  }
}

function applyFilters(options = {}) {
  const { syncRoute: shouldSyncRoute = false, replaceRoute = false, keepSelected = false } = options;
  const queryTokens = queryTokenGroups(state.query);

  state.filtered = state.items
    .map((item) => ({ item, score: scoreItem(item, queryTokens) }))
    .filter(({ item, score }) => {
      if (queryTokens.length && score <= 0) return false;
      return Object.entries(state.filters).every(([key, value]) => !value || (item[key] || []).includes(value));
    })
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, "ja"))
    .map(({ item }) => item);

  if (!keepSelected && !state.filtered.some((item) => item.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id || "";
  }

  renderResults();
  renderDetail();
  renderActiveFilters();
  if (shouldSyncRoute) syncRoute({ replace: replaceRoute });
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
  const aliases = state.index?.normalization?.aliases || {};
  return aliases[token] || aliases[token.trim()] || token;
}

function aliasesForCanonical(canonical) {
  const aliases = state.index?.normalization?.aliases || {};
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
  const lowerFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.toLowerCase()]));
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

function renderResults() {
  els.resultCount.textContent = `${state.filtered.length}件`;
  if (!state.filtered.length) {
    els.resultList.innerHTML = emptyResultsHtml();
    bindSuggestionButtons();
    return;
  }

  els.resultList.innerHTML = state.filtered
    .map((item) => {
      const selected = item.id === state.selectedId ? ' aria-current="true"' : "";
      return `
        <button class="result-card" type="button" data-id="${escapeHtml(item.id)}"${selected}>
          <div class="meta-row">
            <span class="pill">${escapeHtml(item.guideLabel)}</span>
            ${item.chapterNo ? `<span class="pill">${escapeHtml(item.chapterNo)}</span>` : ""}
            <span class="pill risk-${escapeHtml(item.riskLevel)}">${escapeHtml(riskLabel(item.riskLevel))}</span>
          </div>
          <h3>${highlightText(item.title)}</h3>
          <p>${highlightText(item.summary || "概要未設定")}</p>
          <div class="tag-row">${tagHtml([...item.area, ...item.dirtTypes].slice(0, 5))}</div>
        </button>
      `;
    })
    .join("");

  els.resultList.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.items.find((candidate) => candidate.id === button.dataset.id);
      if (!item) return;
      state.selectedId = item.id;
      state.routeMode = "manual";
      renderResults();
      renderDetail();
      syncRoute();
      scrollDetailIntoView();
    });
  });
}

function renderDetail() {
  const item = state.items.find((candidate) => candidate.id === state.selectedId);
  if (!item) {
    els.detail.innerHTML = `
      <div class="empty-detail">
        <h2>教材を選択</h2>
        <p>検索結果から章を選ぶと、必要な道具、洗剤、手順、注意事項、PDFリンクを表示します。</p>
      </div>
    `;
    return;
  }

  els.detail.innerHTML = `
    <button class="detail-back" type="button" data-back-to-results>検索結果へ戻る</button>
    <div class="detail-header">
      <p class="detail-kicker">${escapeHtml(item.guideLabel)}${item.chapterNo ? ` / ${escapeHtml(item.chapterNo)}` : ""}</p>
      <h2>${highlightText(item.title)}</h2>
      <p>${highlightText(item.summary || "")}</p>
      <div class="tag-row">${tagHtml([...item.area, ...item.dirtTypes, ...item.materials].slice(0, 8))}</div>
      <div class="detail-actions">
        ${item.pdfPath ? `<a class="pdf-link primary-action" href="${escapeHtml(manualAssetHref(item.pdfPath))}" target="_blank" rel="noreferrer">PDFを開く</a>` : ""}
        ${isGitHubPages() ? "" : `<a class="source-link" href="${escapeHtml(manualAssetHref(item.sourcePath))}" target="_blank" rel="noreferrer">Markdown</a>`}
      </div>
    </div>
    ${renderDetailCards(item)}
    ${relatedGuidesSection(item)}
  `;

  els.detail.querySelector("[data-back-to-results]")?.addEventListener("click", () => {
    state.routeMode = "search";
    syncRoute();
    document.querySelector(".results-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  els.detail.querySelectorAll("[data-related-id]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = state.items.find((candidate) => candidate.id === link.dataset.relatedId);
      if (!target) return;
      state.selectedId = target.id;
      state.routeMode = "manual";
      renderResults();
      renderDetail();
      syncRoute();
      scrollDetailIntoView();
    });
  });
}

function renderActiveFilters() {
  if (!els.activeFilters) return;
  const chips = [];
  if (state.query) {
    chips.push({ key: "query", label: `キーワード: ${state.query}` });
  }
  const labels = {
    area: "場所",
    dirtTypes: "汚れ",
    materials: "素材",
    chemicals: "洗剤",
    tools: "道具"
  };
  for (const [key, value] of Object.entries(state.filters)) {
    if (value) chips.push({ key, label: `${labels[key]}: ${value}` });
  }

  if (!chips.length) {
    els.activeFilters.innerHTML = "";
    return;
  }

  els.activeFilters.innerHTML = `
    <div class="chip-row">
      ${chips.map((chip) => `
        <button class="filter-chip" type="button" data-clear-filter="${escapeHtml(chip.key)}">
          <span>${escapeHtml(chip.label)}</span>
          <b aria-hidden="true">×</b>
        </button>
      `).join("")}
      <button class="clear-all-chip" type="button" data-clear-filter="all">すべて解除</button>
    </div>
  `;

  els.activeFilters.querySelectorAll("[data-clear-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      clearFilter(button.dataset.clearFilter);
    });
  });
}

function clearFilter(key) {
  if (key === "all") {
    state.query = "";
    state.selectedId = "";
    for (const filterKey of Object.keys(state.filters)) state.filters[filterKey] = "";
  } else if (key === "query") {
    state.query = "";
  } else if (Object.hasOwn(state.filters, key)) {
    state.filters[key] = "";
  }
  state.routeMode = "search";
  syncControlsFromState();
  applyFilters({ syncRoute: true });
}

function renderDetailCards(item) {
  const sections = normalizedDetailSections(item);
  if (!sections.length) return "";
  return `<div class="detail-card-list">${sections.map(detailCard).join("")}</div>`;
}

function normalizedDetailSections(item) {
  const sectionMap = new Map();
  for (const section of item.detail?.sections || []) {
    if (!section.items?.length) continue;
    sectionMap.set(section.key, { key: section.key, label: section.label, items: section.items });
  }
  if (!sectionMap.has("tools") && item.detail?.tools?.length) {
    sectionMap.set("tools", { key: "tools", label: "必要な道具", items: item.detail.tools });
  }
  if (!sectionMap.has("chemicals") && item.detail?.chemicals?.length) {
    sectionMap.set("chemicals", { key: "chemicals", label: "必要な洗剤", items: item.detail.chemicals });
  }
  if (!sectionMap.has("steps") && item.detail?.steps?.length) {
    sectionMap.set("steps", { key: "steps", label: "手順", items: item.detail.steps });
  }
  if (!sectionMap.has("cautions") && item.detail?.cautions?.length) {
    sectionMap.set("cautions", { key: "cautions", label: "注意事項", items: item.detail.cautions });
  }
  return ["precheck", "tools", "chemicals", "steps", "cautions", "ng", "finish", "faq", "checklist"]
    .map((key) => sectionMap.get(key))
    .filter(Boolean);
}

function detailCard(section) {
  const open = shouldOpenSection(section) ? " open" : "";
  return `
    <details class="detail-card" data-section-key="${escapeHtml(section.key || "")}"${open}>
      <summary><h3>${highlightText(section.label)}</h3></summary>
      ${renderSectionItems(section.items)}
    </details>
  `;
}

function renderSectionItems(items = []) {
  const groups = [];
  let current = null;
  for (const item of items) {
    const line = cleanLine(item);
    if (!line) continue;
    const type = isTableLine(line) ? "table" : "list";
    if (!current || current.type !== type) {
      current = { type, lines: [] };
      groups.push(current);
    }
    current.lines.push(line);
  }
  return groups.map((group) => (group.type === "table" ? renderTable(group.lines) : renderList(group.lines))).join("");
}

function renderTable(lines) {
  const rows = lines
    .map(parseTableLine)
    .filter((row) => row.length >= 2 && row.some(Boolean));
  if (!rows.length) return "";
  const [head, ...body] = rows;
  return `
    <div class="detail-table-wrap">
      <table class="detail-table">
        <thead><tr>${head.map((cell) => `<th scope="col">${highlightText(cell)}</th>`).join("")}</tr></thead>
        <tbody>
          ${body.map((row) => `<tr>${padRow(row, head.length).map((cell) => `<td>${highlightText(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderList(lines) {
  return `<ul class="detail-list">${lines.map((value) => `<li>${highlightText(value)}</li>`).join("")}</ul>`;
}

function isTableLine(value) {
  const line = String(value).trim();
  if (!line.includes("|")) return false;
  if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line)) return false;
  return parseTableLine(line).length >= 2;
}

function parseTableLine(value) {
  return String(value)
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cleanTableCell(cell));
}

function cleanTableCell(value) {
  return collapseRepeatedText(cleanLine(value).replace(/^!\s*/, ""));
}

function padRow(row, length) {
  return Array.from({ length }, (_, index) => row[index] || "");
}

function collapseRepeatedText(value) {
  const parts = String(value).trim().split(/\s+/).filter(Boolean);
  if (parts.length % 2 !== 0 || parts.length < 2) return value;
  const mid = parts.length / 2;
  const first = parts.slice(0, mid).join(" ");
  const second = parts.slice(mid).join(" ");
  return first === second ? first : value;
}

function shouldOpenSection(section) {
  if (["precheck", "steps", "cautions"].includes(section.key)) return true;
  return sectionHasSearchHit(section);
}

function sectionHasSearchHit(section) {
  const terms = highlightTerms().map((term) => term.toLowerCase());
  if (!terms.length) return false;
  const text = [section.label, ...(section.items || [])].join(" ").toLowerCase();
  return terms.some((term) => text.includes(term));
}

function relatedGuidesSection(item) {
  const guides = (item.relatedGuideLinks || []).filter(Boolean);
  if (!guides.length) return "";
  const groups = groupRelatedGuides(guides);
  return `
    <details class="detail-card related-card" data-section-key="related"${sectionHasSearchHit({ label: "関連ガイド", items: guides.map((guide) => guide.label) }) ? " open" : ""}>
      <summary><h3>関連ガイド</h3></summary>
      <div class="related-guide-list">
        ${groups.map((group) => `
          <div class="related-guide-group">
            <h4>${escapeHtml(group.label)}</h4>
            ${group.guides.map((guide) => relatedGuideHtml(guide)).join("")}
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function groupRelatedGuides(guides) {
  const labels = {
    practice: "実践マニュアル",
    chemicals: "洗剤",
    tools: "道具",
    materials: "素材",
    common: "共通",
    related: "関連"
  };
  const order = ["practice", "chemicals", "tools", "materials", "common", "related"];
  const groups = new Map(order.map((key) => [key, []]));
  for (const guide of guides) {
    groups.get(relatedGuideType(guide)).push(guide);
  }
  return order
    .filter((key) => groups.get(key).length)
    .map((key) => ({ key, label: labels[key], guides: groups.get(key) }));
}

function relatedGuideType(guide) {
  const value = `${guide.id || ""} ${guide.label || ""}`;
  if (/house-cleaning-manual|実践/.test(value)) return "practice";
  if (/cleaning-chemical-guide|洗剤|薬剤/.test(value)) return "chemicals";
  if (/cleaning-tools-guide|道具/.test(value)) return "tools";
  if (/material-guide|素材/.test(value)) return "materials";
  if (/common|共通|アイコン/.test(value)) return "common";
  return "related";
}

function relatedGuideHtml(guide) {
  if (!guide.linked || !guide.id) {
    return `<span class="related-guide is-text">${escapeHtml(guide.label)}</span>`;
  }
  return `<a class="related-guide" href="#/manual/${encodeURIComponent(routeTargetForId(guide.id))}" data-related-id="${escapeHtml(guide.id)}">${escapeHtml(guide.label)}</a>`;
}

function syncRoute({ replace = false } = {}) {
  const hash = buildHash();
  if (window.location.hash === hash) return;
  state.suppressRouteSync = true;
  if (replace) {
    window.location.replace(hash);
  } else {
    window.location.hash = hash;
  }
  window.setTimeout(() => {
    state.suppressRouteSync = false;
  }, 0);
}

function buildHash() {
  const params = new URLSearchParams();
  if (state.query) params.set(urlParams.query, state.query);
  for (const [key, param] of Object.entries(urlParams)) {
    if (key === "query") continue;
    if (state.filters[key]) params.set(param, state.filters[key]);
  }
  const queryString = params.toString();
  const selected = state.items.find((item) => item.id === state.selectedId);
  const path = state.routeMode === "manual" && selected ? `/manual/${encodeURIComponent(routeTargetForItem(selected))}` : "/search";
  return `#${path}${queryString ? `?${queryString}` : ""}`;
}

function findItemBySlug(slug) {
  if (!slug) return null;
  const decoded = decodeURIComponent(slug);
  return state.items.find((item) => item.id === decoded || item.slug === decoded || slugForItem(item) === decoded) || null;
}

function slugForItem(item) {
  return item.slug || item.id.split("/").pop();
}

function routeTargetForId(id) {
  const item = state.items.find((candidate) => candidate.id === id);
  return item ? routeTargetForItem(item) : id;
}

function routeTargetForItem(item) {
  const slug = slugForItem(item);
  const duplicate = state.items.some((candidate) => candidate.id !== item.id && slugForItem(candidate) === slug);
  return duplicate ? item.id : slug;
}

function scrollDetailIntoView() {
  if (window.matchMedia("(max-width: 1119px)").matches) {
    els.detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function isGitHubPages() {
  return window.location.hostname.endsWith("github.io");
}

function manualAssetHref(assetPath) {
  if (!assetPath) return "";
  if (/^(https?:)?\/\//.test(assetPath) || assetPath.startsWith("/")) return assetPath;
  return isGitHubPages() ? assetPath : `../${assetPath}`;
}

function cleanLine(value) {
  return String(value)
    .replace(/^#{1,4}\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/!\[([^\]]*)]\([^)]+\)\s*/g, "$1 ")
    .replace(/\*\*/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function highlightText(value) {
  const escaped = escapeHtml(value);
  const terms = highlightTerms()
    .map((term) => escapeHtml(term))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return escaped;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return escaped.replace(pattern, "<mark>$1</mark>");
}

function highlightTerms() {
  const terms = [];
  for (const group of queryTokenGroups(state.query)) terms.push(...group);
  terms.push(...Object.values(state.filters).filter(Boolean));
  const aliases = state.index?.normalization?.aliases || {};
  for (const term of [...terms]) {
    const canonical = aliases[term] || aliases[String(term).trim()];
    if (canonical) terms.push(canonical);
    for (const [alias, mapped] of Object.entries(aliases)) {
      if (mapped === term || mapped === canonical) terms.push(alias);
    }
  }
  return [...new Set(terms.map((term) => String(term).trim()).filter((term) => term.length >= 2))];
}

function emptyResultsHtml() {
  const suggestions = suggestionTerms();
  return `
    <div class="empty-results">
      <p>条件に一致する教材がありません。</p>
      ${suggestions.length ? `
        <div class="suggestion-box">
          <strong>言い換え候補</strong>
          <div class="suggestion-row">
            ${suggestions.map((term) => `<button type="button" data-suggestion="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join("")}
          </div>
        </div>
      ` : `<p class="empty-hint">条件を減らすか、別の汚れ・素材名で検索してください。</p>`}
    </div>
  `;
}

function suggestionTerms() {
  const aliases = state.index?.normalization?.aliases || {};
  const values = [];
  for (const group of queryTokenGroups(state.query)) {
    for (const token of group) {
      const canonical = aliases[token] || token;
      if (canonical && canonical !== token) values.push(canonical);
      for (const [alias, mapped] of Object.entries(aliases)) {
        if (mapped === canonical || alias.includes(token) || token.includes(alias)) values.push(alias, mapped);
      }
    }
  }
  if (!values.length && Object.values(state.filters).some(Boolean)) {
    values.push(...Object.values(state.filters).filter(Boolean));
  }
  return [...new Set(values.filter(Boolean))].slice(0, 8);
}

function bindSuggestionButtons() {
  els.resultList.querySelectorAll("[data-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      state.query = button.dataset.suggestion || "";
      els.keyword.value = state.query;
      state.routeMode = "search";
      applyFilters({ syncRoute: true });
    });
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagHtml(values) {
  return values.filter(Boolean).map((value) => `<span class="pill">${highlightText(value)}</span>`).join("");
}

function riskLabel(value) {
  if (value === "high") return "高リスク";
  if (value === "low") return "低リスク";
  return "中リスク";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
