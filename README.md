# SDM630-Emulation für den Growatt

Dieser Flow läuft in der **bestehenden** Node-RED-Instanz. Er liest den Zählerblock des Huawei SUN2000-8KTL-M1 (DTSU666-H) über den Modbus-Client, der dort schon verbunden ist, und beantwortet den Growatt MOD 5000TL3-HU als Eastron SDM630.

Es wird keine zweite Node-RED-Instanz gestartet und keine zweite TCP-Verbindung zum Huawei geöffnet. Der SUN2000 nimmt nur eine Modbus-TCP-Verbindung gleichzeitig an.

## Import

Voraussetzung ist `node-red-contrib-modbus`, das in der Instanz bereits läuft. Die Anzeige braucht zusätzlich `node-red-dashboard`.

1. In Node-RED **Import** wählen und [flows/sdm630.json](flows/sdm630.json) einfügen. Der Flow enthält keine Dashboard-Basis. Theme, Titel und Raster der bestehenden Anzeige bleiben unverändert. Der Reiter SDM630 erscheint unter `/ui` hinten.

Wurde eine ältere Fassung importiert und die Oberfläche sieht anders aus: Menü, Konfigurationsknoten, den Knoten `ui_base` mit dem Site-Namen **SDM630 Emulation** löschen und deployen. In der Dashboard-Seitenleiste den Reiter SDM630 nach hinten ziehen. Den Flow nicht noch einmal vollständig importieren, sonst liegen die Knoten doppelt.
2. Die neue Lesung **Huawei Zähler 37100** ist deaktiviert und zeigt auf den Client „Platzhalter, nicht verbinden“ (`192.0.2.1`). Diesen Client nicht stehen lassen.
3. Den Read-Node öffnen, als Server den **bereits vorhandenen** Huawei-Modbus-Client wählen und die Unit-ID leer lassen. Damit gilt die Unit-ID des bestehenden Clients.
4. Den Platzhalter-Client löschen.
5. Prüfen, dass die Ports **1502** und **1503** in dieser Instanz frei sind.
6. Den Read-Node aktivieren und deployen.

Das Intervall steht auf 5 s. Es sollte nicht kürzer sein als der bestehende Lesezyklus, damit die eine Warteschlange vor dem nächsten Poll des Growatt durch ist.

Liegt der Block 37100 bis 37138 schon in einer bestehenden Lesung, bleibt der neue Read-Node aus. Den Ausgang dieser Lesung mit dem Link-In **Bestehende Huawei-Lesung** verbinden. Die Nachricht muss 39 Register ab 37100 enthalten oder die Startadresse unter `msg.input.payload.address` mitliefern.

## Vorzeichen

Huawei zählt positive Wirkleistung als Einspeisung, der SDM630 als Bezug. Strom, Wirkleistung und Leistungsfaktor werden gedreht. Spannungen bleiben positiv.

| Richtung | Huawei `37113` | SDM630 `0x0034` | Growatt |
| --- | --- | --- | --- |
| Bezug aus dem Netz | negativ | positiv | Akku entladen |
| Einspeisung ins Netz | positiv | negativ | Akku laden |

Die Energiezähler werden getauscht, nicht negiert: Huawei `37121` (Import) wird SDM630 `0x0048`, Huawei `37119` (Export) wird SDM630 `0x004A`.

Phasenleistung kommt aus `37132`, `37134` und `37136`. Ist eine Phasenleistung 0 und Strom sowie Spannung sind gesetzt, wird `P = U · I` mit dem Huawei-Vorzeichen eingesetzt und danach gedreht. Die Gesamtleistung wird nicht künstlich auf die Phasen verteilt.

Ist der Zählerstatus nicht „normal“ oder die Lesung bleibt aus, bleibt der letzte gültige SDM630-Wert stehen. Ein Sprung auf 0 W würde der Growatt als lastfreies Netz lesen.

## Register für den Growatt

FC03 und FC04 lesen dasselbe Abbild, Float32, High-Word zuerst. Der Modbus-TCP-Server auf Port 1502 antwortet auf jede Unit-ID. Der RTU-Zugang auf Port 1503 antwortet nur auf Adresse 2.

- `0x0000`–`0x0010` Spannung, Strom und Wirkleistung L1–L3
- `0x0034` Gesamtwirkleistung in Watt
- `0x0046` Frequenz, `0x0048` Import-kWh, `0x004A` Export-kWh
- `0x00C8`–`0x00CC` verkettete Spannungen

## Elfin EE11

Der Zählereingang des MOD 5000TL3-HU ist RS485, 9600 8N1, Adresse 2. Auf diesem Bus hängt nur das EE11, A an 485A und B an 485B. Node-RED braucht eine feste IP, weil das EE11 das Ziel fest einträgt.

Gemeinsame Einstellungen: TCP-Client, Modus Always, Heartbeat aus, Register-Paket aus, Socket-Security aus, Route UART, 9600 8N1, Halbduplex.

- UART-Protokoll **Modbus**, wenn es wählbar ist: Zielport **1502**. Das EE11 setzt RTU nach Modbus TCP um.
- UART-Protokoll **NONE**, falls Modbus ausgegraut ist: Zielport **1503**, Gap-Time 10 ms. Die RTU-Rahmen laufen dann unverändert über TCP.

## Handwert

Im Dashboard unter `/ui`, Reiter SDM630, schaltet **Handwert statt Huawei** die Gesamtleistung auf den eingegebenen Wert. Positiv ist Bezug, negativ ist Einspeisung. Im Normalbetrieb bleibt der Schalter aus.

## Lokal prüfen, ohne die Hausanlage

Die Tests sprechen einen Dummy an, nicht den SUN2000.

```bash
npm install
npm test
npm run test:e2e
```

`npm test` prüft die Vorzeichen, den Registerversatz und die RTU-Prüfung. `npm run test:e2e` startet den Dummy und eine eigene Node-RED-Instanz auf Port 18880. Diese Instanz nicht gegen den echten Huawei laufen lassen.
