# Which backend the app talks to

## Right now (until 2026-08-18)

```
API_BASE = http://173.249.37.118:8080/api     ← Contabo1, the primary validator
WEBAPP   = http://173.249.37.118:8080
RPC_URL  = http://173.249.37.118:8080/rpc
android.usesCleartextTraffic = true            ← required for plain HTTP
```

**Why not the domain.** `aequitas.digital` does not belong to this project yet;
it arrives on 2026-08-18. Measured on 2026-08-16, that name resolves to a host
serving a *different* chain — height ~50, 0 humans, an unknown node id — while
the real network is past 3.8 million blocks with 15 humans. An app pointed there
shows an empty chain, a zero balance and a zero supply, and any registration it
managed to complete would land on a chain nobody else follows. That is worse
than an app that plainly does not connect.

**Why cleartext had to be enabled.** Android has blocked plain HTTP by default
since API 28. Without `usesCleartextTraffic`, every request to the IP endpoint
fails silently and the app just shows nothing — which is exactly how this would
have been discovered on launch day instead of now.

## On 2026-08-18, after the domain switch

Once `Serve aequitas.digital from Contabo1` (chain repo) has issued the
certificate and `https://aequitas.digital/api/status` reports the real chain:

1. Put the three `https://aequitas.digital` defaults back in `lib/config.ts`.
2. Remove `android.usesCleartextTraffic` from `app.json`.
3. Rebuild and re-publish the APK.

Both halves matter. Leaving cleartext enabled in a shipped app is a downgrade
nobody would notice afterwards.

`lib/__tests__/config.test.ts` enforces this: it asserts the IP endpoints before
the handover date and the https ones from 2026-08-18 onward, and it fails if
cleartext is still enabled after that date. A comment asking someone to remember
is a comment nobody reads on launch day; a red CI run is not.

## The biometric coordinator

`EXPO_PUBLIC_BIOMETRIC_ENABLED` is **false**, and
`EXPO_PUBLIC_COORDINATOR_BASE` has been removed from the repository variables.

It used to be `true`, pointing at `coordinator-production-dcd1.up.railway.app` —
a host decommissioned with the rest of Railway on 2026-08-14. So the shipped app
offered a biometric registration flow that could not complete. Offering a dead
path is worse than not offering it.

**This has a consequence worth stating plainly.** With the coordinator off, the
app's identity comes from `getDeviceIdentity()`, which hashes a random 32-byte
secret generated per device (`lib/identity.ts`). The chain then guarantees that
each resulting nullifier can register exactly once, and it does so rigorously —
but the thing being made unique is a *device secret*, not a person. The same
human on a second phone, or after a reinstall that clears the secret, is a new
identity and receives another 1,000 AEQ grant.

"One human, one registration" needs the coordinator running somewhere. Both it
and the matching service are containerised (`aequitas-biometric-beta/`), so this
is a deployment, not a rewrite — but it is a real one: FastAPI, Redis, the
matching models, Play Integrity credentials, and the GDPR review that was
deliberately left open before any of it goes live.
