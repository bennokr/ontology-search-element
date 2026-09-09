# ontology-search-element

A dependency-free Web Component for searching public ontology and vocabulary services.

It is deliberately small: one ES module, no framework, no npm package, and no build step. The component returns stable concept records; host applications decide what a concept means and how to persist it.

## Use a tagged version

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/gh/bennokr/ontology-search-element@v0.1.0/dist/ontology-search-element.js"
></script>

<ontology-search label="population"></ontology-search>
```

Listen for the framework-neutral events:

```js
const search = document.querySelector("ontology-search");

search.addEventListener("ontology-select", (event) => {
  // { uri, label, description?, source, extra? }
  console.log(event.detail);
});

search.addEventListener("ontology-clear", () => {
  console.log("the host should clear its stored mapping");
});
```

The old `<ontology-mapper>` name is registered as a compatibility alias.

## Attributes

- `label`: initial search text.
- `concept-uri`, `concept-label`, `concept-description`: show a selected concept chip.
- `backend`: initial backend identifier.
- `providers`: comma-separated allow-list of backend identifiers.

Included backends are Wikidata, OLS4, CESSDA ELSST, UNESCO, AGROVOC, and the local HL7 v3 NullFlavor list.

## Configuration and extension

The module exports `configureOntologySearch`, `registerOntologyBackend`,
`searchOntology`, `BACKENDS`, and `uriToCode`. It also exposes the same API
as `globalThis.OntologySearchElement` for hosts that load it only through a
script tag.

```js
OntologySearchElement.configure({
  endpoints: {
    ols4: "/api-proxy/ols4",
    cessda: "/api-proxy/cessda",
    unesco: "/api-proxy/unesco"
  }
});

OntologySearchElement.registerBackend({
  id: "my-vocabulary",
  label: "My vocabulary",
  description: "Internal vocabulary service",
  async search(query, signal) {
    return [{ uri: "https://example.org/concept/1", label: query, source: "my-vocabulary" }];
  }
});
```

On localhost, the three services commonly needing a development proxy default
to the `/api-proxy/{id}` paths already used by LinkedBayes and Statlet.
Production uses their public endpoints. Override either behavior with
`configureOntologySearch`.

## Versioning

Consumers should use an immutable Git tag in the jsDelivr URL. Do not use
`@main` in deployed pages. Tags follow semantic versioning; the DOM event and
result contracts are the compatibility boundary.

## License

MIT.
