// Phase 1 (PR-C, C.3 Q5): programmatic banner-rendering verification
// against the live production session.scope.
//
// The literal Q5 step is a browser reload of /app with EXPECTED_SCOPES
// inflated and reverted. Since this script can't open a browser, it
// runs needsReauth() directly against the dev shop's real session.scope
// — once with the production EXPECTED_SCOPES (banner should be hidden)
// and once with EXPECTED_SCOPES + a fake "read_marketing_events" scope
// (banner should render). Two-direction confirmation, mechanically
// repeatable, no dev-server required.
//
// Usage:
//   npx tsx scripts/test-banner-q5.ts <shopDomain>

import prisma from "../app/db.server";
import { EXPECTED_SCOPES, needsReauth } from "../app/lib/needs-reauth";

async function main(): Promise<void> {
  // eslint-disable-next-line no-undef
  const shop = process.argv[2]?.trim();
  if (!shop) {
    // eslint-disable-next-line no-console
    console.error("usage: npx tsx scripts/test-banner-q5.ts <shopDomain>");
    // eslint-disable-next-line no-undef
    process.exit(2);
  }

  const session = await prisma.session.findFirst({
    where: { shop },
    select: { id: true, shop: true, scope: true },
  });
  if (!session) {
    // eslint-disable-next-line no-console
    console.error(`[test-banner-q5] no session found for ${shop}`);
    // eslint-disable-next-line no-undef
    process.exit(1);
  }

  const inflated = [...EXPECTED_SCOPES, "read_marketing_events"];

  const negativeDirection = needsReauth(session.scope, EXPECTED_SCOPES);
  const positiveDirection = needsReauth(session.scope, inflated);

  const summary = {
    shop,
    sessionId: session.id,
    sessionScope: session.scope,
    expectedScopesProduction: EXPECTED_SCOPES,
    expectedScopesInflated: inflated,
    negativeDirection: {
      needsReauth: negativeDirection,
      expected: false,
      pass: negativeDirection === false,
    },
    positiveDirection: {
      needsReauth: positiveDirection,
      expected: true,
      pass: positiveDirection === true,
    },
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));

  const ok =
    summary.negativeDirection.pass && summary.positiveDirection.pass;
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error("[test-banner-q5] FAIL");
    // eslint-disable-next-line no-undef
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("[test-banner-q5] PASS");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error("[test-banner-q5] fatal:", err);
    await prisma.$disconnect().catch(() => {});
    // eslint-disable-next-line no-undef
    process.exit(1);
  });
