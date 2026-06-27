# Nivtec Calculator

Rust/WASM-basierter Bühnenplaner für Nivtec-Systempodeste mit einer Weboberfläche im Nebensound-Stil.

Die Berechnung läuft lokal im Browser: Rust erzeugt die Bühnenlogik und wird als WebAssembly-Modul geladen. Die Weboberfläche rendert daraus Materialliste, Kennzahlen und eine PDF-nahe technische Zeichnung, die als PNG exportiert werden kann.

## Fachliche Quelle

Maßgeblich ist das Nivtec-PDF:

<https://nivtec.com/wp-content/uploads/2024/03/02.-Aufbauregeln-in-ihrer-einfachsten-Form_DE.pdf>

Wichtig:

- PDF 2.1: Bühnen unter 80 cm ohne Verstrebung.
- PDF 2.2: Bühnen 80 bis 140 cm mit Diagonalverstrebung.
- PDF 2.3: Bühnen über 140 bis 200 cm mit Horizontal- und Diagonalverstrebung.
- PDF 2.2.6: Kleinbühnen unter 6 m Breite und/oder Tiefe benötigen zusätzliche Innendiagonalen.

Das alte EVTP-Tool ist keine fachliche Quelle. Es darf nur als grobe Produktidee dienen.

## Struktur

- `src/lib.rs` — Rust-Berechnungslogik und WASM-Exports
- `pkg/nivtec_core.wasm` — gebautes WebAssembly-Modul für die Weboberfläche
- `web/index.html` — statische Web-App
- `web/app.js` — Browser/WASM-Brücke, Rendering und Exporte
- `web/styles.css` — Nebensound-orientiertes Styling
- `.github/workflows/build.yml` — GitHub Actions Build-Check
- `.github/copilot-instructions.md` — Projektanweisungen für GitHub Copilot

## Voraussetzungen

- Rust `1.92.0` oder kompatibel; GitHub Actions nutzt `1.92.0`
- Target `wasm32-unknown-unknown`
- Ein lokaler statischer Webserver, z. B. Python

## Build

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/nivtec_core.wasm pkg/nivtec_core.wasm
```

Wenn `src/lib.rs` geändert wird, muss `pkg/nivtec_core.wasm` mit aktualisiert und committed werden.

## Lokal starten

```bash
python3 -m http.server 8765
```

Dann öffnen:

```text
http://127.0.0.1:8765/web/
```

## Checks vor Commit

```bash
cargo fmt --all --check
cargo build --release --target wasm32-unknown-unknown
cmp target/wasm32-unknown-unknown/release/nivtec_core.wasm pkg/nivtec_core.wasm
```
