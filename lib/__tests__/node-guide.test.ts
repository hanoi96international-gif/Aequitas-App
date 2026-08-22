import fs from 'fs';
import path from 'path';
import { RESOURCES, LOCALES } from '../i18n';

// lib/config.ts's own top comment ("TEMPORARY — REVERT ON 2026-08-18") and
// lib/__tests__/config.test.ts's "defaults to the endpoint that actually
// serves this chain" / "Decommissioned-host guard" tests establish why: as
// of 2026-08-16, aequitas.digital does not belong to this project yet and
// resolves to a host serving a DIFFERENT, near-empty chain (height ~50, 0
// humans) while the real network is past 3.8 million blocks. config.ts was
// fixed to point the app's OWN API_BASE/WEBAPP/RPC_URL at Contabo1 by IP
// until the 2026-08-18 domain handover.
//
// app/(tabs)/run-node.tsx is a separate, hand-written copy of onboarding
// guidance for prospective node operators -- a copy-paste Docker command,
// plus a "KEY ENVIRONMENT VARIABLES" description translated into all 12
// locales -- that was not touched by that fix. It still tells a node
// operator to set PRIMARY_NODE_URL and BOOTSTRAP_SNAPSHOT_URL to
// https://aequitas.digital, which today would bootstrap their node against
// the wrong chain -- exactly the failure mode config.ts's own fix exists to
// prevent for the app itself, just missed here.
//
// These tests currently FAIL (in all 12 locales for the second one). They
// are meant to: they prove the guide still points a real, live-in-front-
// of-a-user action (copying a shell command; reading what to type into an
// env var) at the wrong chain, right now, before 2026-08-18. Both mirror
// config.test.ts's own DOMAIN_HANDOVER gating -- aequitas.digital is
// correct again after the handover, so neither assertion applies past it.
describe('run-node guide text does not point a node operator at the wrong chain', () => {
  const DOMAIN_HANDOVER = new Date('2026-08-18T00:00:00Z');

  it('the copy-paste Docker command does not hardcode aequitas.digital', () => {
    if (new Date() >= DOMAIN_HANDOVER) return; // aequitas.digital is correct after the handover
    const runNodeSource = fs.readFileSync(
      path.join(__dirname, '../../app/(tabs)/run-node.tsx'),
      'utf8'
    );
    expect(runNodeSource).not.toMatch(/aequitas\.digital/);
  });

  it.each(LOCALES)(
    "the %s PRIMARY_NODE_URL/BOOTSTRAP_SNAPSHOT_URL env-var descriptions don't hardcode aequitas.digital",
    (locale) => {
      if (new Date() >= DOMAIN_HANDOVER) return; // aequitas.digital is correct after the handover
      const node = RESOURCES[locale].node;
      expect(node.envPrimaryUrl).not.toMatch(/aequitas\.digital/);
      expect(node.envBootstrapSnapshot).not.toMatch(/aequitas\.digital/);
    }
  );
});
