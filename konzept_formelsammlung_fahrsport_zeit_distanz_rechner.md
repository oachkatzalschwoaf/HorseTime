# Konzept & Formelsammlung: Zeit-Distanz-Rechner (Fahrsport)

Dieses Dokument dient als Spezifikation und Formelsammlung für die Neu-Umsetzung der ehemaligen Android-App (*ZeitDistanz Calculator*, Dev: *TotoroW*) für Pferdekutschenbewerbe (Fahren / Geländefahrt / Marathon / Strecken).

---

## 1. Kernfunktionen der App

Im Fahrsport (nach FEI / ÖTO / LPO) geht es in Strecken- und Marathonprüfungen (Phasen A, B, D, E) darum, eine vorgegebene Distanz innerhalb eines definierten Zeitfensters zu bewältigen.

Die App sollte folgende Kernbereiche abdecken:
1. **3-Wege-Rechner:** Berechnung der jeweils fehlenden Größe aus **Distanz**, **Zeit** und **Geschwindigkeit (km/h)** bzw. **Pace (min/km)** und **Meter pro Minute (m/min)**.
2. **Zeitfenster-Berechnung (Fahrsport-Logik):** Automatische Ermittlung von **Erlaubter Zeit (Höchstzeit)**, **Mindestzeit** und einer empfohlenen **Zielzeit** (inkl. Sicherheitspuffer).
3. **Kilometer-Zwischenzeiten (Split-Tabelle):** Übersicht für den Beifahrer/Navigator, welche Zeit bei jedem Kilometerstein (km 1, km 2, km 3, …) auf der Stoppuhr stehen muss.

---

## 2. Mathematische Formeln

### Einheiten-Basis
* **Distanz ($d$):** Meter ($\text{m}$) oder Kilometer ($\text{km}$)
* **Zeit ($t$):** Sekunden ($\text{s}$), formatiert als `HH:MM:SS` oder `MM:SS`
* **Geschwindigkeit ($v$):** Kilometer pro Stunde ($\text{km/h}$)
* **Pace ($p$):** Minuten pro Kilometer ($\text{min/km}$)
* **Tempo in Metern/Minute ($v_m$):** Meter pro Minute ($\text{m/min}$)

### A. Grundberechnungen (3-Wege)

* **Zeit berechnen** (aus Distanz in $\text{m}$ und Geschwindigkeit in $\text{km/h}$):
  $$t_{\text{sek}} = \frac{d_{\text{m}}}{v_{\text{km/h}}} \times 3{,}6$$

* **Geschwindigkeit berechnen** (aus Distanz in $\text{m}$ und Zeit in $\text{s}$):
  $$v_{\text{km/h}} = \frac{d_{\text{m}}}{t_{\text{sek}}} \times 3{,}6$$

* **Distanz berechnen** (aus Geschwindigkeit in $\text{km/h}$ und Zeit in $\text{s}$):
  $$d_{\text{m}} = \frac{v_{\text{km/h}} \times t_{\text{sek}}}{3{,}6}$$

### B. Umrechnungen zwischen Tempo-Einheiten

* **$\text{km/h}$ in $\text{m/min}$:**
  $$v_{\text{m/min}} = \frac{v_{\text{km/h}} \times 1000}{60}$$

* **$\text{m/min}$ in $\text{km/h}$:**
  $$v_{\text{km/h}} = \frac{v_{\text{m/min}} \times 60}{1000}$$

* **$\text{km/h}$ in Pace ($\text{min/km}$ in Sekunden pro km):**
  $$p_{\text{sek/km}} = \frac{3600}{v_{\text{km/h}}}$$

---

## 3. Fahrsport-Spezifika & Regelwerk

### Zeitfenster (Erlaubte Zeit vs. Mindestzeit)
Bei Marathon- und Streckenprüfungen führt sowohl das **Überschreiten der erlaubten Zeit** als auch das **Unterschreiten der Mindestzeit** zu Strafpunkten (in der Regel $0{,}25$ Strafpunkte pro angefangene Sekunde).

| Wert | Berechnung / Standardregel (FEI / ÖTO / LPO) |
| :--- | :--- |
| **Erlaubte Zeit ($t_{\text{max}}$)** | Berechnet aus der Streckenlänge und dem ausgeschriebenen Höchsttempo (z. B. $14\,\text{km/h}$ oder $15\,\text{km/h}$). |
| **Mindestzeit ($t_{\text{min}}$)** | **Strecke $> 3.000\,\text{m}$:** $t_{\text{max}} - 120\,\text{s}$ (2 Minuten unter erlaubter Zeit)<br>**Strecke $\le 3.000\,\text{m}$:** $t_{\text{max}} - 60\,\text{s}$ (1 Minute unter erlaubter Zeit) |
| **Ideale Zielzeit ($t_{\text{ziel}}$)** | $t_{\text{max}} - \text{Puffer}$ (typischerweise $15\text{–}30\,\text{s}$ vor Ablauf der erlaubten Zeit, um Strafpunkte sicher zu vermeiden). |

### Kilometer-Zwischenzeiten (Beifahrer-Tabelle)
Für jeden vollen Kilometer $k \in \{1, 2, \dots, \lfloor d_{\text{km}} \rfloor\}$ sowie das Ziel ($d_{\text{km}}$) wird die Soll-Durchgangszeit berechnet:

$$t(k) = k \times \frac{3600}{v_{\text{ziel}}}$$

*Hinweis für die Praxis:* Da auf der Strecke oft erst kurz vor dem Ziel („Haltezone“ / „Warte-Markierung“ vor dem Ziel) das Tempo reguliert wird, empfiehlt es sich, die Zwischenzeiten auf Basis der **idealen Zielzeit** (inkl. Puffer) zu berechnen.

---

## 4. UI/UX-Empfehlungen für die Neu-Umsetzung

* **Große Touch-Targets & Kontrast:** Auf der Kutsche (Beifahrer) wackelt es und die Sonne blendet – große Schriftarten, hoher Kontrast (Dark/Light Mode) und klare Trennung zwischen Eingabe- und Ergebnisfeldern sind entscheidend.
* **Schnellauswahl-Buttons (Presets):** Typische Geschwindigkeiten im Fahrsport als Schnellwahl-Buttons hinterlegen (z. B. `7 km/h` Schritt, `12 km/h`, `13 km/h`, `14 km/h`, `15 km/h`).
* **Phasen-Speicher:** Möglichkeit, 2–3 Phasen (z. B. *Phase A*, *Transfer*, *Phase B*) parallel zu speichern, damit zwischen den Phasen nicht neu getippt werden muss.
* **Offline-Fähigkeit:** Auf Turnierplätzen im Gelände ist der Mobilfunkempfang oft schlecht – die App muss zu 100 % offline funktionieren.