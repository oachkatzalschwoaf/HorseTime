# HorseTime

Zeit-Distanz-Rechner für den Fahrsport (Strecken- und Marathonphasen) als Web-App fürs Handy. Läuft nach dem ersten Laden offline, braucht kein Konto und speichert alle Daten nur auf dem Gerät.

Nachfolger der Android-App „TimeTable“ (2018). Die einfache Originalversion ist in der App weiterhin enthalten (Optionen → „Alte Version“).

## Funktionen

**Plan** – Zeitfenster und Zwischenzeiten vorab berechnen
- Mehrere Phasen speichern (z. B. Phase A, Transfer, Phase B)
- Vorgabe per Höchsttempo oder direkt als erlaubte Zeit
- Mindestzeit nach Regel (über 3000 m: 2 Minuten unter der erlaubten Zeit, sonst 1 Minute), manuell oder keine
- Zielzeit = erlaubte Zeit minus Sicherheitspuffer
- Zwischenzeiten-Tabelle (Mindest / Ziel / Erlaubt) in wählbaren Abständen, druckbar
- Strecke als GPX-Datei laden und auf der Karte anzeigen

**Fahrt** – live unterwegs
- Große Stoppuhr mit Vorsprung oder Rückstand zum Plan, farbig nach Zeitfenster
- Zeitleiste: Zeitfenster, Zielzeit, geplante Kilometer, getippte Schilder, jetzt, hochgerechnete Ankunft
- Tempo jetzt, Ø-Tempo, Tempo-Fenster für den Rest der Strecke, gefahrene Distanz, Soll-Zeit am nächsten Kilometer
- Karte mit GPS-Track; im Querformat Werte links, Karte rechts
- Knopf „Km-Schild“: beim Passieren eines Kilometer-Schilds tippen. Korrigiert die GPS-Distanz und funktioniert auch ganz ohne GPS
- „Start um“ eine Uhrzeit mit Countdown; Startzeit nachträglich korrigierbar
- Signale: Töne, Vibration, Sprachansage (je Kilometer, Mindestzeit, 1 Minute vor der erlaubten Zeit)
- Ergebnis mit Strafpunkten; Track als GPX herunterladen

**Rechner** – aus zwei Werten von Distanz, Zeit und Tempo den dritten; Umrechner km/h, m/min, min/km, m/s

**Verlauf** – gespeicherte Fahrten mit Karte, Zwischenzeiten und GPX

**Optionen** – Schriftgröße bis 200 %, Design Hell/Dunkel/„Sonne“ (maximaler Kontrast), Kartenquelle, Signale, Strafpunkte je Sekunde, Backup speichern/laden

Formeln und Regeln: [konzept_formelsammlung_fahrsport_zeit_distanz_rechner.md](konzept_formelsammlung_fahrsport_zeit_distanz_rechner.md).

## Aufs Handy bringen

Standort, Offline-Betrieb und Installation funktionieren nur über **HTTPS**. Den Ordner `app/` unverändert auf einen statischen HTTPS-Hoster legen, z. B. einen eigenen Apache-Webspace, GitHub Pages, Netlify oder Cloudflare Pages. Ein Build-Schritt ist nicht nötig.

Bei Apache die versteckte Datei `app/.htaccess` mit hochladen. Sie leitet `http://` auf `https://` um; manche FTP-Programme blenden solche Dateien aus.

Danach prüfen:

```sh
npm run check -- https://<adresse>/
```

Das Werkzeug prüft Umleitung, Dateien, Version, Service Worker und Installierbarkeit.

Dann die Adresse am Handy öffnen und installieren:
- **Android (Chrome):** Optionen → „App installieren“ oder Browser-Menü → „App installieren“
- **Android (Brave, Firefox u. a.):** Browser-Menü (⋮) → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“. Diese Browser zeigen meist keinen eigenen Installieren-Knopf in der App.
- **iPhone/iPad (Safari):** Teilen → „Zum Home-Bildschirm“

## Entwicklung

Voraussetzung: Node.js 22 oder neuer. Es gibt keine Abhängigkeiten, `npm install` ist nicht nötig.

```sh
npm run dev      # App unter http://localhost:8080
npm test         # Unit-Tests (Rechenlogik, Tracker, GPX, Offline-Dateiliste)
npm run smoke    # Browser-Test mit Edge/Chrome headless inkl. Screenshots
npm run icons    # App-Icons neu erzeugen
```

Aufbau:
- `app/` – die App (HTML, CSS, JavaScript-Module, Service Worker, Manifest, Icons)
- `app/legacy.html` – alte Version „TimeTable“, eigenständige Einzeldatei
- `tests/` – Unit-Tests mit `node:test`
- `tools/` – Entwicklungs-Server, Smoke-Test, Icon-Generator

**Wichtig bei Änderungen an `app/`:** `VERSION` in `app/sw.js` erhöhen, sonst bekommen installierte Geräte die alte Fassung aus dem Cache. Neue Dateien in `ASSETS` in `app/sw.js` eintragen; `npm test` prüft das.

## Hinweise und Grenzen

- Ist der Bildschirm aus oder die App im Hintergrund, liefert der Browser kein GPS, besonders auf dem iPhone. Die App hält deshalb während der Fahrt den Bildschirm an. Die Stoppuhr läuft in jedem Fall richtig weiter.
- Kartenkacheln kommen aus dem Netz (OpenStreetMap bzw. OpenTopoMap). Angesehene Ausschnitte werden für offline gespeichert; ganze Gebiete vorab laden erlauben die Kartenanbieter nicht. Ohne Karte wird der Track auf einem Raster gezeigt.
- Vibration gibt es auf dem iPhone nicht; die Sprachansage nutzt die Stimmen des Geräts.
- Strafpunkte je Sekunde (Standard 0,25) und Abstand der Kilometer-Schilder unter Optionen an das jeweilige Regelwerk anpassen.

Kartendaten © OpenStreetMap-Mitwirkende (ODbL); OpenTopoMap (CC-BY-SA).
