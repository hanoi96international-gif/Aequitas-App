// Offene Systemabfrage (Face ID, Fingerabdruck, Geraete-PIN).
//
// iOS meldet waehrend dieser Abfrage AppState 'inactive'. Die Sitzung sperrt
// bei 'inactive' (App-Umschalter, Kontrollzentrum) -- ohne diesen Zaehler
// wuerde sie sich also mitten im Entsperren oder Signieren selbst sperren.
// Nur Abfragen, die der Tresor selbst oeffnet, zaehlen hier; 'background'
// sperrt immer, auch waehrend einer offenen Abfrage.

let open = 0;

export async function withSystemPrompt<T>(fn: () => Promise<T>): Promise<T> {
  open++;
  try {
    return await fn();
  } finally {
    open--;
  }
}

export function systemPromptOpen(): boolean {
  return open > 0;
}
