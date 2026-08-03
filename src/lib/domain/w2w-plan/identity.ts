/**
 * Employee identity for the W2W round-trip (docs/w2w-shift-plan-roundtrip.md
 * §6). The email-keyed mapping uploaded from W2W's Employee Details export is
 * the source of truth for W2W display names; the derived name is only the
 * fallback for students the mapping does not know yet, and every fallback use
 * is surfaced as an export warning because a name W2W does not recognize
 * silently leaves the shift unassigned on upload.
 */
import { parseCsv } from "@/lib/roster/csv";

/**
 * Derive a W2W-style display name from a roster display name. The roster
 * writes "Last, First Middle"; W2W lists "First Last" with middle names
 * dropped. A name with no comma is assumed to already lead with the given
 * name and is returned trimmed.
 */
export function deriveW2wName(displayName: string): string {
  const at = displayName.indexOf(",");
  if (at < 0) return displayName.trim();
  const last = displayName.slice(0, at).trim();
  const given = displayName.slice(at + 1).trim().split(/\s+/)[0] ?? "";
  if (given === "") return last;
  return `${given} ${last}`;
}

export interface W2wEmployeeRecord {
  email: string;
  w2wName: string;
  employeeNumber: string;
}

export interface W2wEmployeesParseResult {
  ok: boolean;
  reason?: string;
  employees: W2wEmployeeRecord[];
  /** Rows skipped for having no usable email. */
  skipped: number;
}

/**
 * Parse W2W's Employee Details export. Only name, email, and employee number
 * are read; the export's address and phone columns are deliberately ignored
 * (data minimization). Emails are lowercased; rows without one are skipped
 * (they cannot key the mapping).
 */
export function parseW2wEmployees(csvText: string): W2wEmployeesParseResult {
  const grid = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (grid.length === 0) return { ok: false, reason: "The file is empty.", employees: [], skipped: 0 };

  const header = grid[0]!.map((h) => h.trim().toLowerCase());
  const nameAt = header.indexOf("employee name");
  const emailAt = header.indexOf("email");
  const numberAt = header.indexOf("employee number");
  if (nameAt < 0 || emailAt < 0) {
    return {
      ok: false,
      reason: "This doesn't look like the W2W Employee Details export (need the Employee Name and Email columns).",
      employees: [],
      skipped: 0,
    };
  }

  const employees: W2wEmployeeRecord[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const row of grid.slice(1)) {
    const email = (row[emailAt] ?? "").trim().toLowerCase();
    const name = (row[nameAt] ?? "").trim();
    if (email === "" || name === "") {
      skipped += 1;
      continue;
    }
    // Last occurrence wins on a duplicate email; W2W lists each employee once.
    if (seen.has(email)) {
      const at = employees.findIndex((e) => e.email === email);
      employees.splice(at, 1);
    }
    seen.add(email);
    employees.push({
      email,
      w2wName: name,
      employeeNumber: numberAt >= 0 ? (row[numberAt] ?? "").trim() : "",
    });
  }
  if (employees.length === 0) {
    return { ok: false, reason: "No rows with an email were found.", employees: [], skipped };
  }
  return { ok: true, employees, skipped };
}
