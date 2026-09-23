"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripComment = stripComment;
exports.lex = lex;
exports.blocks = blocks;
exports.warn = warn;
exports.numberField = numberField;
const logger_1 = require("../../../helper/logger");
const COMMENT = "//";
// A comment starts at a `//` that opens the line or follows whitespace. Anything else is data:
// TopSkySettings.txt carries `https://` URLs and a naive split would cut them in half.
function stripComment(raw) {
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
function split(text) {
    const colon = text.indexOf(":");
    const comma = text.indexOf(",");
    if (colon < 0 && comma < 0)
        return [text];
    const separator = colon >= 0 && (comma < 0 || colon < comma) ? ":" : ",";
    return text.split(separator).map((field) => field.trim());
}
// Reads a whole file into lines, dropping comments and blanks and carrying the nearest preceding
// comment onto each line. One reader for every TopSky file; the per-file parsers only see this.
function lex(file, content) {
    const lines = [];
    let comment = "";
    const raws = content.split(/\r?\n/);
    for (let i = 0; i < raws.length; i++) {
        const raw = raws[i];
        const { text, comment: found } = stripComment(raw);
        if (!text) {
            // A comment on its own line names whatever follows it until the next one.
            if (found)
                comment = found;
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
function blocks(lines, headers) {
    const wanted = new Set(headers.map((header) => header.toUpperCase()));
    const preamble = [];
    const out = [];
    let current = null;
    for (const line of lines) {
        if (wanted.has(line.keyword)) {
            current = { header: line, lines: [] };
            out.push(current);
            continue;
        }
        if (current)
            current.lines.push(line);
        else
            preamble.push(line);
    }
    return { preamble, blocks: out };
}
function warn(line, message) {
    (0, logger_1.logTopSkyParsingWarning)(line.file, line.lineNumber, line.raw, message);
}
// A number that must be finite. Returns undefined and warns, naming the field, when it is not.
function numberField(line, index, what) {
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
//# sourceMappingURL=topsky-lexer.js.map