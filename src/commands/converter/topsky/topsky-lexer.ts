import { logTopSkyParsingWarning } from "../../../helper/logger";

// One line of a TopSky data file, already stripped of its comment and split on the separator.
// The line number and the raw text ride along so every warning can name them.
export interface TopSkyLine {
  file: string;
  lineNumber: number;
  raw: string;
  keyword: string;
  fields: string[];
  // The nearest preceding comment line, which is how the MSAW author names a runway or an
  // altitude band; it is the only description those records have.
  comment: string;
}

// A run of lines opened by one of the block keywords the caller names, up to the next one.
export interface TopSkyBlock {
  header: TopSkyLine;
  lines: TopSkyLine[];
}

const COMMENT = "//";

// A comment starts at a `//` that opens the line or follows whitespace. Anything else is data:
// TopSkySettings.txt carries `https://` URLs and a naive split would cut them in half.
export function stripComment(raw: string): { text: string; comment: string } {
  let at = raw.indexOf(COMMENT);
  while (at >= 0) {
    if (at === 0 || /\s/.test(raw[at - 1])) {
      return { text: raw.slice(0, at).trim(), comment: raw.slice(at + COMMENT.length).trim() };
    }
    at = raw.indexOf(COMMENT, at + COMMENT.length);
  }
  return { text: raw.trim(), comment: "" };
}

// A comma is the legacy separator for old files, so both are accepted; a line holding neither is
// one field. The Developer Guide is explicit that the two never mix in the same file, and taking
// whichever appears first keeps a name containing a comma intact.
function split(text: string): string[] {
  const colon = text.indexOf(":");
  const comma = text.indexOf(",");
  if (colon < 0 && comma < 0) return [text];
  const separator = colon >= 0 && (comma < 0 || colon < comma) ? ":" : ",";
  return text.split(separator).map((field) => field.trim());
}

// Reads a whole file into lines, dropping comments and blanks and carrying the nearest preceding
// comment onto each line. One reader for every TopSky file; the per-file parsers only see this.
export function lex(file: string, content: string): TopSkyLine[] {
  const lines: TopSkyLine[] = [];
  let comment = "";
  const raws = content.split(/\r?\n/);
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    const { text, comment: found } = stripComment(raw);
    if (!text) {
      // A comment on its own line names whatever follows it until the next one.
      if (found) comment = found;
      continue;
    }
    const fields = split(text);
    lines.push({
      file,
      lineNumber: i + 1,
      raw: raw.trim(),
      keyword: fields[0].toUpperCase(),
      fields,
      comment,
    });
  }
  return lines;
}

// Groups lines into blocks opened by the given header keywords. Lines before the first header are
// returned as the preamble, which is where a file's own definitions (COLORDEF, CATEGORYDEF) sit.
export function blocks(
  lines: TopSkyLine[],
  headers: readonly string[]
): { preamble: TopSkyLine[]; blocks: TopSkyBlock[] } {
  const wanted = new Set(headers.map((header) => header.toUpperCase()));
  const preamble: TopSkyLine[] = [];
  const out: TopSkyBlock[] = [];
  let current: TopSkyBlock | null = null;

  for (const line of lines) {
    if (wanted.has(line.keyword)) {
      current = { header: line, lines: [] };
      out.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  return { preamble, blocks: out };
}

export function warn(line: TopSkyLine, message: string): void {
  logTopSkyParsingWarning(line.file, line.lineNumber, line.raw, message);
}

// A number that must be finite. Returns undefined and warns, naming the field, when it is not.
export function numberField(
  line: TopSkyLine,
  index: number,
  what: string
): number | undefined {
  const text = line.fields[index];
  if (text === undefined || text === "") {
    warn(line, `${what} is missing`);
    return undefined;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    warn(line, `${what} "${text}" is not a number`);
    return undefined;
  }
  return value;
}
