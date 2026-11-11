'use strict';
// Ersatz fuer decode-uri-component 0.2.2 (von query-string 7 / expo-router
// benutzt, um Deep-Links zu lesen). 0.2.2 hat zwei Befunde
// (GHSA-vcc3-ghjq-m6fr, GHSA-qr28-fpjm-wq7f): kaputte Prozent-Folgen kosten
// exponentiell bzw. quadratisch viel Zeit -- ein praeparierter Link haengt
// die App. Die behobene Version 0.5.1 ist nur noch ESM und passt nicht zu
// query-string 7. Darum hier dieselbe Schnittstelle (CommonJS, eine
// Funktion), aber in linearer Zeit:
//   - '+' wird zu ' ', dann decodeURIComponent.
//   - Scheitert das, wird jede %XX-Folge von links nach rechts gelesen: am
//     Leitbyte steht, wie viele Bytes zu einem UTF-8-Zeichen gehoeren; passen
//     sie, wird das Zeichen dekodiert, sonst bleibt das eine %XX stehen.
//   - Jedes %XX wird hoechstens einmal angefasst.
var EINZEL = /%[0-9a-f]{2}/gi;

function laengeAusLeitbyte(b) {
  if (b < 0x80) return 1;
  if (b >= 0xc2 && b <= 0xdf) return 2;
  if (b >= 0xe0 && b <= 0xef) return 3;
  if (b >= 0xf0 && b <= 0xf4) return 4;
  return 0;
}

function folgeLesen(folge) {
  // folge: ein oder mehrere aufeinanderfolgende %XX
  var teile = folge.match(EINZEL) || [];
  var aus = '';
  var i = 0;
  while (i < teile.length) {
    var n = laengeAusLeitbyte(parseInt(teile[i].slice(1), 16));
    if (n > 0 && i + n <= teile.length) {
      try {
        aus += decodeURIComponent(teile.slice(i, i + n).join(''));
        i += n;
        continue;
      } catch (e) {
        // ungueltige Folge: unten als Text
      }
    }
    aus += teile[i];
    i += 1;
  }
  return aus;
}

module.exports = function (encodedURI) {
  if (typeof encodedURI !== 'string') {
    throw new TypeError('Expected `encodedURI` to be of type `string`, got `' + typeof encodedURI + '`');
  }
  var s = encodedURI.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(s);
  } catch (err) {
    return s.replace(/(?:%[0-9a-f]{2})+/gi, folgeLesen);
  }
};
