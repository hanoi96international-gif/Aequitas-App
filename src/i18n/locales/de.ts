// Quelle aller Texte des Neubaus. Neue Schluessel zuerst hier, dann in en.ts.
// Pluralformen: { one, other } -- t(key, { count }).
const de = {
  common: {
    appName: 'Aequitas',
    continue: 'Weiter',
    cancel: 'Abbrechen',
    confirm: 'Bestätigen',
    done: 'Fertig',
    retry: 'Erneut versuchen',
    close: 'Schließen',
    copy: 'Kopieren',
    copied: 'Kopiert',
    share: 'Teilen',
    loading: 'Wird geladen …',
    unknown: 'Unbekannt',
  },
  errors: {
    network: {
      title: 'Keine Verbindung',
      message: 'Prüfe deine Internetverbindung. Wir versuchen es automatisch erneut.',
    },
    timeout: {
      title: 'Zeitüberschreitung',
      message: 'Der Server hat nicht rechtzeitig geantwortet.',
    },
    rateLimited: {
      title: 'Kurz warten',
      message: 'Viele Anfragen gleichzeitig. Nächster Versuch in {seconds} s.',
    },
    unavailable: {
      title: 'Vorübergehend nicht verfügbar',
      message: 'Das Netz ist gerade ausgelastet. Bitte gleich noch einmal.',
    },
    rejected: {
      title: 'Abgelehnt',
      message: '{reason}',
    },
    invalidResponse: {
      title: 'Unerwartete Antwort',
      message: 'Der Server hat etwas geschickt, das die App nicht versteht.',
    },
    chainMismatch: {
      title: 'Falsches Netz',
      message: 'Der Knoten gehört nicht zum Aequitas-Netz. Aus Sicherheitsgründen wird nichts signiert.',
    },
    clockSkew: {
      title: 'Uhrzeit weicht ab',
      message: 'Die Uhr deines Geräts weicht um {seconds} s ab. Bitte automatische Uhrzeit aktivieren.',
    },
    netzGewechselt: {
      title: 'Das Netz wurde neu gestartet',
      message: 'Aequitas ist neu gestartet. Frühere Registrierungen und Guthaben gelten nicht mehr – bitte registriere dich erneut.',
    },
  },
  offline: {
    banner: 'Offline – angezeigt wird der letzte bekannte Stand ({time}).',
  },
  time: {
    secondsAgo: { one: 'vor {count} Sekunde', other: 'vor {count} Sekunden' },
    minutesAgo: { one: 'vor {count} Minute', other: 'vor {count} Minuten' },
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Catalog = Widen<typeof de>;
export default de as Catalog;
