/**
 * The guide module as the API consumes it (bundled by
 * scripts/build-coop-adapter.mjs into ato-api's plaza-guide.generated.js):
 * the rule-based conversation, used verbatim as the API's fallback, and the
 * knowledge the model is given.
 */
export * from "./nagi";
export * from "./knowledge";
export * from "./residents";
