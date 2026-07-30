import { identityFromBioHash } from '../identity';

// BN254 scalar field, the same constant three codebases have to agree on:
// coordinator/app/bio_hash.py, lib/identity.ts, and BioVerifierV3.sol.
const FIELD_SIZE = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

describe('attestation pipeline invariant', () => {
  // The coordinator signs domain|bio_hash|wallet|issued_at over the bio_hash
  // string it returns. The app does NOT forward that string to /prove -- it
  // forwards identityFromBioHash(bio_hash).bio. The proof server rebuilds the
  // signed message from whatever arrives as `bio`. So the whole attestation
  // chain rests on those two being byte-identical, and nothing in the type
  // system says they must be.
  //
  // They are identical today only because coordinator/app/bio_hash.py's
  // new_scalar() returns str(secrets.randbelow(FIELD_SIZE)) -- canonical
  // decimal, no prefix, no padding, already below the field size, so the
  // reduction is a no-op and toString() reproduces the input exactly.
  //
  // If that ever changes to hex, or to a zero-padded form, every attestation
  // silently fails to verify and the failure reads as a signature bug.
  it('leaves a canonical decimal bio_hash byte-identical through identityFromBioHash', () => {
    const samples = [
      '0',
      '1',
      '12345678901234567890',
      // Shape of a real new_scalar() output: full-width, below FIELD_SIZE.
      '19527982441424667174939202074434487354654832651438371806132585513518990382012',
      (FIELD_SIZE - 1n).toString(),
    ];
    for (const bioHash of samples) {
      expect(identityFromBioHash(bioHash).bio).toBe(bioHash);
    }
  });

  it('does NOT round-trip a hex bio_hash — the form the coordinator must never emit', () => {
    // Documents the failure mode rather than asserting correctness: 0x2a
    // becomes "42", the coordinator would have signed "0x2a", and the
    // signature check fails with a message about an untrusted key that says
    // nothing about formatting.
    expect(identityFromBioHash('0x2a').bio).toBe('42');
    expect(identityFromBioHash('0x2a').bio).not.toBe('0x2a');
  });

  it('reduces a value at or above FIELD_SIZE, which also breaks the signature', () => {
    // new_scalar() cannot produce this (randbelow is exclusive), so reaching
    // it means the coordinator changed. Pinned so that change is loud.
    expect(identityFromBioHash(FIELD_SIZE.toString()).bio).toBe('0');
  });
});
