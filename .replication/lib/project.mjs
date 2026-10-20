// Assembles the markdown record of a project into one SiteModel.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseTables, findTable, readMeta, RecordFormatError } from "./tables.mjs";
import {
  readPeople, readDecisions, readRulings, readCorrectionsTable, applyCorrections,
} from "./decisions.mjs";

export const FORMAT_VERSION = 1;
export const MILESTONE_COLUMNS = ["ID", "Milestone", "State", "Plan", "Ledger"];
export const STATES = ["done", "now", "next", "planned", "blocked"];
export const OPEN_ITEM_COLUMNS = ["ID", "Item", "Blocks", "Owner"];
export const PROCESS_COLUMNS = ["Time (UTC)", "Stage", "Who", "What happened", "Records", "Session"];
export const STAGES = ["inputs", "brainstorm", "spec-review", "plan", "build", "evaluate", "paper"];
export const BUDGET_COLUMNS = ["Date", "Service", "Purpose", "Max calls", "Max cost (USD)", "Approved by"];
export const CALL_CSV_COLUMNS = [
  "time_utc", "call_id", "purpose", "model", "request_id", "status",
  "latency_ms", "input_tokens", "output_tokens", "cost_usd",
];
export const DOC_KINDS = ["design", "plan", "ledger", "investigation", "review", "findings"];

const CONFIG_FILE = ".replication/site.config.json";
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})-/;
const round3 = (n) => Math.round(n * 1000) / 1000;

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks. CRLF or LF.
export function parseCsv(text) {
  const records = [];
  let rec = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { rec.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rec.push(cur); records.push(rec); rec = []; cur = "";
    } else cur += ch;
  }
  if (cur !== "" || rec.length) { rec.push(cur); records.push(rec); }
  const [header, ...rows] = records.filter((r) => r.length > 1 || r[0] !== "");
  if (!header) return [];
  return rows.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ""])));
}

function readRequired(base, rel) {
  const path = join(base, rel);
  if (!existsSync(path)) throw new RecordFormatError(rel, 1, "file not found");
  return readFileSync(path, "utf8");
}

const listMd = (base, dir) =>
  existsSync(join(base, dir))
    ? readdirSync(join(base, dir)).filter((f) => f.endsWith(".md")).sort().map((f) => `${dir}/${f}`)
    : [];

function oneOf(value, allowed, name, file, line) {
  if (!allowed.includes(value)) {
    throw new RecordFormatError(file, line, `${name} "${value}" is not allowed. Use one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function number(value, name, file, line) {
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n)) {
    throw new RecordFormatError(file, line, `${name} "${value}" is not a number.`);
  }
  return n;
}

function loadConfig(root) {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) throw new RecordFormatError(CONFIG_FILE, 1, "file not found");
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new RecordFormatError(CONFIG_FILE, 1, `not valid JSON (${e.message}).`);
  }
  if (typeof raw.format_version !== "number") {
    throw new RecordFormatError(CONFIG_FILE, 1, "format_version must be a number.");
  }
  if (raw.format_version > FORMAT_VERSION) {
    throw new Error(
      `${CONFIG_FILE} has format_version ${raw.format_version}, but this skill reads version ${FORMAT_VERSION}. ` +
      "Run the update procedure of the replication-materials skill.");
  }
  return {
    project: raw.project, repository: raw.repository,
    format_version: raw.format_version, theme: raw.theme ?? {},
  };
}

function countTasks(base, rel, pattern, file, line, what) {
  if (!existsSync(join(base, rel))) {
    throw new RecordFormatError(file, line, `${what} file "${rel}" does not exist.`);
  }
  return [...readFileSync(join(base, rel), "utf8").matchAll(pattern)];
}

function readMilestones(base, file, tables) {
  const table = findTable(tables, "Milestones", MILESTONE_COLUMNS, file);
  return table.rows.map(({ line, cells: c }) => {
    const plan = c.Plan === "-" ? null : c.Plan;
    const ledger = c.Ledger === "-" ? null : c.Ledger;
    const tasksTotal = plan
      ? countTasks(base, plan, /^### Task \d+/gm, file, line, "Plan").length : null;
    const tasksDone = ledger
      ? new Set(countTasks(base, ledger, /^Task (\d+): complete\b/gm, file, line, "Ledger").map((m) => m[1])).size
      : null;
    return {
      id: c.ID, title: c.Milestone, state: oneOf(c.State, STATES, "State", file, line),
      plan, ledger, tasksDone, tasksTotal,
    };
  });
}

function readEvents(text, file) {
  const table = findTable(parseTables(text, file), null, PROCESS_COLUMNS, file);
  return table.rows
    .map(({ line, cells: c }) => {
      if (!TIME.test(c["Time (UTC)"])) {
        throw new RecordFormatError(file, line, `Time (UTC) "${c["Time (UTC)"]}" must look like 2026-10-19T14:30Z.`);
      }
      return {
        time: c["Time (UTC)"], stage: oneOf(c.Stage, STAGES, "Stage", file, line),
        who: c.Who, what: c["What happened"], records: c.Records, session: c.Session,
      };
    })
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function readAllDecisions(base, people) {
  const file = "project/decisions.md";
  const text = readRequired(base, file);
  const dNum = (d) => Number(d.id.match(/\d+/)?.[0] ?? Infinity);
  const rows = readDecisions(text, file, people).sort((a, b) => dNum(a) - dNum(b));
  const rulings = listMd(base, "plans").filter((f) => f.endsWith("-ledger.md"))
    .flatMap((f) => readRulings(readFileSync(join(base, f), "utf8"), f));
  return applyCorrections([...rows, ...rulings], readCorrectionsTable(text, file), people, file);
}

function docKind(rel) {
  const suffix = rel.match(/-([a-z]+)\.md$/)?.[1];
  if (DOC_KINDS.includes(suffix)) return suffix;
  if (rel.startsWith("probes/")) return "probes";
  if (rel.startsWith("calls/")) return "calls";
  if (rel.startsWith("findings/")) return "findings";
  if (rel.startsWith("plans/")) return "plan";
  return "readme";
}

function readDocuments(base) {
  const probes = existsSync(join(base, "probes"))
    ? readdirSync(join(base, "probes"), { recursive: true })
        .map((p) => p.replaceAll("\\", "/")).filter((p) => p.endsWith("/README.md")).sort()
        .map((p) => `probes/${p}`)
    : [];
  const paths = ["README.md", ...listMd(base, "plans"), ...listMd(base, "findings"), ...probes, "calls/README.md"]
    .filter((p) => existsSync(join(base, p)));
  return paths.map((path) => {
    const text = readFileSync(join(base, path), "utf8");
    const { title, meta } = readMeta(text, path);
    const parts = path.split("/");
    const datedName = path.startsWith("probes/") ? parts[1] : parts[parts.length - 1];
    return {
      path, title: title ?? parts[parts.length - 1], kind: docKind(path),
      date: datedName.match(DATE_PREFIX)?.[1] ?? null, status: meta.Status ?? null, text,
    };
  }).sort((a, b) => (a.date === b.date ? 0 : a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? -1 : 1)
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function readCalls(base) {
  const budgets = [];
  const readme = "calls/README.md";
  if (existsSync(join(base, readme))) {
    const table = findTable(parseTables(readFileSync(join(base, readme), "utf8"), readme), null, BUDGET_COLUMNS, readme);
    for (const { line, cells: c } of table.rows) {
      budgets.push({
        date: c.Date, service: c.Service, purpose: c.Purpose,
        maxCalls: number(c["Max calls"], "Max calls", readme, line),
        maxCostUsd: number(c["Max cost (USD)"], "Max cost (USD)", readme, line),
        approvedBy: c["Approved by"],
      });
    }
  }
  const services = new Map();
  const entry = (service) => {
    if (!services.has(service)) services.set(service, { service, calls: 0, costUsd: 0, maxCalls: 0, maxCostUsd: 0 });
    return services.get(service);
  };
  for (const b of budgets) {
    const s = entry(b.service);
    s.maxCalls += b.maxCalls;
    s.maxCostUsd += b.maxCostUsd;
  }
  const dir = join(base, "calls");
  const csvs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith("-calls.csv")).sort() : [];
  for (const f of csvs) {
    const rel = `calls/${f}`;
    const text = readFileSync(join(base, rel), "utf8");
    const header = text.split(/\r?\n/, 1)[0].split(",").map((h) => h.trim());
    const missing = CALL_CSV_COLUMNS.filter((c) => !header.includes(c));
    if (missing.length) throw new RecordFormatError(rel, 1, `lacks column(s) ${missing.join(", ")}.`);
    const s = entry(f.slice(0, -"-calls.csv".length));
    parseCsv(text).forEach((r, k) => {
      s.calls += 1;
      s.costUsd += number(r.cost_usd, "cost_usd", rel, k + 2);
    });
  }
  const list = [...services.values()].sort((a, b) => a.service.localeCompare(b.service))
    .map((s) => ({ ...s, costUsd: round3(s.costUsd), maxCostUsd: round3(s.maxCostUsd) }));
  return { budgets, services: list };
}

function gitSha(root) {
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || "local";
  } catch {
    return "local";
  }
}

export function loadProject(root, opts = {}) {
  const config = loadConfig(root);
  const base = join(root, "replication_materials");
  const roadmapFile = "project/roadmap.md";
  const roadmap = readRequired(base, roadmapFile);
  const people = readPeople(roadmap, roadmapFile);
  const roadmapTables = parseTables(roadmap, roadmapFile);
  const milestones = readMilestones(base, roadmapFile, roadmapTables);
  const openItems = findTable(roadmapTables, "Open items", OPEN_ITEM_COLUMNS, roadmapFile).rows.map(({ cells: c }) => ({
    id: c.ID, item: c.Item, blocks: c.Blocks, owner: c.Owner,
  }));
  const decisions = readAllDecisions(base, people);
  const tally = new Map();
  for (const d of decisions) for (const id of d.decidedBy) tally.set(id, (tally.get(id) ?? 0) + 1);
  const byDecider = [...tally].map(([id, count]) => ({ id, name: people.get(id).name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    config, people, milestones, openItems,
    status: {
      current: milestones.find((m) => m.state === "now") ?? null,
      next: milestones.find((m) => m.state === "next") ?? null,
    },
    decisions,
    events: readEvents(readRequired(base, "project/process.md"), "project/process.md"),
    documents: readDocuments(base),
    calls: readCalls(base),
    counts: { byDecider },
    build: { sha: opts.gitSha ?? gitSha(root), date: opts.buildDate ?? new Date().toISOString().slice(0, 10) },
  };
}
