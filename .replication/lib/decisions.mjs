// People, decisions, rulings and corrections read from record files.

import { parseTables, findTable, fenceFlags, RecordFormatError } from "./tables.mjs";

export const PEOPLE_COLUMNS = ["ID", "Name", "Role", "Link"];
export const DECISION_COLUMNS = ["ID", "Date", "Decision", "Proposed by", "Decided by", "How", "Evidence", "Source"];
export const CORRECTION_COLUMNS = ["Decision", "Field", "New value", "Checked by", "Date", "Note"];
export const HOW_VALUES = ["chat", "question", "review", "measurement", "plan-approval", "playback", "ruling", "classified"];
export const BUILT_IN_PEOPLE = { claude: "Claude Code", subagent: "Subagent", unknown: "Unknown" };

// Correction "Field" values and the decision property each one replaces.
const CORRECTION_FIELDS = {
  "Decision": "text",
  "Proposed by": "proposedBy",
  "Decided by": "decidedBy",
  "How": "how",
  "Evidence": "evidence",
};

export function readPeople(roadmapText, file) {
  const table = findTable(parseTables(roadmapText, file), "People", PEOPLE_COLUMNS, file);
  const people = new Map();
  for (const [id, name] of Object.entries(BUILT_IN_PEOPLE)) people.set(id, { id, name, role: "", link: "" });
  for (const { cells: c } of table.rows) {
    people.set(c.ID, { id: c.ID, name: c.Name, role: c.Role, link: c.Link });
  }
  return people;
}

function personIds(value, people, file, line) {
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new RecordFormatError(file, line, "a person ID is required.");
  for (const id of ids) {
    if (!people.has(id)) {
      throw new RecordFormatError(file, line, `unknown person "${id}". Known IDs: ${[...people.keys()].join(", ")}.`);
    }
  }
  return ids;
}

function checkHow(value, file, line) {
  if (!HOW_VALUES.includes(value)) {
    throw new RecordFormatError(file, line, `How "${value}" is not allowed. Use one of: ${HOW_VALUES.join(", ")}.`);
  }
  return value;
}

export function readDecisions(text, file, people) {
  const table = findTable(parseTables(text, file), "Decisions", DECISION_COLUMNS, file);
  const seen = new Set();
  return table.rows.map(({ line, cells: c }) => {
    if (seen.has(c.ID)) throw new RecordFormatError(file, line, `duplicate decision ID "${c.ID}".`);
    seen.add(c.ID);
    return {
      id: c.ID,
      date: c.Date,
      text: c.Decision,
      proposedBy: personIds(c["Proposed by"], people, file, line),
      decidedBy: personIds(c["Decided by"], people, file, line),
      how: checkHow(c.How, file, line),
      evidence: c.Evidence,
      source: c.Source,
      file,
      line,
      corrected: null,
    };
  });
}

const RULING = /\bRuling(?:\s+\d+)?:\s*(.+)$/;

export function readRulings(text, ledgerPath) {
  const base = ledgerPath.split("/").pop();
  const m = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)-ledger\.md$/);
  if (!m) {
    throw new RecordFormatError(ledgerPath, 1, `ledger file name must look like YYYY-MM-DD-<topic>-ledger.md, not "${base}".`);
  }
  const [, date, topic] = m;
  const lines = text.split(/\r?\n/);
  const inFence = fenceFlags(lines);
  const rulings = [];
  lines.forEach((line, i) => {
    if (inFence[i]) return;
    const r = line.match(RULING);
    if (!r) return;
    rulings.push({
      id: `R-${date}-${topic}-${rulings.length + 1}`,
      date,
      text: r[1].replace(/^`+|`+$/g, "").trim(),
      proposedBy: ["claude"],
      decidedBy: ["claude"],
      how: "ruling",
      evidence: "",
      source: `${ledgerPath}:${i + 1}`,
      file: ledgerPath,
      line: i + 1,
      corrected: null,
    });
  });
  return rulings;
}

export function readCorrectionsTable(text, file) {
  const table = parseTables(text, file).find((t) => t.heading === "Corrections");
  return table ? findTable([table], "Corrections", CORRECTION_COLUMNS, file) : null;
}

export function applyCorrections(decisions, table, people, file) {
  const out = decisions.map((d) => ({ ...d }));
  if (!table) return out;
  const byId = new Map(out.map((d) => [d.id, d]));
  for (const { line, cells: c } of table.rows) {
    const d = byId.get(c.Decision);
    if (!d) throw new RecordFormatError(file, line, `correction names unknown decision "${c.Decision}".`);
    const prop = CORRECTION_FIELDS[c.Field];
    if (!prop) {
      throw new RecordFormatError(file, line,
        `correction Field "${c.Field}" is not allowed. Use one of: ${Object.keys(CORRECTION_FIELDS).join(", ")}.`);
    }
    const [checker] = personIds(c["Checked by"], people, file, line);
    const value = c["New value"];
    if (prop === "proposedBy" || prop === "decidedBy") d[prop] = personIds(value, people, file, line);
    else if (prop === "how") d.how = checkHow(value, file, line);
    else d[prop] = value;
    const prev = d.corrected ?? { by: "", date: "", notes: [], fields: [] };
    d.corrected = {
      by: people.get(checker).name,
      date: c.Date,
      notes: c.Note ? [...prev.notes, c.Note] : prev.notes,
      fields: prev.fields.includes(c.Field) ? prev.fields : [...prev.fields, c.Field],
    };
  }
  return out;
}
