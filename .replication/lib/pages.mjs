// Page renderers: SiteModel in, a Map of site path to HTML out.
import { readFileSync } from "node:fs";
import { escapeHtml, inline, rel, pageShell, CDN } from "./html.mjs";
import { STAGES } from "./project.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const CLIENT_JS = read("./linkpath.js") + read("./client.js");

const PAGE_CSS = `<style>
.lead { font-size: 1.15rem; max-width: 48rem; }
.strip { list-style: none; margin: 1rem 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.strip li { background: var(--surface); border: 2px solid var(--ink); padding: 0.5rem 0.75rem; }
.strip .state { font-weight: 700; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.04em; }
.strip .now { background: var(--tan); }
.filter-group { margin: 0 0 0.75rem; }
.filter-group p { margin: 0 0 0.25rem; font-weight: 700; }
.filter-group .buttons { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.table-wrap { margin: 1rem 0; }
.table-wrap table { min-width: 36rem; }
caption { text-align: left; font-weight: 700; padding: 0 0 0.5rem; }
.note { color: var(--muted); }
#doc-content { max-width: 52rem; }
#doc-content table { min-width: 0; }
#doc-fallback { white-space: pre-wrap; }
</style>`;

const personName = (model, id) => model.people.get(id)?.name ?? id;
const names = (model, ids) => ids.map((id) => personName(model, id)).join(", ") || "-";
const docPath = (p) => `docs/${p.replace(/\.md$/, "")}/index.html`;
const clientScript = () => `<script>\n${CLIENT_JS}</script>`;

function table(caption, headers, rows) {
  const head = headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("");
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(caption)}">
<table>
<caption>${escapeHtml(caption)}</caption>
<thead><tr>${head}</tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
</div>`;
}

const tr = (cells, attrs = "") => `<tr${attrs}>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;

// groups: [{ key, label, options: [{ value, label }] }]. The "All" button clears a group.
function filterBar(groups, total) {
  const html = groups.map((g) => {
    const buttons = [{ value: "", label: "All" }, ...g.options].map((o) =>
      `<button type="button" data-filter-key="${g.key}" data-filter-value="${escapeHtml(o.value)}" aria-pressed="${o.value === "" ? "true" : "false"}">${escapeHtml(o.label)}</button>`);
    return `<div class="filter-group" role="group" aria-label="${escapeHtml(g.label)}">
<p>${escapeHtml(g.label)}</p>
<div class="buttons">${buttons.join("\n")}</div>
</div>`;
  });
  return `<div data-filters hidden>
${html.join("\n")}
</div>
<p data-filter-count aria-live="polite">Showing ${total} of ${total}.</p>`;
}

// A link to the document page when the path is a record document, else code text.
function recordRef(model, from, path) {
  if (!path || path === "-") return "-";
  const clean = path.split("#")[0];
  if (model.documents.some((d) => d.path === clean)) {
    return `<a href="${escapeHtml(rel(from, docPath(clean)))}">${escapeHtml(path)}</a>`;
  }
  return `<code>${escapeHtml(path)}</code>`;
}

function shell(model, path, title, body, extra = {}) {
  return pageShell({ path, title, body, model, head: PAGE_CSS + (extra.head ?? ""), scripts: extra.scripts ?? "" });
}

export function renderHome(model) {
  const path = "index.html";
  const readme = model.documents.find((d) => d.path === "README.md");
  const lead = readme?.text.split(/\r?\n\r?\n/).map((p) => p.trim())
    .find((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith("```"));
  const { current, next } = model.status;
  const ms = (m) => (m ? `${escapeHtml(m.id)} ${escapeHtml(m.title)}` : "none");
  const strip = model.milestones.length
    ? `<ol class="strip">\n${model.milestones.map((m) =>
      `<li class="${escapeHtml(m.state)}"><span class="state">${escapeHtml(m.state)}</span> ${escapeHtml(m.id)} ${escapeHtml(m.title)}</li>`).join("\n")}\n</ol>`
    : "<p>No milestones yet.</p>";
  const counts = model.counts.byDecider.length
    ? `<ul>\n${model.counts.byDecider.map((c) => `<li>${escapeHtml(c.name)}: ${c.count}</li>`).join("\n")}\n</ul>`
    : "<p>No decisions yet.</p>";
  const link = (target, label) => `<li><a href="${escapeHtml(rel(path, target))}">${label}</a></li>`;
  const body = `<h1>${escapeHtml(model.config.project)}</h1>
${lead ? `<p class="lead">${inline(lead)}</p>` : ""}
<h2>Status</h2>
<p>Current milestone: ${ms(current)}. Next milestone: ${ms(next)}. Date: ${escapeHtml(model.build.date)}.</p>
<h2>Milestones</h2>
${strip}
<h2>Decisions by decider</h2>
${counts}
<h2>Pages</h2>
<ul>
${link("records/index.html", "Records")}
${link("decisions/index.html", "Decisions")}
${link("progress/index.html", "Progress")}
${link("process/index.html", "Process")}
<li><a href="${escapeHtml(model.config.repository)}">Repository</a></li>
</ul>`;
  return shell(model, path, "Home", body);
}

export function renderRecords(model) {
  const path = "records/index.html";
  const kinds = [...new Set(model.documents.map((d) => d.kind))];
  const rows = model.documents.map((d) => tr([
    escapeHtml(d.date ?? "-"),
    `<a href="${escapeHtml(rel(path, docPath(d.path)))}">${escapeHtml(d.title)}</a>`,
    escapeHtml(d.kind), escapeHtml(d.status ?? "-"),
  ], ` data-row data-kind="${escapeHtml(d.kind)}"`));
  const content = model.documents.length
    ? filterBar([{ key: "kind", label: "Kind", options: kinds.map((k) => ({ value: k, label: k })) }], model.documents.length)
      + table("All documents", ["Date", "Title", "Kind", "Status"], rows)
    : "<p>No documents yet.</p>";
  return shell(model, path, "Records", `<h1>Records</h1>\n${content}`, { scripts: model.documents.length ? clientScript() : "" });
}

export function renderDecisions(model) {
  const path = "decisions/index.html";
  const deciders = [...new Set(model.decisions.flatMap((d) => d.decidedBy))];
  const hows = [...new Set(model.decisions.map((d) => d.how))];
  const rows = model.decisions.map((d) => {
    const fix = d.corrected
      ? `<br><span class="note">Corrected by ${escapeHtml(d.corrected.by)}, ${escapeHtml(d.corrected.date)}.${
        d.corrected.notes.length ? ` ${escapeHtml(d.corrected.notes.join(" "))}` : ""}</span>`
      : "";
    return tr([
      escapeHtml(d.id), escapeHtml(d.date), inline(d.text) + fix,
      escapeHtml(names(model, d.proposedBy)), escapeHtml(names(model, d.decidedBy)),
      escapeHtml(d.how), recordRef(model, path, d.evidence), recordRef(model, path, d.source),
    ], ` data-row data-decided="${escapeHtml(d.decidedBy.join(" "))}" data-how="${escapeHtml(d.how)}"`);
  });
  const content = model.decisions.length
    ? filterBar([
      { key: "decided", label: "Decided by", options: deciders.map((id) => ({ value: id, label: personName(model, id) })) },
      { key: "how", label: "How", options: hows.map((h) => ({ value: h, label: h })) },
    ], model.decisions.length)
      + table("All decisions", ["ID", "Date", "Decision", "Proposed by", "Decided by", "How", "Evidence", "Source"], rows)
    : "<p>No decisions yet.</p>";
  return shell(model, path, "Decisions", `<h1>Decisions</h1>\n${content}`, { scripts: model.decisions.length ? clientScript() : "" });
}

export function renderProgress(model) {
  const path = "progress/index.html";
  const msRows = model.milestones.map((m) => tr([
    escapeHtml(m.id), escapeHtml(m.title), escapeHtml(m.state),
    m.plan ? recordRef(model, path, m.plan) : "-",
    m.tasksTotal === null ? "-" : `${m.tasksDone ?? 0} of ${m.tasksTotal}`,
  ]));
  const itemRows = model.openItems.map((o) => tr([o.id, o.item, o.blocks, o.owner].map((s) => escapeHtml(s))));
  const callRows = model.calls.services.map((s) => tr([
    escapeHtml(s.service), String(s.calls), s.maxCalls ? String(s.maxCalls) : "-",
    `${s.costUsd} USD`, s.maxCostUsd ? `${s.maxCostUsd} USD` : "-",
  ]));
  const body = `<h1>Progress</h1>
<h2>Milestones</h2>
${msRows.length ? table("Milestones", ["ID", "Milestone", "State", "Plan", "Tasks complete"], msRows) : "<p>No milestones yet.</p>"}
<h2>Open items</h2>
${itemRows.length ? table("Open items and blockers", ["ID", "Item", "Blocks", "Owner"], itemRows) : "<p>No open items.</p>"}
<h2>Paid calls</h2>
${callRows.length ? table("Paid calls by service", ["Service", "Calls", "Max calls", "Cost", "Max cost"], callRows) : "<p>No paid calls yet.</p>"}`;
  return shell(model, path, "Progress", body);
}

export function renderProcess(model) {
  const path = "process/index.html";
  const head = ["Time (UTC)", "Stage", "Who", "What happened", "Records", "Session"];
  const row = (e) => tr([e.time, e.stage, names(model, [e.who]), e.what, e.records, e.session].map((s) => escapeHtml(s)));
  let body = "<h1>Process</h1>\n";
  if (!model.events.length) body += "<p>No events yet.</p>";
  else {
    body += `<h2>By date</h2>\n${table("Events by date", head, model.events.map(row))}\n<h2>By stage</h2>\n`;
    for (const stage of STAGES) {
      const events = model.events.filter((e) => e.stage === stage);
      if (events.length) body += `<h3>${escapeHtml(stage)}</h3>\n${table(`Events in stage ${stage}`, head, events.map(row))}\n`;
    }
  }
  return shell(model, path, "Process", body);
}

// Safe inside a script tag: no "<" survives.
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

export function renderDocument(model, doc) {
  const path = docPath(doc.path);
  const pages = Object.fromEntries(model.documents.map((d) => [d.path, rel(path, docPath(d.path))]));
  const ctx = {
    folder: doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/")) : "",
    pages,
    blobBase: `${model.config.repository.replace(/\/$/, "")}/blob/main/replication_materials/`,
  };
  const sri = (c) => `src="${c.src}" integrity="${c.integrity}" crossorigin="anonymous"`;
  const head = `<link rel="stylesheet" href="${CDN.katexCss.src}" integrity="${CDN.katexCss.integrity}" crossorigin="anonymous">`;
  const scripts = `<script type="application/json" id="doc-md">${jsonForScript(doc.text)}</script>
<script type="application/json" id="doc-ctx">${jsonForScript(ctx)}</script>
<script ${sri(CDN.marked)}></script>
<script ${sri(CDN.dompurify)}></script>
<script ${sri(CDN.katex)}></script>
<script ${sri(CDN.katexAutoRender)}></script>
${clientScript()}`;
  const body = `<h1>${escapeHtml(doc.title)}</h1>
<p class="note">${escapeHtml(doc.path)}${doc.status ? ` · Status: ${escapeHtml(doc.status)}` : ""}</p>
<div class="doc-layout">
<div id="doc-content">
<pre id="doc-fallback" tabindex="0">${escapeHtml(doc.text)}</pre>
</div>
</div>`;
  return shell(model, path, doc.title, body, { head, scripts });
}

export function renderSite(model) {
  const site = new Map([
    ["index.html", renderHome(model)],
    ["records/index.html", renderRecords(model)],
    ["decisions/index.html", renderDecisions(model)],
    ["progress/index.html", renderProgress(model)],
    ["process/index.html", renderProcess(model)],
  ]);
  for (const doc of model.documents) site.set(docPath(doc.path), renderDocument(model, doc));
  return site;
}
