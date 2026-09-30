import { useEffect, useState } from 'react';

import { availableProtection, type Protection } from '@/src/crypto/vault';

/** Welcher Schutz auf diesem Geraet moeglich ist ('pin' = App-PIN noetig). null = wird noch ermittelt. */
export function useProtection(): Protection | null {
  const [p, setP] = useState<Protection | null>(null);
  useEffect(() => {
    let alive = true;
    availableProtection()
      // Nicht ermittelbar: App-PIN verlangen (fail-closed, nie "ohne Schutz").
      .catch((): Protection => 'pin')
      .then((v) => alive && setP(v));
    return () => {
      alive = false;
    };
  }, []);
  return p;
}
