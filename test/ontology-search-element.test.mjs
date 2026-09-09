import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

globalThis.HTMLElement = class {};
const definitions = new Map();
globalThis.customElements = {
  define(name, constructor) { definitions.set(name, constructor); },
  get(name) { return definitions.get(name); }
};
globalThis.location = { hostname: "example.org" };

const source = await readFile(
  new URL("../dist/ontology-search-element.js", import.meta.url),
  "utf8"
);
const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const ontology = await import(moduleUrl);

test("registers the canonical tag and compatibility alias", () => {
  assert.ok(definitions.get("ontology-search"));
  assert.ok(definitions.get("ontology-mapper"));
});

test("formats common ontology identifiers", () => {
  assert.equal(
    ontology.uriToCode("http://purl.obolibrary.org/obo/HP_0001234"),
    "HP:0001234"
  );
  assert.equal(
    ontology.uriToCode("http://aims.fao.org/aos/agrovoc/c_7174"),
    "AGROVOC:7174"
  );
});

test("returns NullFlavor concepts without network access", async () => {
  const results = await ontology.searchOntology("nullflavor", "masked");
  assert.equal(results.length, 1);
  assert.equal(results[0].extra.code, "MSK");
  assert.equal(results[0].source, "nullflavor");
});

test("supports host-provided backends", async () => {
  ontology.registerOntologyBackend({
    id: "test",
    label: "Test",
    async search(query) {
      return [{ uri: "https://example.org/" + query, label: query, source: "test" }];
    }
  });
  const [result] = await ontology.searchOntology("test", "concept");
  assert.equal(result.uri, "https://example.org/concept");
});
