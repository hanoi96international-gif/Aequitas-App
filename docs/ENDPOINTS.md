# Which backend the app talks to

**As of 21 Nov 2026.**

```
API_BASE = https://aequitas.digital/api     (default, lib/config.ts)
WEBAPP   = https://aequitas.digital
RPC_URL  = https://aequitas.digital/rpc
```

`aequitas.digital` is C1, the only server of the network today (netcup). Each
value can be overridden at build time with an `EXPO_PUBLIC_*` repository
variable; only `https://` counts (plain `http` only for local addresses in a
development build).

## The biometric coordinator

`EXPO_PUBLIC_COORDINATOR_BASE` (plus optional `EXPO_PUBLIC_COORDINATOR_FALLBACKS`)
names the coordinator; `EXPO_PUBLIC_BIOMETRIC_ENABLED=true` turns the face
check on. Without a coordinator the app does not offer the biometric path
(`lib/config.ts`, `identity.biometricDisabled`).

## Hosts that never count

`lib/config.ts` (`ABGESCHALTET`) ignores these, whatever a build variable says,
including subdomains:

- `proof2.aequitas.digital`, `194.163.188.71` (C2, switched off 3 Oct 2026),
  `173.249.37.118` (the first Contabo1, switched off 24 Sep 2026) -- their
  addresses have been reassigned;
- `railway.app`, `rlwy.net`, `railway.com` -- Railway hosts nothing of Aequitas
  since 14 Sep 2026, and anyone can claim those names.

`build-apk.yml` checks the same before building: every `EXPO_PUBLIC_*` URL must
not be a Railway host, must answer `/health` with 200 and must not return HTML.

History (Contabo1 IPs, the domain before 18 Aug 2026, the Railway coordinator)
is in the git log of this file.
