// Laenderauswahl fuer die Altersangabe (altersregel.ts): statt eines Codes
// mit zwei Buchstaben waehlt man das Land aus einer Liste, und der Text nennt
// das Mindestalter, das dort gilt (Wunsch des Betreibers vom 15.11.2026).
//
// Namen: Deutsch und Englisch hier fest (ISO 3166-1); fuer die anderen
// Sprachen der App der Name aus Intl.DisplayNames, wenn die Laufzeit ihn
// kennt, sonst der englische. Gespeichert wird wie bisher nichts.

import { GRUNDALTER, LAENDER, REGIONEN } from './altersregel';

// ISO 3166-1 alpha-2 | Englisch | Deutsch
const ROH = `AD|Andorra|Andorra
AE|United Arab Emirates|Vereinigte Arabische Emirate
AF|Afghanistan|Afghanistan
AG|Antigua and Barbuda|Antigua und Barbuda
AI|Anguilla|Anguilla
AL|Albania|Albanien
AM|Armenia|Armenien
AO|Angola|Angola
AQ|Antarctica|Antarktis
AR|Argentina|Argentinien
AS|American Samoa|Amerikanisch-Samoa
AT|Austria|Österreich
AU|Australia|Australien
AW|Aruba|Aruba
AX|Åland Islands|Ålandinseln
AZ|Azerbaijan|Aserbaidschan
BA|Bosnia and Herzegovina|Bosnien und Herzegowina
BB|Barbados|Barbados
BD|Bangladesh|Bangladesch
BE|Belgium|Belgien
BF|Burkina Faso|Burkina Faso
BG|Bulgaria|Bulgarien
BH|Bahrain|Bahrain
BI|Burundi|Burundi
BJ|Benin|Benin
BL|Saint Barthélemy|St. Barthélemy
BM|Bermuda|Bermuda
BN|Brunei|Brunei Darussalam
BO|Bolivia|Bolivien
BQ|Caribbean Netherlands|Karibische Niederlande
BR|Brazil|Brasilien
BS|Bahamas|Bahamas
BT|Bhutan|Bhutan
BV|Bouvet Island|Bouvetinsel
BW|Botswana|Botsuana
BY|Belarus|Belarus
BZ|Belize|Belize
CA|Canada|Kanada
CC|Cocos (Keeling) Islands|Kokosinseln
CD|Congo (DRC)|Kongo (Demokratische Republik)
CF|Central African Republic|Zentralafrikanische Republik
CG|Congo (Republic)|Kongo (Republik)
CH|Switzerland|Schweiz
CI|Côte d’Ivoire|Côte d’Ivoire
CK|Cook Islands|Cookinseln
CL|Chile|Chile
CM|Cameroon|Kamerun
CN|China|China
CO|Colombia|Kolumbien
CR|Costa Rica|Costa Rica
CU|Cuba|Kuba
CV|Cape Verde|Cabo Verde
CW|Curaçao|Curaçao
CX|Christmas Island|Weihnachtsinsel
CY|Cyprus|Zypern
CZ|Czechia|Tschechien
DE|Germany|Deutschland
DJ|Djibouti|Dschibuti
DK|Denmark|Dänemark
DM|Dominica|Dominica
DO|Dominican Republic|Dominikanische Republik
DZ|Algeria|Algerien
EC|Ecuador|Ecuador
EE|Estonia|Estland
EG|Egypt|Ägypten
EH|Western Sahara|Westsahara
ER|Eritrea|Eritrea
ES|Spain|Spanien
ET|Ethiopia|Äthiopien
FI|Finland|Finnland
FJ|Fiji|Fidschi
FK|Falkland Islands|Falklandinseln
FM|Micronesia|Mikronesien
FO|Faroe Islands|Färöer
FR|France|Frankreich
GA|Gabon|Gabun
GB|United Kingdom|Vereinigtes Königreich
GD|Grenada|Grenada
GE|Georgia|Georgien
GF|French Guiana|Französisch-Guayana
GG|Guernsey|Guernsey
GH|Ghana|Ghana
GI|Gibraltar|Gibraltar
GL|Greenland|Grönland
GM|Gambia|Gambia
GN|Guinea|Guinea
GP|Guadeloupe|Guadeloupe
GQ|Equatorial Guinea|Äquatorialguinea
GR|Greece|Griechenland
GS|South Georgia & South Sandwich Islands|Südgeorgien und die Südlichen Sandwichinseln
GT|Guatemala|Guatemala
GU|Guam|Guam
GW|Guinea-Bissau|Guinea-Bissau
GY|Guyana|Guyana
HK|Hong Kong|Hongkong
HM|Heard & McDonald Islands|Heard und McDonaldinseln
HN|Honduras|Honduras
HR|Croatia|Kroatien
HT|Haiti|Haiti
HU|Hungary|Ungarn
ID|Indonesia|Indonesien
IE|Ireland|Irland
IL|Israel|Israel
IM|Isle of Man|Isle of Man
IN|India|Indien
IO|British Indian Ocean Territory|Britisches Territorium im Indischen Ozean
IQ|Iraq|Irak
IR|Iran|Iran
IS|Iceland|Island
IT|Italy|Italien
JE|Jersey|Jersey
JM|Jamaica|Jamaika
JO|Jordan|Jordanien
JP|Japan|Japan
KE|Kenya|Kenia
KG|Kyrgyzstan|Kirgisistan
KH|Cambodia|Kambodscha
KI|Kiribati|Kiribati
KM|Comoros|Komoren
KN|St. Kitts & Nevis|St. Kitts und Nevis
KP|North Korea|Nordkorea
KR|South Korea|Südkorea
KW|Kuwait|Kuwait
KY|Cayman Islands|Kaimaninseln
KZ|Kazakhstan|Kasachstan
LA|Laos|Laos
LB|Lebanon|Libanon
LC|St. Lucia|St. Lucia
LI|Liechtenstein|Liechtenstein
LK|Sri Lanka|Sri Lanka
LR|Liberia|Liberia
LS|Lesotho|Lesotho
LT|Lithuania|Litauen
LU|Luxembourg|Luxemburg
LV|Latvia|Lettland
LY|Libya|Libyen
MA|Morocco|Marokko
MC|Monaco|Monaco
MD|Moldova|Republik Moldau
ME|Montenegro|Montenegro
MF|St. Martin|St. Martin
MG|Madagascar|Madagaskar
MH|Marshall Islands|Marshallinseln
MK|North Macedonia|Nordmazedonien
ML|Mali|Mali
MM|Myanmar|Myanmar
MN|Mongolia|Mongolei
MO|Macao|Macau
MP|Northern Mariana Islands|Nördliche Marianen
MQ|Martinique|Martinique
MR|Mauritania|Mauretanien
MS|Montserrat|Montserrat
MT|Malta|Malta
MU|Mauritius|Mauritius
MV|Maldives|Malediven
MW|Malawi|Malawi
MX|Mexico|Mexiko
MY|Malaysia|Malaysia
MZ|Mozambique|Mosambik
NA|Namibia|Namibia
NC|New Caledonia|Neukaledonien
NE|Niger|Niger
NF|Norfolk Island|Norfolkinsel
NG|Nigeria|Nigeria
NI|Nicaragua|Nicaragua
NL|Netherlands|Niederlande
NO|Norway|Norwegen
NP|Nepal|Nepal
NR|Nauru|Nauru
NU|Niue|Niue
NZ|New Zealand|Neuseeland
OM|Oman|Oman
PA|Panama|Panama
PE|Peru|Peru
PF|French Polynesia|Französisch-Polynesien
PG|Papua New Guinea|Papua-Neuguinea
PH|Philippines|Philippinen
PK|Pakistan|Pakistan
PL|Poland|Polen
PM|St. Pierre & Miquelon|St. Pierre und Miquelon
PN|Pitcairn Islands|Pitcairninseln
PR|Puerto Rico|Puerto Rico
PS|Palestine|Palästina
PT|Portugal|Portugal
PW|Palau|Palau
PY|Paraguay|Paraguay
QA|Qatar|Katar
RE|Réunion|Réunion
RO|Romania|Rumänien
RS|Serbia|Serbien
RU|Russia|Russland
RW|Rwanda|Ruanda
SA|Saudi Arabia|Saudi-Arabien
SB|Solomon Islands|Salomonen
SC|Seychelles|Seychellen
SD|Sudan|Sudan
SE|Sweden|Schweden
SG|Singapore|Singapur
SH|St. Helena|St. Helena
SI|Slovenia|Slowenien
SJ|Svalbard & Jan Mayen|Spitzbergen und Jan Mayen
SK|Slovakia|Slowakei
SL|Sierra Leone|Sierra Leone
SM|San Marino|San Marino
SN|Senegal|Senegal
SO|Somalia|Somalia
SR|Suriname|Suriname
SS|South Sudan|Südsudan
ST|São Tomé & Príncipe|São Tomé und Príncipe
SV|El Salvador|El Salvador
SX|Sint Maarten|Sint Maarten
SY|Syria|Syrien
SZ|Eswatini|Eswatini
TC|Turks & Caicos Islands|Turks- und Caicosinseln
TD|Chad|Tschad
TF|French Southern Territories|Französische Süd- und Antarktisgebiete
TG|Togo|Togo
TH|Thailand|Thailand
TJ|Tajikistan|Tadschikistan
TK|Tokelau|Tokelau
TL|Timor-Leste|Timor-Leste
TM|Turkmenistan|Turkmenistan
TN|Tunisia|Tunesien
TO|Tonga|Tonga
TR|Türkiye|Türkei
TT|Trinidad & Tobago|Trinidad und Tobago
TV|Tuvalu|Tuvalu
TW|Taiwan|Taiwan
TZ|Tanzania|Tansania
UA|Ukraine|Ukraine
UG|Uganda|Uganda
UM|U.S. Outlying Islands|Amerikanische Überseeinseln
US|United States|Vereinigte Staaten
UY|Uruguay|Uruguay
UZ|Uzbekistan|Usbekistan
VA|Vatican City|Vatikanstadt
VC|St. Vincent & Grenadines|St. Vincent und die Grenadinen
VE|Venezuela|Venezuela
VG|British Virgin Islands|Britische Jungferninseln
VI|U.S. Virgin Islands|Amerikanische Jungferninseln
VN|Vietnam|Vietnam
VU|Vanuatu|Vanuatu
WF|Wallis & Futuna|Wallis und Futuna
WS|Samoa|Samoa
XK|Kosovo|Kosovo
YE|Yemen|Jemen
YT|Mayotte|Mayotte
ZA|South Africa|Südafrika
ZM|Zambia|Sambia
ZW|Zimbabwe|Simbabwe`;

// Bundesstaaten/Provinzen, deren Mindestalter abweichen kann (altersregel.ts
// REGIONEN). Eigennamen -- in allen Sprachen gleich.
const US_ROH = `AL|Alabama
AK|Alaska
AZ|Arizona
AR|Arkansas
CA|California
CO|Colorado
CT|Connecticut
DE|Delaware
DC|District of Columbia
FL|Florida
GA|Georgia
HI|Hawaii
ID|Idaho
IL|Illinois
IN|Indiana
IA|Iowa
KS|Kansas
KY|Kentucky
LA|Louisiana
ME|Maine
MD|Maryland
MA|Massachusetts
MI|Michigan
MN|Minnesota
MS|Mississippi
MO|Missouri
MT|Montana
NE|Nebraska
NV|Nevada
NH|New Hampshire
NJ|New Jersey
NM|New Mexico
NY|New York
NC|North Carolina
ND|North Dakota
OH|Ohio
OK|Oklahoma
OR|Oregon
PA|Pennsylvania
RI|Rhode Island
SC|South Carolina
SD|South Dakota
TN|Tennessee
TX|Texas
UT|Utah
VT|Vermont
VA|Virginia
WA|Washington
WV|West Virginia
WI|Wisconsin
WY|Wyoming
AS|American Samoa
GU|Guam
MP|Northern Mariana Islands
PR|Puerto Rico
VI|U.S. Virgin Islands`;

const CA_ROH = `AB|Alberta
BC|British Columbia
MB|Manitoba
NB|New Brunswick
NL|Newfoundland and Labrador
NS|Nova Scotia
NT|Northwest Territories
NU|Nunavut
ON|Ontario
PE|Prince Edward Island
QC|Québec
SK|Saskatchewan
YT|Yukon`;

export interface Eintrag {
  code: string;
  name: string;
}

interface Land {
  code: string;
  en: string;
  de: string;
}

function zeilen(roh: string): string[][] {
  return roh.split('\n').map((z) => z.split('|'));
}

export const LAENDER_LISTE: readonly Land[] = zeilen(ROH).map(([code, en, de]) => ({ code, en, de }));

export const REGIONEN_LISTE: Readonly<Record<string, readonly Eintrag[]>> = {
  US: zeilen(US_ROH).map(([code, name]) => ({ code, name })),
  CA: zeilen(CA_ROH).map(([code, name]) => ({ code, name })),
};

/** Laender, deren Mindestalter von Bundesstaat/Provinz abhaengt. */
export function hatRegionen(land: string): boolean {
  return REGIONEN_LISTE[land.toUpperCase()] !== undefined;
}

/** Flaggen-Emoji aus dem Code (zwei Regional-Indicator-Zeichen). */
export function flagge(code: string): string {
  const c = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65, 0x1f1e6 + c.charCodeAt(1) - 65);
}

const namenCache: Record<string, Intl.DisplayNames | null> = {};

function systemName(code: string, sprache: string): string | undefined {
  if (!(sprache in namenCache)) {
    try {
      // Hermes kennt Intl.DisplayNames nicht ueberall -- dann englisch.
      const DN = (Intl as unknown as { DisplayNames?: typeof Intl.DisplayNames }).DisplayNames;
      namenCache[sprache] = DN ? new DN([sprache], { type: 'region' }) : null;
    } catch {
      namenCache[sprache] = null;
    }
  }
  const dn = namenCache[sprache];
  if (!dn) return undefined;
  try {
    const n = dn.of(code);
    return n && n !== code ? n : undefined;
  } catch {
    return undefined;
  }
}

/** Name eines Landes in der Sprache der App. Unbekannter Code: der Code. */
export function landName(code: string, sprache: string): string {
  const c = code.toUpperCase();
  const l = LAENDER_LISTE.find((x) => x.code === c);
  if (!l) return c;
  if (sprache === 'de') return l.de;
  if (sprache === 'en') return l.en;
  return systemName(c, sprache) ?? l.en;
}

/** Alle Laender, nach Namen in der Sprache der App sortiert. */
export function laenderFuer(sprache: string): Eintrag[] {
  const out = LAENDER_LISTE.map((l) => ({ code: l.code, name: landName(l.code, sprache) }));
  out.sort((a, b) => a.name.localeCompare(b.name, sprache));
  return out;
}

/** Suche ueber Name (auch englisch/deutsch) und Code, ohne Akzente. */
export function passt(e: Eintrag, suche: string): boolean {
  const s = ohneAkzent(suche.trim().toLowerCase());
  if (!s) return true;
  const l = LAENDER_LISTE.find((x) => x.code === e.code);
  const namen = [e.name, e.code, l?.en ?? '', l?.de ?? ''];
  return namen.some((n) => ohneAkzent(n.toLowerCase()).includes(s));
}

function ohneAkzent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Was fuer dieses Land gilt -- fuer den Text unter der Auswahl.
 *  - 'fest': ein Mindestalter fuer das ganze Land (oder den gewaehlten
 *    Bundesstaat).
 *  - 'region': haengt vom Bundesstaat/der Provinz ab, noch keiner gewaehlt.
 */
export type Regel =
  | { art: 'keins' }
  | { art: 'fest'; n: number }
  | { art: 'region'; min: number; max: number };

export function regelFuer(land: string, region?: string): Regel {
  const l = land.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(l)) return { art: 'keins' };
  const teile = REGIONEN[l];
  if (teile && REGIONEN_LISTE[l]) {
    const r = region?.trim().toUpperCase();
    if (r) return { art: 'fest', n: teile[r] ?? GRUNDALTER };
    const werte = [GRUNDALTER, ...Object.values(teile)];
    return { art: 'region', min: Math.min(...werte), max: Math.max(...werte) };
  }
  return { art: 'fest', n: LAENDER[l] ?? GRUNDALTER };
}

