# Lichthof

Eine lokale, private Kunstgalerie mit begehbarem Ausstellungsraum und Bilderraster.

## Start unter Windows

Voraussetzung ist Node.js 24 oder neuer. Führe im Projektordner in PowerShell aus:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Öffne [Lichthof](http://127.0.0.1:4173). Der Server ist ausschließlich auf diesem Rechner erreichbar. Mit Strg+C beendest du ihn. Für die Entwicklung gibt es `npm.cmd run dev`.

## Benutzung

- Über „Kunstwerk hinzufügen“ wählst du ein JPEG, PNG, WebP, HEIC, MP4 oder WebM und vergibst einen Titel. Die Grenzen liegen bei 25 MB pro Bild und 250 MB pro Video. HEIC-Dateien werden lokal für die Anzeige in WebP umgewandelt. Das Original bleibt im Datenordner erhalten. Videos brauchen einen vom Browser unterstützten Codec, etwa H.264 in MP4 oder VP9 in WebM.
- „Raum betreten“ aktiviert die Steuerung. Mit WASD oder Pfeiltasten gehst du, mit der Maus schaust du dich um. Klicke auf ein Werk im Fadenkreuz oder drücke Enter. Escape beendet die Steuerung. Auf Touch-Geräten nutzt du die Richtungstasten am Bildschirm und wischst zum Umschauen.
- Über „Alle Werke“ kannst du die Sammlung auch ohne 3D ansehen. Im Detaildialog findest du „Bearbeiten“ und „Löschen“.

## Datensicherung

Beende die App und kopiere den gesamten Ordner `data`. Darin liegen die SQLite-Datenbank, Originalmedien und Vorschaubilder. Für eine Wiederherstellung lege die Sicherung bei gestoppter App wieder als `data` in den Projektordner. Die Datensicherung enthält deine Originale.

## GitHub

Das Repository ist für den Quellcode vorgesehen. Git ignoriert den Ordner `data` mit der lokalen Sammlung. Verwende auf GitHub ein privates Repository und sichere die Sammlung separat.

`npm.cmd test` prüft die lokale API. `npm.cmd run check` prüft TypeScript.
