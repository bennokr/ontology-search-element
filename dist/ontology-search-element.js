const DEFAULT_ENDPOINTS = Object.freeze({
  wikidata: "https://www.wikidata.org/w/api.php",
  ols4: "https://www.ebi.ac.uk/ols4/api/select",
  cessda: "https://thesauri.cessda.eu/rest/v1/search",
  unesco: "https://vocabularies.unesco.org/rest/v1/search",
  agrovoc: "https://agrovoc.fao.org/browse/rest/v1/search"
});

const NULL_FLAVORS = Object.freeze([
  ["NI", "NoInformation", "No information available"],
  ["INV", "Invalid", "Value is invalid (cannot be decoded or failed business rules)"],
  ["DER", "Derived", "Value is derived from other information"],
  ["OTH", "Other", "The actual value is not a member of the value set"],
  ["NINF", "NegativeInfinity", "Negative infinity (less than the minimum possible value)"],
  ["PINF", "PositiveInfinity", "Positive infinity (greater than the maximum possible value)"],
  ["UNC", "Unencoded", "Value exists but cannot be encoded in the target value set"],
  ["MSK", "Masked", "Information is available but withheld (for example, for privacy reasons)"],
  ["NA", "NotApplicable", "No proper value exists because the concept is not applicable"],
  ["UNK", "Unknown", "A proper value exists but is not known"],
  ["ASKU", "AskedUnknown", "Information was sought but not found"],
  ["NAV", "TemporarilyUnavailable", "Value is unavailable now but may become available"],
  ["NASK", "NotAsked", "Information was not sought"],
  ["QS", "SufficientQuantity", "Quantity is sufficient; the exact amount is not relevant"],
  ["TRC", "Trace", "Value is below the measurable threshold"],
  ["NP", "NotPresent", "Value is not present in the message"]
]);

let configuration = {
  endpoints: {},
  language: "en",
  limit: 10,
  proxyOnLocalhost: true
};

function isLocalhost() {
  return typeof location !== "undefined" &&
    (location.hostname === "127.0.0.1" || location.hostname === "localhost");
}

function endpointFor(id) {
  if (configuration.endpoints && configuration.endpoints[id]) {
    return configuration.endpoints[id];
  }
  if (configuration.proxyOnLocalhost && isLocalhost() &&
      (id === "ols4" || id === "cessda" || id === "unesco")) {
    return "/api-proxy/" + id;
  }
  return DEFAULT_ENDPOINTS[id];
}

async function fetchJson(url, signal) {
  const response = await fetch(url, {
    signal,
    mode: "cors",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error("Ontology request failed with HTTP " + response.status);
  }
  return response.json();
}

function skosmosBackend(id, label, description, options) {
  return {
    id,
    label,
    description,
    async search(query, signal) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const params = new URLSearchParams({
        query: options.wildcard ? trimmed + "*" : trimmed,
        lang: configuration.language,
        maxhits: String(configuration.limit)
      });
      if (options.vocab) params.set("vocab", options.vocab);
      const data = await fetchJson(endpointFor(id) + "?" + params, signal);
      return (data.results || []).map(function (item) {
        return {
          uri: item.uri,
          label: item.prefLabel,
          description: item.altLabel || "",
          source: id
        };
      });
    }
  };
}

export const BACKENDS = [
  {
    id: "wikidata",
    label: "Wikidata",
    description: "Wikidata open knowledge base",
    async search(query, signal) {
      if (!query.trim()) return [];
      const params = new URLSearchParams({
        action: "wbsearchentities",
        search: query.trim(),
        language: configuration.language,
        uselang: configuration.language,
        type: "item",
        limit: String(Math.min(configuration.limit, 50)),
        format: "json",
        origin: "*"
      });
      const data = await fetchJson(endpointFor("wikidata") + "?" + params, signal);
      return (data.search || []).map(function (item) {
        return {
          uri: item.concepturi || "https://www.wikidata.org/entity/" + item.id,
          label: item.label,
          description: item.description || "",
          source: "wikidata"
        };
      });
    }
  },
  {
    id: "ols4",
    label: "OLS4",
    description: "EBI Ontology Lookup Service; biomedical ontologies",
    async search(query, signal) {
      if (!query.trim()) return [];
      const params = new URLSearchParams({
        q: query.trim(),
        rows: String(configuration.limit)
      });
      const data = await fetchJson(endpointFor("ols4") + "?" + params, signal);
      return ((data.response && data.response.docs) || []).map(function (item) {
        return {
          uri: item.iri,
          label: item.label,
          description: (item.description && item.description[0]) || "",
          source: "ols4",
          extra: item.ontology_prefix ? { ontology: item.ontology_prefix } : undefined
        };
      });
    }
  },
  skosmosBackend(
    "cessda",
    "CESSDA",
    "CESSDA ELSST thesaurus; social-science concepts",
    { vocab: "elsst" }
  ),
  skosmosBackend(
    "unesco",
    "UNESCO",
    "UNESCO thesaurus; education, science, and culture",
    {}
  ),
  skosmosBackend(
    "agrovoc",
    "AGROVOC",
    "FAO AGROVOC; agriculture, food, and the environment",
    { wildcard: true }
  ),
  {
    id: "nullflavor",
    label: "NullFlavor",
    description: "HL7 v3 codes for missing or exceptional values",
    async search(query) {
      const needle = query.trim().toLowerCase();
      return NULL_FLAVORS
        .filter(function (entry) {
          return !needle || entry.some(function (value) {
            return value.toLowerCase().includes(needle);
          });
        })
        .map(function (entry) {
          return {
            uri: "http://terminology.hl7.org/CodeSystem/v3-NullFlavor#" + entry[0],
            label: entry[0] + " — " + entry[1],
            description: entry[2],
            source: "nullflavor",
            extra: { code: entry[0] }
          };
        });
    }
  }
];

export function configureOntologySearch(options) {
  const next = options || {};
  configuration = {
    endpoints: Object.assign({}, configuration.endpoints, next.endpoints || {}),
    language: next.language || configuration.language,
    limit: Number.isFinite(next.limit) ? Math.max(1, Math.floor(next.limit)) : configuration.limit,
    proxyOnLocalhost: next.proxyOnLocalhost === undefined
      ? configuration.proxyOnLocalhost
      : Boolean(next.proxyOnLocalhost)
  };
}

export function registerOntologyBackend(backend) {
  if (!backend || !backend.id || !backend.label || typeof backend.search !== "function") {
    throw new TypeError("A backend needs id, label, and search(query, signal)");
  }
  const index = BACKENDS.findIndex(function (item) { return item.id === backend.id; });
  if (index >= 0) BACKENDS.splice(index, 1, backend);
  else BACKENDS.push(backend);
}

export async function searchOntology(backendId, query, signal) {
  const backend = BACKENDS.find(function (item) { return item.id === backendId; });
  if (!backend) throw new RangeError("Unknown ontology backend: " + backendId);
  return backend.search(query, signal);
}

export function uriToCode(uri) {
  const obo = uri.match(/\/obo\/([A-Z][A-Z0-9]+)_(\w+)$/);
  if (obo) return obo[1] + ":" + obo[2];
  const snomed = uri.match(/snomed\.info\/sct\/(\d+)/);
  if (snomed) return "SNOMEDCT:" + snomed[1];
  const agrovoc = uri.match(/agrovoc\/c_(\w+)$/);
  if (agrovoc) return "AGROVOC:" + agrovoc[1];
  const last = uri.split(/[/#]/).filter(Boolean).pop();
  if (last && last.length <= 20 && /^[\w:.+\-]+$/.test(last)) return last;
  return undefined;
}

const STYLE = [
  ":host{display:block;color:var(--ontology-color,inherit);font:inherit}",
  "*{box-sizing:border-box}",
  ".search{display:grid;grid-template-columns:minmax(7.5rem,auto) minmax(10rem,1fr);gap:.45rem;align-items:start}",
  "select,input,button{font:inherit;color:inherit}",
  "select,input{width:100%;min-height:2.15rem;border:1px solid var(--ontology-border,#c9cdd4);border-radius:.35rem;background:var(--ontology-background,#fff);padding:.35rem .5rem}",
  "select:focus,input:focus{outline:2px solid var(--ontology-focus,#5b8def);outline-offset:1px}",
  ".input-wrap{position:relative;min-width:0}",
  ".dropdown{position:absolute;z-index:1000;left:0;right:0;top:calc(100% + .2rem);max-height:20rem;overflow:auto;border:1px solid var(--ontology-border,#c9cdd4);border-radius:.35rem;background:var(--ontology-background,#fff);box-shadow:0 .5rem 1.25rem rgba(0,0,0,.16)}",
  ".item{padding:.5rem .65rem;cursor:pointer;border-bottom:1px solid var(--ontology-subtle,#eceef1)}",
  ".item:last-child{border-bottom:0}",
  ".item:hover,.item:focus{background:var(--ontology-hover,#f2f6ff);outline:none}",
  ".label{font-weight:600}",
  ".code{font-size:.78em;color:var(--ontology-muted,#626b78);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}",
  ".description,.status{font-size:.86em;color:var(--ontology-muted,#626b78);margin-top:.18rem}",
  ".status{padding:.55rem .65rem;margin:0}",
  ".chip{display:flex;align-items:center;gap:.35rem;max-width:100%}",
  ".chip a{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--ontology-link,#315fc4)}",
  ".clear{border:0;background:transparent;cursor:pointer;font-size:1.15rem;line-height:1;padding:.15rem .3rem}",
  "@media(max-width:32rem){.search{grid-template-columns:1fr}}"
].join("");

export class OntologySearch extends HTMLElement {
  static get observedAttributes() {
    return ["label", "concept-uri", "concept-label", "concept-description", "backend", "providers"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._backend = this.getAttribute("backend") || "wikidata";
    this._searchText = "";
    this._results = [];
    this._abort = null;
    this._timer = null;
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === "label") {
      this._searchText = "";
      this._results = [];
      this.cancelPending();
    }
    if (name === "backend" && newValue) this._backend = newValue;
    if (this.isConnected) this.render();
  }

  disconnectedCallback() {
    this.cancelPending();
  }

  get availableBackends() {
    const requested = (this.getAttribute("providers") || "")
      .split(",").map(function (value) { return value.trim(); }).filter(Boolean);
    return requested.length
      ? BACKENDS.filter(function (backend) { return requested.includes(backend.id); })
      : BACKENDS;
  }

  resetRoot() {
    this.shadowRoot.replaceChildren();
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.shadowRoot.appendChild(style);
  }

  render() {
    this.resetRoot();
    if (this.getAttribute("concept-uri")) this.renderChip();
    else this.renderSearch();
  }

  renderChip() {
    const uri = this.getAttribute("concept-uri");
    const label = this.getAttribute("concept-label") || "";
    const description = this.getAttribute("concept-description") || "";
    const chip = document.createElement("div");
    chip.className = "chip";
    const link = document.createElement("a");
    link.href = uri;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const code = uriToCode(uri);
    link.textContent = label ? label + (code ? " (" + code + ")" : "") : uri;
    chip.appendChild(link);
    const clear = document.createElement("button");
    clear.className = "clear";
    clear.type = "button";
    clear.title = "Clear mapping";
    clear.setAttribute("aria-label", "Clear mapping");
    clear.textContent = "×";
    clear.addEventListener("click", () => {
      this._results = [];
      this._searchText = "";
      this.dispatchEvent(new CustomEvent("ontology-clear", { bubbles: true, composed: true }));
    });
    chip.appendChild(clear);
    this.shadowRoot.appendChild(chip);
    if (description) {
      const detail = document.createElement("div");
      detail.className = "description";
      detail.textContent = description;
      this.shadowRoot.appendChild(detail);
    }
  }

  renderSearch() {
    const backends = this.availableBackends;
    if (!backends.length) {
      const status = document.createElement("p");
      status.className = "status";
      status.textContent = "No configured ontology providers.";
      this.shadowRoot.appendChild(status);
      return;
    }
    if (!backends.some((item) => item.id === this._backend)) this._backend = backends[0].id;

    const area = document.createElement("div");
    area.className = "search";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Ontology provider");
    backends.forEach((backend) => {
      const option = document.createElement("option");
      option.value = backend.id;
      option.textContent = backend.label;
      option.title = backend.description || "";
      option.selected = backend.id === this._backend;
      select.appendChild(option);
    });
    const inputWrap = document.createElement("div");
    inputWrap.className = "input-wrap";
    const rebuild = () => {
      inputWrap.replaceChildren();
      const backend = backends.find((item) => item.id === this._backend) || backends[0];
      if (backend.id === "nullflavor") this.renderNullFlavor(inputWrap, backend);
      else this.renderRemoteSearch(inputWrap, backend);
    };
    select.addEventListener("change", () => {
      this.cancelPending();
      this._backend = select.value;
      this._results = [];
      this._searchText = "";
      this.setAttribute("backend", this._backend);
      rebuild();
    });
    area.append(select, inputWrap);
    this.shadowRoot.appendChild(area);
    rebuild();
  }

  renderNullFlavor(area, backend) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "NullFlavor code");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— Select NullFlavor code —";
    select.appendChild(placeholder);
    backend.search("").then((results) => {
      results.forEach((result) => {
        const option = document.createElement("option");
        option.value = result.uri;
        option.textContent = ((result.extra && result.extra.code) || "") +
          " — " + (result.label.split(" — ")[1] || result.label);
        option.title = result.description || "";
        select.appendChild(option);
      });
      select.addEventListener("change", () => {
        const result = results.find((item) => item.uri === select.value);
        if (result) {
          select.value = "";
          this.emitSelection(result);
        }
      });
    });
    area.appendChild(select);
  }

  renderRemoteSearch(area, backend) {
    const input = document.createElement("input");
    input.type = "search";
    input.autocomplete = "off";
    input.placeholder = "Search " + backend.label + "…";
    input.setAttribute("aria-label", "Search " + backend.label);
    input.value = this._searchText || this.getAttribute("label") || "";
    const dropdown = document.createElement("div");
    dropdown.className = "dropdown";
    dropdown.setAttribute("role", "listbox");
    dropdown.hidden = true;
    area.append(input, dropdown);

    if (this._results.length) this.renderResults(dropdown, this._results);
    input.addEventListener("input", () => {
      this._searchText = input.value;
      this.queueSearch(backend, input.value, dropdown);
    });
    input.addEventListener("focus", () => {
      if (this._results.length) this.renderResults(dropdown, this._results);
      else if (!this._searchText && input.value.trim()) {
        input.dispatchEvent(new Event("input"));
      }
    });
    input.addEventListener("blur", () => {
      setTimeout(function () { dropdown.hidden = true; }, 180);
    });
  }

  queueSearch(backend, query, dropdown) {
    this.cancelPending();
    const trimmed = query.trim();
    if (!trimmed) {
      this._results = [];
      dropdown.hidden = true;
      return;
    }
    this.showStatus(dropdown, "Searching…");
    this._timer = setTimeout(async () => {
      const abort = new AbortController();
      this._abort = abort;
      try {
        const results = await backend.search(trimmed, abort.signal);
        if (abort.signal.aborted) return;
        this._results = results;
        if (results.length) this.renderResults(dropdown, results);
        else this.showStatus(dropdown, "No results");
      } catch (error) {
        if (error && error.name === "AbortError") return;
        console.warn("[ontology-search] " + backend.id + " search failed", error);
        this.showStatus(dropdown, "Provider unavailable");
      } finally {
        if (this._abort === abort) this._abort = null;
      }
    }, 280);
  }

  showStatus(dropdown, message) {
    dropdown.replaceChildren();
    const status = document.createElement("div");
    status.className = "status";
    status.textContent = message;
    dropdown.appendChild(status);
    dropdown.hidden = false;
  }

  renderResults(dropdown, results) {
    dropdown.replaceChildren();
    results.forEach((result) => {
      const item = document.createElement("div");
      item.className = "item";
      item.tabIndex = 0;
      item.setAttribute("role", "option");
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = result.label;
      const codes = [uriToCode(result.uri), result.extra && result.extra.ontology]
        .filter(Boolean);
      if (codes.length) {
        const code = document.createElement("span");
        code.className = "code";
        code.textContent = " " + codes.map(function (value) { return "[" + value + "]"; }).join(" ");
        label.appendChild(code);
      }
      item.appendChild(label);
      if (result.description) {
        const description = document.createElement("div");
        description.className = "description";
        description.textContent = result.description;
        item.appendChild(description);
      }
      const choose = (event) => {
        event.preventDefault();
        this.emitSelection(result);
        dropdown.hidden = true;
      };
      item.addEventListener("mousedown", choose);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") choose(event);
      });
      dropdown.appendChild(item);
    });
    dropdown.hidden = false;
  }

  emitSelection(result) {
    this._results = [];
    this._searchText = "";
    this.dispatchEvent(new CustomEvent("ontology-select", {
      bubbles: true,
      composed: true,
      detail: result
    }));
  }

  cancelPending() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._abort) {
      this._abort.abort();
      this._abort = null;
    }
  }
}

if (!customElements.get("ontology-search")) {
  customElements.define("ontology-search", OntologySearch);
}
if (!customElements.get("ontology-mapper")) {
  customElements.define("ontology-mapper", class OntologyMapperAlias extends OntologySearch {});
}

const api = Object.freeze({
  BACKENDS,
  configure: configureOntologySearch,
  configureOntologySearch,
  registerBackend: registerOntologyBackend,
  registerOntologyBackend,
  search: searchOntology,
  searchOntology,
  uriToCode
});
globalThis.OntologySearchElement = api;
