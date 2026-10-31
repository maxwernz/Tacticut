# Tacticut-MCP: Spielvideos aus Phönix

Ein lokaler MCP-Server für Claude Code. Er holt Spielvideos der BWHV-Verbandsligen aus dem Phönix-Videoportal
(`bwhv.it4sport.de`, Rolle „Vereinsbeobachtung“), gleicht Spielzeit und Videozeit ab und macht aus Spielzeit-Momenten
eine Tacticut-Analyse oder fertige MP4-Clips.

Zusammen mit dem `handball-bw`-MCP aus HandballResults (Statistik, Spielberichte) geht zum Beispiel:

> „Such alle Unterzahl-Phasen von TSV Bönnigheim in den letzten drei Spielen und mach mir daraus eine Tacticut-Analyse.“

## Einrichtung

1. Phönix-Zugang einmal im macOS-Schlüsselbund ablegen (fragt nach dem Passwort):
   ```sh
   security add-generic-password -s tacticut-it4sport -a <benutzername> -w
   ```
   Alternativ `PHOENIX_USERNAME` und `PHOENIX_PASSWORD` setzen.
2. `npm ci` (das MCP-SDK ist eine Dev-Abhängigkeit, FFmpeg bringt Tacticut mit).
3. Anmelden:
   - In diesem Repository meldet `.mcp.json` den Server an.
   - Damit er überall zusammen mit `handball-bw` verfügbar ist, einmal global:
     ```sh
     claude mcp add --scope user tacticut -- node --disable-warning=ExperimentalWarning \
       --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$PWD/mcp/server.mts"
     ```

Die Auszeiten liest der Server aus der handball-bw-Datenbank
(`~/development/HandballResults/analysis/handball.db`, anderer Ort über `HANDBALL_DB`). Spiele werden über die
h4a-Spielnummer zugeordnet (`games.game_no`, dieselbe Nummer wie in Phönix).

## Werkzeuge

| Werkzeug | Zweck |
| --- | --- |
| `list_games` | Spiele mit Video, nach Liga (`M-VL-4`) und Team filterbar |
| `contact_sheet` | Bildleiste mit Zeitstempeln, um Anpfiffe und Auszeiten im Video zu finden |
| `frame` | Einzelbild oder Ausschnitt, z. B. um die Hallenanzeige abzulesen |
| `set_sync` | Anpfiffe und weitere Abgleichpunkte pro Spiel speichern |
| `plan_clips` | Spielzeit → Videozeit, zum Prüfen |
| `create_analysis` | `.tcut`-Datei für Tacticut (Datei → Öffnen) |
| `export_clips` | MP4, zusammengefügt und/oder einzeln, mit Clipname eingeblendet |

## Spielzeit und Videozeit

Die Videos sind nicht mit der Spieluhr verbunden. Pro Spiel braucht es deshalb einmal einen Abgleich:

1. **Anpfiffe beider Halbzeiten**: Viele Videos beginnen mit Einlaufen und Begrüßung, die Halbzeitpause ist oft
   herausgeschnitten. Am genauesten ist eine abgelesene Hallenanzeige.
2. **Auszeiten als Punkte**: Laut Bericht halten Auszeiten die Uhr an. Im Video laufen Halbzeiten aber oft mehrere Minuten
   länger als Spielzeit plus Auszeiten (Unterbrechungen, Wiederholungen bei geschnittenen Videos). `set_sync` nennt
   für jede Auszeit die erwartete Videozeit. Der Wiederanpfiff danach ist ein guter Abgleichpunkt. Zwischen zwei Punkten
   wird die Abweichung gleichmäßig verteilt.

Der Abgleich wird gespeichert (`~/Movies/Tacticut/.tacticut-mcp.json`) und gilt für alle späteren Analysen dieses Spiels.

## Videos und Speicherplatz

- `create_analysis` mit `media: "excerpts"` (Standard) lädt nur die benötigten Abschnitte samt Puffer (Standard 45 s)
  und fügt sie pro Spiel zu einer Datei zusammen. Die Clip-Notizen nennen die Spielzeit.
- `media: "full"` lädt das ganze Spiel (1–4 GB, etwa 5 Minuten) nach `~/Movies/Tacticut/Spiele` und nutzt es weiter.
- `export_clips` schneidet direkt aus dem Portal, ohne Komplett-Download.

Ablageort: `~/Movies/Tacticut` (`TACTICUT_LIBRARY`). Die Videos dürfen nur für eigene Vereinszwecke genutzt werden.
