import test from "node:test";
import assert from "node:assert/strict";

import { blocks, lex, stripComment } from "../src/commands/converter/topsky/topsky-lexer";

// One line reader for every TopSky file. The comment rule is the one that bites: TopSkySettings
// carries https:// URLs and a naive split would cut them in half.

test("a comment opening a line is stripped and remembered", () => {
  const { text, comment } = stripComment("//Belgium");

  assert.equal(text, "");
  assert.equal(comment, "Belgium");
});

test("a comment after whitespace is stripped, one inside a URL is not", () => {
  assert.equal(stripComment("QNHTL:EG:70,940   //EG3000").text, "QNHTL:EG:70,940");
  assert.equal(
    stripComment("HTTP_AUP_URL=https://eaup.vatsim.pt/api/v2/areas/").text,
    "HTTP_AUP_URL=https://eaup.vatsim.pt/api/v2/areas/"
  );
});

test("the nearest preceding comment rides on every line under it", () => {
  const lines = lex("TopSkyMSAW.txt", ["//Runway 15", "P:3:1:1:2:2:3:3:1500", "C:N051.00.00.000:W001.00.00.000:3:2300"].join("\n"));

  assert.equal(lines.length, 2);
  assert.equal(lines[0].comment, "Runway 15");
  assert.equal(lines[1].comment, "Runway 15");
});

test("the line number is the line's own, counting blanks and comments", () => {
  const lines = lex("f.txt", ["", "//heading", "", "AREA:1:EGD064A"].join("\n"));

  assert.equal(lines.length, 1);
  assert.equal(lines[0].lineNumber, 4);
  assert.equal(lines[0].keyword, "AREA");
});

test("a comma file splits on commas and a colon file on colons", () => {
  assert.deepEqual(lex("f.txt", "AREA:1:EGD064A")[0].fields, ["AREA", "1", "EGD064A"]);
  assert.deepEqual(lex("f.txt", "AREA,1,EGD064A")[0].fields, ["AREA", "1", "EGD064A"]);
});

test("blocks open at the named headers and everything before the first one is the preamble", () => {
  const lines = lex(
    "f.txt",
    ["CATEGORYDEF:DANGER:1", "AREA:1:A", "LIMITS:0:100", "AREA:1:B", "LIMITS:0:200"].join("\n")
  );
  const grouped = blocks(lines, ["AREA"]);

  assert.equal(grouped.preamble.length, 1);
  assert.equal(grouped.preamble[0].keyword, "CATEGORYDEF");
  assert.equal(grouped.blocks.length, 2);
  assert.equal(grouped.blocks[0].header.fields[2], "A");
  assert.equal(grouped.blocks[0].lines.length, 1);
  assert.equal(grouped.blocks[1].lines[0].fields[2], "200");
});
