// Phase 1 (PR-C, C.3): scope-mismatch detector for the embedded admin
// shell.
//
// Shopify session.scope is a comma-separated string of the scopes the
// merchant currently has granted. EXPECTED_SCOPES is the set the app
// declares in shopify.app.toml. If any expected scope is missing from
// the session (after applying Shopify's implicit "write_X grants
// read_X" rule), the merchant has not yet re-authorized after a scope
// change — render a banner asking them to reinstall.
//
// Implication rule: when EXPECTED_SCOPES includes "read_products" and
// the merchant granted "write_products", the read is satisfied at
// runtime even though the literal "read_products" string is absent
// from session.scope. Shopify's permission model is hierarchical
// (write ⊇ read) but it persists only what the merchant literally
// approved in the consent screen, so a strict literal check would
// produce false positives. The expansion here adds the implied read
// only on the GRANTED side; EXPECTED_SCOPES still lists each scope
// explicitly so future maintainers see what the app actually needs.
//
// Rules:
//   - true if any expectedScope is NOT in expanded session
//   - false if all expected are present (literal or implied)
//   - true if session is null/undefined/empty
//   - extras in session do NOT trigger re-auth
//   - empty expected array means "no requirements" → false

export const EXPECTED_SCOPES: ReadonlyArray<string> = [
  "read_products",
  "write_products",
  "read_inventory",
  "read_metaobjects",
  "read_metaobject_definitions",
  "read_customers",
  "write_customers",
  "read_orders",
];

function expandGranted(sessionScope: string): Set<string> {
  const granted = new Set<string>();
  for (const raw of sessionScope.split(",")) {
    const s = raw.trim();
    if (!s) continue;
    granted.add(s);
    if (s.startsWith("write_")) {
      granted.add("read_" + s.slice("write_".length));
    }
  }
  return granted;
}

export function needsReauth(
  sessionScope: string | null | undefined,
  expectedScopes: ReadonlyArray<string> = EXPECTED_SCOPES,
): boolean {
  if (expectedScopes.length === 0) return false;
  if (sessionScope === null || sessionScope === undefined || sessionScope === "") {
    return true;
  }
  const granted = expandGranted(sessionScope);
  for (const scope of expectedScopes) {
    if (!granted.has(scope)) return true;
  }
  return false;
}
