import { TopSkyLine, warn } from "./topsky-lexer";

// The activation rules a dataset feature carries. One shape for the areas file and for the
// conditional map system that lands later: the grammar is the same in both.
export type ActivationRule =
  | { kind: "always" }
  | {
      kind: "schedule";
      // MMDD for a yearly period, YYMMDD for a one-off one.
      from: string;
      to: string;
      // Weekday digits 1 (Monday) to 7, or "0" for continuous from start to end.
      days: string;
      start: string;
      end: string;
      // The zone the start and end are in. "UTC" when the ranges were kept as the file wrote
      // them, an IANA zone when the DST-split pair folded into one local-time rule.
      zone: string;
      lowerFt?: number;
      upperFt?: number;
      userText?: string;
    }
  | { kind: "notam"; icao: string; text: string }
  | { kind: "runways"; arr: string[]; notArr: string[]; dep: string[]; notDep: string[] }
  | { kind: "position"; yours: string[]; notYours: string[]; online: string[]; notOnline: string[] }
  | { kind: "aup"; ref: string };

const MINUTES_PER_DAY = 24 * 60;

// A `*` is TopSky's "any", which is an empty list here: no rule is an empty list in the dataset,
// so an all-wildcard entry drops out entirely.
function list(field: string | undefined): string[] {
  const text = (field ?? "").trim();
  if (!text || text === "*") return [];
  return text
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "*");
}

function isDatePeriod(field: string | undefined): boolean {
  return /^\d{4}$/.test(field ?? "") || /^\d{6}$/.test(field ?? "");
}

function timeOfDay(field: string | undefined): string | null {
  const text = (field ?? "").trim();
  if (!/^\d{4}$/.test(text)) return null;
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2));
  if (hours > 24 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// One ACTIVE line to a rule. Returns null and warns when the line matches no known form, because
// an activation nobody can evaluate is an area that silently never activates.
export function parseActive(line: TopSkyLine): ActivationRule | null {
  const fields = line.fields;
  const first = (fields[1] ?? "").trim().toUpperCase();

  if (fields.length === 2 && first === "1") return { kind: "always" };

  if (first === "AUP") {
    const ref = (fields[2] ?? "").trim();
    if (!ref) {
      warn(line, "ACTIVE:AUP names no area");
      return null;
    }
    return { kind: "aup", ref };
  }

  if (first === "NOTAM") {
    const icao = (fields[2] ?? "").trim();
    const text = fields.slice(3).join(":").trim();
    if (!icao || !text) {
      warn(line, "ACTIVE:NOTAM needs an ICAO and the text to look for");
      return null;
    }
    return { kind: "notam", icao, text };
  }

  if (first === "RWY") {
    const rule = parseRunways(fields.slice(2));
    if (!rule) {
      warn(line, "ACTIVE:RWY needs ARR and DEP lists");
      return null;
    }
    return rule;
  }

  if (first === "ID") {
    return {
      kind: "position",
      yours: list(fields[2]),
      notYours: list(fields[3]),
      online: list(fields[4]),
      notOnline: list(fields[5]),
    };
  }

  if (isDatePeriod(fields[1])) {
    const start = timeOfDay(fields[4]);
    const end = timeOfDay(fields[5]);
    if (!isDatePeriod(fields[2]) || !fields[3] || !start || !end) {
      warn(line, "ACTIVE schedule needs start:end:days:HHMM:HHMM");
      return null;
    }
    const rule: ActivationRule = {
      kind: "schedule",
      from: fields[1].trim(),
      to: fields[2].trim(),
      days: fields[3].trim(),
      start,
      end,
      zone: "UTC",
    };
    const lower = Number(fields[6]);
    const upper = Number(fields[7]);
    if (fields[6] && Number.isFinite(lower)) rule.lowerFt = lower;
    if (fields[7] && Number.isFinite(upper)) rule.upperFt = upper;
    const userText = fields.slice(8).join(":").trim();
    if (userText) rule.userText = userText;
    return rule;
  }

  warn(line, "ACTIVE line matches no known form and the area would never activate");
  return null;
}

// ACTIVE:RWY:ARR:<list>[:<not>]:DEP:<list>[:<not>], where the optional not-lists make the field
// count vary; the ARR and DEP keywords are what anchor it.
function parseRunways(fields: string[]): ActivationRule | null {
  const upper = fields.map((field) => (field ?? "").trim().toUpperCase());
  const arrAt = upper.indexOf("ARR");
  const depAt = upper.indexOf("DEP");
  if (arrAt < 0 || depAt < 0 || depAt < arrAt) return null;

  const arrFields = fields.slice(arrAt + 1, depAt);
  const depFields = fields.slice(depAt + 1);
  return {
    kind: "runways",
    arr: list(arrFields[0]),
    notArr: list(arrFields[1]),
    dep: list(depFields[0]),
    notDep: list(depFields[1]),
  };
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutes(total: number): string {
  const wrapped = ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// The zone's offset from UTC in minutes on the given day, read from the platform's own tz data.
// Node carries it, so the fold needs no dependency.
export function offsetMinutes(zone: string, date: Date): number | null {
  try {
    const format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const part of format.formatToParts(date)) parts[part.type] = part.value;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    );
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch {
    return null;
  }
}

// A date inside an MMDD or YYMMDD period, used only to ask the zone for its offset then.
function dateInside(period: string): Date {
  if (period.length === 6) {
    const year = 2000 + Number(period.slice(0, 2));
    return new Date(Date.UTC(year, Number(period.slice(2, 4)) - 1, Number(period.slice(4, 6)), 12));
  }
  const year = new Date().getUTCFullYear();
  return new Date(Date.UTC(year, Number(period.slice(0, 2)) - 1, Number(period.slice(2, 4)), 12));
}

export interface FoldResult {
  rules: ActivationRule[];
  folded: number;
  // Schedule rules left as the UTC the file wrote although the area is split across periods,
  // which is what an author clamping a summer range to the end of the day produces.
  partial: number;
}

// The day after an MMDD period end, so two periods can be tested for being back to back. A
// non-leap reference year, because these are yearly rules and 29 February is not one of them.
function dayAfter(mmdd: string): string {
  const at = new Date(Date.UTC(2001, Number(mmdd.slice(0, 2)) - 1, Number(mmdd.slice(2, 4))));
  at.setUTCDate(at.getUTCDate() + 1);
  return (
    String(at.getUTCMonth() + 1).padStart(2, "0") + String(at.getUTCDate()).padStart(2, "0")
  );
}

/**
 * Folds the daylight-saving split TopSky files carry into one local-time rule each. The UK file
 * writes three UTC ranges for one activation, split at the March and October changeover dates,
 * and its own header says they need a yearly edit; one local-time rule needs none.
 *
 * Two things make this safe rather than clever. Ranges are matched by their LOCAL start and end
 * in `zone`, so a wrong zone matches nothing and folds nothing; and a matched set folds only when
 * its periods are back to back and together span the whole year, which is the shape a DST split
 * has and nothing else. Two winter halves either side of a summer gap therefore stay as they are
 * rather than becoming one rule that would be active all summer too.
 */
export function foldSchedules(rules: ActivationRule[], zone: string): FoldResult {
  type Schedule = Extract<ActivationRule, { kind: "schedule" }>;

  const schedules = rules.filter(
    (rule): rule is Schedule => rule.kind === "schedule" && rule.zone === "UTC" && rule.from.length === 4
  );
  const periods = new Set(schedules.map((rule) => `${rule.from}-${rule.to}`));
  if (schedules.length < 2 || periods.size < 2 || zone === "UTC") {
    return { rules, folded: 0, partial: 0 };
  }

  // One bucket per (weekdays, limits, text, LOCAL times): the ranges of one activation seen in
  // each period. Two ranges within one period, as a night closure has, land in separate buckets.
  const buckets = new Map<string, { rule: Schedule; local: { start: string; end: string } }[]>();
  const untouched: Schedule[] = [];

  for (const rule of schedules) {
    const offset = offsetMinutes(zone, dateInside(rule.from));
    if (offset === null) {
      untouched.push(rule);
      continue;
    }
    const local = {
      start: formatMinutes(minutesOf(rule.start) + offset),
      end: formatMinutes(minutesOf(rule.end) + offset),
    };
    const key = [rule.days, rule.lowerFt ?? "", rule.upperFt ?? "", rule.userText ?? "", local.start, local.end].join("|");
    const bucket = buckets.get(key);
    if (bucket) bucket.push({ rule, local });
    else buckets.set(key, [{ rule, local }]);
  }

  const folded: ActivationRule[] = [];
  const consumed = new Set<ActivationRule>();

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    const sorted = [...bucket].sort((a, b) => a.rule.from.localeCompare(b.rule.from));
    let contiguous = sorted[0].rule.from === "0101" && sorted[sorted.length - 1].rule.to === "1231";
    for (let i = 1; contiguous && i < sorted.length; i++) {
      contiguous = dayAfter(sorted[i - 1].rule.to) === sorted[i].rule.from;
    }
    if (!contiguous) continue;

    folded.push({
      ...sorted[0].rule,
      from: "0101",
      to: "1231",
      start: sorted[0].local.start,
      end: sorted[0].local.end,
      zone,
    });
    for (const entry of sorted) consumed.add(entry.rule);
  }

  const kept = rules.filter((rule) => !consumed.has(rule));
  const partial = kept.filter(
    (rule) => rule.kind === "schedule" && rule.zone === "UTC" && rule.from.length === 4
  ).length;
  return { rules: [...kept, ...folded], folded: folded.length, partial };
}
