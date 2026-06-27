const COLS_OFFSET = 64;
const ROWS_OFFSET = 128;
const CELLS_OFFSET = 192;
const CELL_STRIDE = 6;
const MATERIALS_OFFSET = 1800;
const MATERIAL_STRIDE = 6;

const colors = {
  "2x1": "#7067e6",
  "2x0.5": "#18a886",
  "1x1": "#e56b45",
  "1x0.5": "#8b8f9d",
  special: "#f2a33a",
  special05: "#d95f91"
};

const articleNames = {
  1: "Systempodest 2,0×1,0 m",
  2: "Systempodest 2,0×0,5 m",
  3: "Systempodest 1,0×1,0 m",
  4: "Systempodest 1,0×0,5 m",
  5: (code) => `Steckfuß (fest), ${code} cm`,
  6: (code) => `Steckfuß mit Layher-Verstellspindel, ${code} cm`,
  7: () => "Layher-Gerüstspindel (Ausspindelung gemäß Hersteller prüfen)",
  11: "Sicherheitsgeländer 185 cm",
  12: "Sicherheitsgeländer 85 cm",
  13: "Geländer Sonderbreite 50 cm",
  14: "Geländer-Aufnahmebolzen ø26 mm",
  15: "Adapter (Fußaufnahme ohne Fuß)",
  16: "Geländer-Verbinder",
  17: "Eckverbinder (2 Stk. pro Ecke)",
  18: (code) => `Diagonalverstrebung nach Nivtec-Aufbauschema 2.2/2.3, Diagonale ${code} mm`,
  19: "Horizontalverstrebung nach Nivtec-Aufbauschema 2.3"
};

const articleNumbers = {
  1: "NS-NIV-POD-200100",
  2: "NS-NIV-POD-200050",
  3: "NS-NIV-POD-100100",
  4: "NS-NIV-POD-100050",
  5: (code) => `NS-NIV-FUSS-S-${String(code).padStart(3, "0")}`,
  6: (code) => `NS-NIV-FUSS-VS-${String(code).padStart(3, "0")}`,
  7: (code) => `NS-NIV-SPINDEL-${String(code).padStart(3, "0")}`,
  11: "NS-NIV-GEL-185",
  12: "NS-NIV-GEL-085",
  13: "NS-NIV-GEL-050",
  14: "NS-NIV-ZUB-BOLZEN",
  15: "NS-NIV-ZUB-ADAPTER",
  16: "NS-NIV-ZUB-VERBINDER",
  17: "NS-NIV-ZUB-ECK",
  18: (code) => `NS-NIV-AUS-DIAG-${code}`,
  19: "NS-NIV-AUS-HORIZ"
};

const groupNames = {
  1: "Podeste",
  2: "Füße & Spindeln",
  3: "Aussteifung",
  4: "Geländer",
  5: "Geländer-Zubehör"
};

const unitNames = {
  1: "Stk.",
  2: "Schema"
};

const savedTheme = localStorage.getItem("nivtec-theme") || localStorage.getItem("nivtec-rust-theme");
const browserTheme = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";

const state = {
  widthHalf: 16,
  depthHalf: 12,
  orientation: 0,
  footType: 0,
  height: 60,
  special: false,
  rails: { hinten: false, vorne: false, links: false, rechts: false },
  theme: savedTheme || browserTheme
};

let wasm;
let outputLen = 0;
let lastCalc;

const $ = (id) => document.getElementById(id);
const halfToM = (half) => half / 2;
const fmt = (value) => value.toLocaleString("de-DE", { maximumFractionDigits: 1 });
const fmtHalf = (half) => fmt(halfToM(half));
const railsMask = () => (state.rails.hinten ? 1 : 0) | (state.rails.vorne ? 2 : 0) | (state.rails.links ? 4 : 0) | (state.rails.rechts ? 8 : 0);

function articleText(code, artCode) {
  const value = articleNames[code];
  return typeof value === "function" ? value(artCode) : value || `Artikel ${code}`;
}

function artNumber(code, artCode) {
  const value = articleNumbers[code];
  if (typeof value === "function") return value(artCode);
  return value || `NS-NIV-${String(code).padStart(3, "0")}`;
}

async function initWasm() {
  const response = await fetch("../pkg/nivtec_core.wasm");
  const bytes = await response.arrayBuffer();
  const module = await WebAssembly.instantiate(bytes, {});
  wasm = module.instance.exports;
  outputLen = wasm.output_len();
  if (!wasm.memory || !wasm.calculate) {
    throw new Error("Das WASM-Modul exportiert nicht die erwartete Schnittstelle.");
  }
}

function calculate() {
  const ptr = wasm.calculate(
    state.widthHalf,
    state.depthHalf,
    state.orientation,
    state.footType,
    state.height,
    state.special ? 1 : 0,
    railsMask()
  );
  const view = new Int32Array(wasm.memory.buffer, ptr, outputLen);
  const data = Array.from(view);
  const colsLen = data[3];
  const rowsLen = data[4];
  const cellCount = data[5];
  const materialCount = data[20];
  const cols = data.slice(COLS_OFFSET, COLS_OFFSET + colsLen);
  const rows = data.slice(ROWS_OFFSET, ROWS_OFFSET + rowsLen);
  const cells = [];
  for (let index = 0; index < cellCount; index += 1) {
    const offset = CELLS_OFFSET + index * CELL_STRIDE;
    cells.push({
      r: data[offset],
      c: data[offset + 1],
      rowSpan: data[offset + 2],
      widthHalf: data[offset + 3],
      depthHalf: data[offset + 4],
      type: data[offset + 5]
    });
  }
  const materials = [];
  for (let index = 0; index < materialCount; index += 1) {
    const offset = MATERIALS_OFFSET + index * MATERIAL_STRIDE;
    materials.push({
      pos: data[offset],
      article: data[offset + 1],
      artCode: data[offset + 2],
      qty: data[offset + 3],
      unit: data[offset + 4],
      group: data[offset + 5]
    });
  }
  return {
    data,
    cols,
    rows,
    cells,
    materials,
    recommended: data[8],
    normal: { two: data[9], other: data[10] },
    rotated: { two: data[11], other: data[12] }
  };
}

function syncRecommended() {
  const calc = calculate();
  state.orientation = calc.recommended;
}

function materialKey(widthHalf, depthHalf, type) {
  if (type === 4) return "special";
  if (type === 5) return "special05";
  const long = Math.max(widthHalf, depthHalf);
  const short = Math.min(widthHalf, depthHalf);
  if (long === 4 && short === 2) return "2x1";
  if (long === 4 && short === 1) return "2x0.5";
  if (long === 2 && short === 2) return "1x1";
  if (long === 2 && short === 1) return "1x0.5";
  return "2x1";
}

function updateDimension(kind, value) {
  const numeric = Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(numeric)) return;
  const half = Math.round(numeric * 2);
  if (kind === "width") {
    state.widthHalf = Math.min(40, Math.max(1, half));
    if ((state.widthHalf % 4 === 1 || state.widthHalf % 4 === 3) && state.depthHalf % 2 === 1) {
      state.depthHalf = Math.max(2, state.depthHalf - 1);
    }
  } else {
    const step = state.widthHalf % 4 === 1 || state.widthHalf % 4 === 3 ? 2 : 1;
    state.depthHalf = Math.min(24, Math.max(step, Math.round(half / step) * step));
  }
  syncRecommended();
  render();
}

function updateHeight(value) {
  const numeric = Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(numeric)) return;
  state.height = Math.min(200, Math.max(20, Math.round(numeric)));
  render();
}

function renderDimensions(calc) {
  $("widthValue").textContent = `${fmtHalf(state.widthHalf)} m`;
  $("depthValue").textContent = `${fmtHalf(state.depthHalf)} m`;
  $("widthRange").value = halfToM(state.widthHalf);
  $("widthInput").value = halfToM(state.widthHalf);
  const depthStep = state.widthHalf % 4 === 1 || state.widthHalf % 4 === 3 ? 1 : 0.5;
  $("depthRange").min = depthStep;
  $("depthRange").step = depthStep;
  $("depthRange").value = halfToM(state.depthHalf);
  $("depthInput").min = depthStep;
  $("depthInput").step = depthStep;
  $("depthInput").value = halfToM(state.depthHalf);
  const warning = $("dimensionWarning");
  warning.classList.toggle("hidden", calc.data[23] !== 1);
  warning.textContent = `${fmtHalf(state.widthHalf)}×${fmtHalf(state.depthHalf)} m würde ein 0,5×0,5-m-Eckpodest erzeugen.`;
}

function renderOrientation(calc) {
  const recommendedLabel = calc.recommended === 0 ? "Normal" : "Rotiert";
  const reason = calc.rotated.other < calc.normal.other
    ? `Rotiert: ${calc.rotated.other} Sondermaße statt ${calc.normal.other}`
    : calc.normal.other < calc.rotated.other
      ? `Normal: ${calc.normal.other} Sondermaße statt ${calc.rotated.other}`
      : calc.rotated.two > calc.normal.two
        ? `Rotiert nutzt mehr 2×1 m (${calc.rotated.two} vs. ${calc.normal.two})`
        : calc.normal.other === 0 ? "beide optimal, kein Sondermaß" : "Gleichstand, Normal bevorzugt";
  $("recommendationText").textContent = `Empfehlung: ${recommendedLabel} — ${reason}`;
  const cards = [
    { id: 0, label: "Normal", desc: "Lange Seite → Breite", score: calc.normal },
    { id: 1, label: "Rotiert", desc: "Lange Seite → Tiefe", score: calc.rotated }
  ];
  $("orientationCards").innerHTML = cards.map((card) => {
    const active = state.orientation === card.id;
    const recommended = calc.recommended === card.id;
    return `<button type="button" class="choice ${active ? "active" : ""} ${recommended ? "recommended" : ""}" data-orientation="${card.id}">
      <strong>${card.label}${recommended ? " · empfohlen" : ""}</strong>
      <span>${card.desc}</span>
      <span>${card.score.two}× 2×1 m${card.score.other ? ` + ${card.score.other} Sondermaße` : " — kein Sondermaß"}</span>
    </button>`;
  }).join("");
  document.querySelectorAll("[data-orientation]").forEach((button) => {
    button.addEventListener("click", () => {
      state.orientation = Number(button.dataset.orientation);
      render();
    });
  });
}

function renderHeight(calc) {
  document.querySelectorAll("[data-foot]").forEach((button) => button.classList.toggle("active", Number(button.dataset.foot) === state.footType));
  const base = calc.data[21];
  const spSize = calc.data[22];
  $("footText").textContent = state.footType === 0
    ? `${base} cm · Steckfuß fest — keine Spindel`
    : `${state.height} cm · Grundfuß ${base} cm + Layher-Spindel${spSize ? ` ${spSize} cm` : ""}`;
  if (state.footType === 0) {
    $("heightControl").innerHTML = `<div class="heightButtons">${[20, 40, 60, 80, 100, 120].map((height) => `<button type="button" data-height="${height}" class="${state.height === height ? "active" : ""}">${height} cm</button>`).join("")}</div>`;
  } else {
    $("heightControl").innerHTML = `<label class="rangeLabel" for="heightRange">Bühnenhöhe <strong>${state.height} cm</strong></label><input id="heightRange" type="range" min="20" max="200" step="1" value="${state.height}"><label class="heightNumber" for="heightInput"><span>Exakte Höhe</span><span><input id="heightInput" type="number" min="20" max="200" step="1" value="${state.height}"> cm</span></label><p class="sub">Individuelle Höhen wie 46 cm sind über Spindelfüße abbildbar. Nivtec-Regel: <80 cm ohne Verstrebung, 80-140 cm diagonal, >140-200 cm horizontal + diagonal.</p>`;
  }
  document.querySelectorAll("[data-height]").forEach((button) => {
    button.addEventListener("click", () => {
      state.height = Number(button.dataset.height);
      render();
    });
  });
  const range = $("heightRange");
  if (range) {
    range.addEventListener("input", (event) => updateHeight(event.target.value));
  }
  const input = $("heightInput");
  if (input) {
    input.addEventListener("input", (event) => updateHeight(event.target.value));
  }
}

function renderSpecial(calc) {
  $("specialToggle").checked = state.special;
  $("specialToggle").disabled = calc.data[24] !== 1;
  if (calc.data[24] !== 1) state.special = false;
}

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;"
  })[char]);
}

function axisLabel(index, count) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const offset = count - index - 1;
  return alphabet[offset] || String(offset + 1);
}

function planGeometry(calc) {
  const width = halfToM(state.widthHalf);
  const depth = halfToM(state.depthHalf);
  const xStarts = [];
  const yStarts = [];
  const xEdges = [0];
  const yEdges = [0];
  calc.cols.reduce((sum, value) => {
    xStarts.push(sum);
    const next = sum + halfToM(value);
    xEdges.push(next);
    return next;
  }, 0);
  calc.rows.reduce((sum, value) => {
    yStarts.push(sum);
    const next = sum + halfToM(value);
    yEdges.push(next);
    return next;
  }, 0);
  return { width, depth, xStarts, yStarts, xEdges, yEdges };
}

function bracingModeLabel(mode) {
  if (mode === 0) return "Nivtec 2.1: <80 cm ohne Verstrebung";
  if (mode === 1) return "Nivtec 2.2: 80-140 cm Diagonalverstrebung";
  if (mode === 2) return "Nivtec 2.3: >140-200 cm Horizontal + Diagonal";
  return "Außerhalb dieses Regelabschnitts";
}

function technicalPlanSvg(calc, exportMode = false) {
  const geom = planGeometry(calc);
  const mode = calc.data[7];
  const selectedRails = Object.values(state.rails).some(Boolean);
  const viewX = -1.05;
  const viewY = -0.95;
  const viewWidth = geom.width + 1.95;
  const viewHeight = geom.depth + 1.85;
  const scale = Math.max(0.44, Math.min(1, Math.min(geom.width / 8, geom.depth / 6)));
  const font = 0.15 * scale;
  const smallFont = 0.105 * scale;
  const microFont = 0.075 * scale;
  const dotRadius = 0.04 * scale;
  const stroke = 0.014 * scale;
  const outlineStroke = 0.022 * scale;
  const arrowStroke = 0.034 * scale;
  const greenStroke = 0.02 * scale;
  const railStroke = 0.07 * scale;
  const footPoints = new Map();

  const rememberFoot = (x, y) => footPoints.set(`${x.toFixed(3)}:${y.toFixed(3)}`, [x, y]);
  const isCore = (x, y, w, h) => {
    if (mode === 0) return false;
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const moduleX = ((centerX % 6) + 6) % 6;
    const moduleY = ((centerY % 6) + 6) % 6;
    return moduleX >= 2 && moduleX < 4 && moduleY >= 2 && moduleY < 4;
  };

  const cells = calc.cells.map((cell) => {
    const x = geom.xStarts[cell.c];
    const y = geom.yStarts[cell.r];
    const w = halfToM(cell.widthHalf);
    const h = calc.rows.slice(cell.r, cell.r + cell.rowSpan).reduce((sum, row) => sum + halfToM(row), 0);
    const core = isCore(x, y, w, h);
    const fill = core ? "#aee4ea" : cell.type >= 4 ? "#e7edf2" : "#ffffff";
    const label = core ? `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" fill="#ef1f28" font-size="${microFont}" font-weight="500">KERN</text>` : "";
    const rotated = cell.type >= 4 ? `<text x="${x + w / 2}" y="${y + h - 0.12 * scale}" text-anchor="middle" fill="#666" font-size="${microFont}">gedreht</text>` : "";
    rememberFoot(x, y);
    rememberFoot(x + w, y);
    rememberFoot(x, y + h);
    rememberFoot(x + w, y + h);
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="#111" stroke-width="${stroke}"></rect>${label}${rotated}</g>`;
  }).join("");

  const foots = [...footPoints.values()]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="#050505"></circle>`)
    .join("");

  const axes = geom.xStarts.map((x, index) => {
    const w = halfToM(calc.cols[index]);
    return `<text x="${x + w / 2}" y="${-0.18 * scale}" text-anchor="middle" fill="#555" font-size="${microFont}">${axisLabel(index, calc.cols.length)}</text>`;
  }).join("") + geom.yStarts.map((y, index) => {
    const h = halfToM(calc.rows[index]);
    return `<text x="${geom.width + 0.16 * scale}" y="${y + h / 2 + 0.03 * scale}" fill="#555" font-size="${microFont}">${index + 1}</text>`;
  }).join("");

  const dimension = `<g fill="#222" stroke="#222" stroke-width="${stroke}" font-size="${smallFont}">
    <line x1="0" y1="${-0.46 * scale}" x2="${geom.width}" y2="${-0.46 * scale}"></line>
    <line x1="0" y1="${-0.56 * scale}" x2="0" y2="${-0.36 * scale}"></line>
    <line x1="${geom.width}" y1="${-0.56 * scale}" x2="${geom.width}" y2="${-0.36 * scale}"></line>
    <text x="${geom.width / 2}" y="${-0.58 * scale}" text-anchor="middle">Breite ${fmt(geom.width)} m</text>
    <line x1="${-0.46 * scale}" y1="0" x2="${-0.46 * scale}" y2="${geom.depth}"></line>
    <line x1="${-0.56 * scale}" y1="0" x2="${-0.36 * scale}" y2="0"></line>
    <line x1="${-0.56 * scale}" y1="${geom.depth}" x2="${-0.36 * scale}" y2="${geom.depth}"></line>
    <text x="${-0.62 * scale}" y="${geom.depth / 2}" transform="rotate(-90 ${-0.62 * scale} ${geom.depth / 2})" text-anchor="middle">Tiefe ${fmt(geom.depth)} m</text>
  </g>`;

  const startCell = calc.cells.find((cell) => geom.yStarts[cell.r] === 0 && Math.abs(geom.xStarts[cell.c] + halfToM(cell.widthHalf) - geom.width) < 0.001);
  const start = startCell ? (() => {
    const x = geom.xStarts[startCell.c];
    const y = geom.yStarts[startCell.r];
    return `<text x="${x + halfToM(startCell.widthHalf) / 2}" y="${y + 0.42 * scale}" text-anchor="middle" fill="#555" font-size="${smallFont}">START</text>`;
  })() : "";

  const redArrows = [];
  if (mode > 0) {
    for (let moduleX = 0; moduleX < geom.width; moduleX += 6) {
      for (let rowIndex = 0; rowIndex < geom.yStarts.length; rowIndex += 1) {
        const y = geom.yStarts[rowIndex] + halfToM(calc.rows[rowIndex]) / 2;
        const left = Math.min(moduleX + 2.04, geom.width - 0.18);
        const right = Math.min(moduleX + 3.72, geom.width - 0.12);
        if (right - left > 0.45 && y > 0.08 && y < geom.depth - 0.08) {
          const reverse = rowIndex % 3 === 1;
          redArrows.push(`<line x1="${reverse ? right : left}" y1="${y}" x2="${reverse ? left : right}" y2="${y}" marker-end="url(#redArrow)"></line>`);
        }
      }
      for (let moduleY = 0; moduleY < geom.depth; moduleY += 6) {
        const x = Math.min(moduleX + 3.92, geom.width - 0.12);
        const top = Math.min(moduleY + 2.04, geom.depth - 0.2);
        const bottom = Math.min(moduleY + 3.72, geom.depth - 0.12);
        if (x > 0.08 && bottom - top > 0.45) {
          redArrows.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" marker-end="url(#redArrow)"></line>`);
        }
      }
    }
  }

  const horizontalBracing = mode === 2 ? `<g stroke="#00a86b" stroke-width="${greenStroke}" fill="none">
    ${geom.xEdges.slice(1, -1).map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="${geom.depth}"></line>`).join("")}
    ${geom.yEdges.slice(1, -1).map((y) => `<line x1="0" y1="${y}" x2="${geom.width}" y2="${y}"></line>`).join("")}
  </g>` : "";

  const rails = [];
  if (state.rails.hinten) rails.push(`<line x1="0" y1="0" x2="${geom.width}" y2="0"></line>`);
  if (state.rails.vorne) rails.push(`<line x1="0" y1="${geom.depth}" x2="${geom.width}" y2="${geom.depth}"></line>`);
  if (state.rails.links) rails.push(`<line x1="0" y1="0" x2="0" y2="${geom.depth}"></line>`);
  if (state.rails.rechts) rails.push(`<line x1="${geom.width}" y1="0" x2="${geom.width}" y2="${geom.depth}"></line>`);
  const railLines = rails.length ? `<g stroke="#ed8b1a" stroke-width="${railStroke}" stroke-linecap="round">${rails.join("")}</g>` : "";

  const selectedRailsLabel = selectedRails ? `<text x="${geom.width / 2}" y="${geom.depth + 0.48 * scale}" text-anchor="middle" fill="#ed8b1a" font-size="${smallFont}" font-weight="700">Geländer markiert</text>` : "";
  const bracingText = xmlEscape(bracingModeLabel(mode));

  return `<svg id="stageSvg" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Technische Zeichnung ${fmt(geom.width)} mal ${fmt(geom.depth)} Meter" preserveAspectRatio="xMidYMid meet">
    <defs>
      <marker id="redArrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef1f28"></path>
      </marker>
    </defs>
    <rect x="${viewX}" y="${viewY}" width="${viewWidth}" height="${viewHeight}" fill="#fff"></rect>
    <text x="0" y="${-0.76 * scale}" fill="#2f6ecb" font-size="${font}" font-weight="700">Bühne</text>
    <text x="${geom.width}" y="${-0.76 * scale}" text-anchor="end" fill="#222" font-size="${smallFont}" font-weight="700">${bracingText}</text>
    ${dimension}
    <g>${cells}</g>
    ${horizontalBracing}
    <g stroke="#ef1f28" stroke-width="${arrowStroke}" fill="none">${redArrows.join("")}</g>
    ${railLines}
    ${foots}
    ${axes}
    ${start}
    <g stroke="#ef1f28" stroke-width="${stroke}" stroke-dasharray="${0.05 * scale} ${0.04 * scale}" fill="none">
      <line x1="${geom.width}" y1="0" x2="${geom.width + 0.45 * scale}" y2="${-0.36 * scale}"></line>
      <line x1="${geom.width - 0.05 * scale}" y1="${0.22 * scale}" x2="${geom.width + 0.45 * scale}" y2="${-0.36 * scale}"></line>
    </g>
    <text x="${geom.width + 0.48 * scale}" y="${-0.38 * scale}" fill="#ef1f28" font-size="${smallFont}">Feder</text>
    <g stroke="#555" stroke-width="${stroke}" stroke-dasharray="${0.05 * scale} ${0.04 * scale}" fill="none">
      <line x1="0" y1="${geom.depth}" x2="${-0.46 * scale}" y2="${geom.depth + 0.34 * scale}"></line>
      <line x1="${0.18 * scale}" y1="${geom.depth - 0.12 * scale}" x2="${-0.46 * scale}" y2="${geom.depth + 0.34 * scale}"></line>
    </g>
    <text x="${-0.58 * scale}" y="${geom.depth + 0.43 * scale}" fill="#555" font-size="${smallFont}">Nut</text>
    ${selectedRailsLabel}
    <text x="${geom.width + 0.35 * scale}" y="${geom.depth / 2}" transform="rotate(90 ${geom.width + 0.35 * scale} ${geom.depth / 2})" text-anchor="middle" fill="#555" font-size="${microFont}">Achse</text>
    <rect x="0" y="0" width="${geom.width}" height="${geom.depth}" fill="none" stroke="#111" stroke-width="${outlineStroke}"></rect>
  </svg>`;
}

function renderPlan(calc) {
  $("plan").innerHTML = technicalPlanSvg(calc, false);
  const tags = [
    { label: "Technische Zeichnung", color: "#111" },
    { label: "Fußpositionen", color: "#111" },
    { label: "Nut/Feder-Markierung", color: "#ef1f28" }
  ];
  if (calc.data[7] > 0) tags.push({ label: "Diagonalverstrebung", color: "#ef1f28" });
  if (calc.data[7] === 2) tags.push({ label: "Horizontalverstrebung", color: "#00a86b" });
  if (Object.values(state.rails).some(Boolean)) tags.push({ label: "Geländer", color: "#ed8b1a" });
  if (calc.cells.some((cell) => cell.type >= 4)) tags.push({ label: "gedrehte Podeste", color: "#6b7280" });
  $("legend").innerHTML = tags.map((tag) => `<span class="tag" style="color:${tag.color}">${tag.label}</span>`).join("");
}

function renderMetrics(calc) {
  const metrics = [
    ["Bühnengröße", `${fmtHalf(state.widthHalf)} × ${fmtHalf(state.depthHalf)} m`, `${fmt(calc.data[2] / 4)} m²`],
    ["Podeste", calc.data[5], "Systempodeste"],
    ["Füße gesamt", calc.data[6], "nach 4-2-2-1"],
    ["Raster", `${calc.data[3]} × ${calc.data[4]}`, "Spalten × Reihen"]
  ];
  $("metrics").innerHTML = metrics.map((metric) => `<div class="metric"><small>${metric[0]}</small><strong>${metric[1]}</strong><span>${metric[2]}</span></div>`).join("");
  const mode = calc.data[7];
  const diagonalLength = calc.data[26];
  const smallStage = calc.data[27] === 1;
  $("bracing").className = `alert ${mode > 0 ? "warn" : ""}`;
  if (mode === 0) {
    $("bracing").textContent = "Nivtec 2.1: Keine Verstrebung erforderlich (<80 cm).";
  } else if (mode === 1) {
    $("bracing").textContent = `Nivtec 2.2: Diagonalverstrebung nach Aufbauschema erforderlich, Diagonale ${diagonalLength} mm.${smallStage ? " Kleinbühne: zusätzliche Innendiagonalen prüfen." : ""}`;
  } else if (mode === 2) {
    $("bracing").textContent = `Nivtec 2.3: Horizontal- und Diagonalverstrebung nach Aufbauschema erforderlich, Diagonale ${diagonalLength} mm. Keine pauschale Stückzahlfreigabe.`;
  } else {
    $("bracing").textContent = "Höhe >200 cm: außerhalb dieses Regelabschnitts, separate Statik/Herstellerfreigabe nötig.";
  }
}

function renderRails() {
  document.querySelectorAll("[data-rail]").forEach((button) => button.classList.toggle("active", state.rails[button.dataset.rail]));
  $("miniStage").textContent = `${fmtHalf(state.widthHalf)} × ${fmtHalf(state.depthHalf)} m`;
}

function renderMaterials(calc) {
  let currentGroup = 0;
  const rows = [];
  for (const item of calc.materials) {
    if (item.group !== currentGroup) {
      currentGroup = item.group;
      rows.push(`<tr class="groupRow"><td colspan="5">${groupNames[item.group]}</td></tr>`);
    }
    rows.push(`<tr><td>${item.pos}</td><td>${articleText(item.article, item.artCode)}</td><td>${artNumber(item.article, item.artCode)}</td><td>${item.qty}</td><td>${unitNames[item.unit] || "Stk."}</td></tr>`);
  }
  $("materials").innerHTML = rows.join("");
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  $("themeButton").textContent = state.theme === "light" ? "Dunkel" : "Hell";
  lastCalc = calculate();
  renderDimensions(lastCalc);
  renderOrientation(lastCalc);
  renderHeight(lastCalc);
  renderSpecial(lastCalc);
  renderPlan(lastCalc);
  renderMetrics(lastCalc);
  renderRails();
  renderMaterials(lastCalc);
}

function csvText() {
  const header = ["Pos", "Artikel", "Nebensound-Art.-Nr.", "Menge", "Einheit", "Gruppe"];
  const rows = lastCalc.materials.map((item) => [item.pos, articleText(item.article, item.artCode), artNumber(item.article, item.artCode), item.qty, unitNames[item.unit] || "Stk.", groupNames[item.group]]);
  return [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\n");
}

function triggerDownload(name, url) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function exportCsv() {
  triggerDownload(`nivtec-material-${fmtHalf(state.widthHalf)}x${fmtHalf(state.depthHalf)}m.csv`, `data:text/csv;charset=utf-8,${encodeURIComponent(`\ufeff${csvText()}`)}`);
}

function triggerBlobDownload(name, blob) {
  const url = URL.createObjectURL(blob);
  triggerDownload(name, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rasterizePlan(type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    const xml = technicalPlanSvg(lastCalc, true);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1800;
      canvas.height = 1272;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas konnte nicht erstellt werden."));
        return;
      }
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL(type, quality), width: canvas.width, height: canvas.height });
    };
    image.onerror = () => reject(new Error("Zeichnung konnte nicht gerastert werden."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  });
}

async function exportPng() {
  const image = await rasterizePlan("image/png");
  triggerDownload(`nivtec-plan-${fmtHalf(state.widthHalf)}x${fmtHalf(state.depthHalf)}m.png`, image.dataUrl);
}

function bytesFromDataUrl(dataUrl) {
  const raw = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

function pdfNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

function pdfTextValue(value) {
  let hex = "FEFF";
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hex += text.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
  }
  return `<${hex}>`;
}

function pdfText(x, y, size, text, color = "0 0 0") {
  return `${color} rg BT /F1 ${pdfNumber(size)} Tf 1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm ${pdfTextValue(text)} Tj ET\n`;
}

function pdfRect(x, y, width, height, color) {
  return `${color} rg ${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(width)} ${pdfNumber(height)} re f\n`;
}

function pdfLine(x1, y1, x2, y2, color = "0.82 0.82 0.82", width = 0.5) {
  return `${color} RG ${pdfNumber(width)} w ${pdfNumber(x1)} ${pdfNumber(y1)} m ${pdfNumber(x2)} ${pdfNumber(y2)} l S\n`;
}

function trimForPdf(value, maxLength) {
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function pdfMaterialRows() {
  const rows = [];
  let currentGroup = 0;
  for (const item of lastCalc.materials) {
    if (item.group !== currentGroup) {
      currentGroup = item.group;
      rows.push({ type: "group", label: groupNames[item.group] });
    }
    rows.push({
      type: "item",
      pos: item.pos,
      article: articleText(item.article, item.artCode),
      number: artNumber(item.article, item.artCode),
      qty: item.qty,
      unit: unitNames[item.unit] || "Stk."
    });
  }
  return rows;
}

function pdfTableHeader(y) {
  let content = pdfRect(30, y - 18, 535, 18, "0.929 0.545 0.102");
  content += pdfText(36, y - 12, 8, "Pos.", "1 1 1");
  content += pdfText(66, y - 12, 8, "Artikel", "1 1 1");
  content += pdfText(318, y - 12, 8, "Nebensound-Art.-Nr.", "1 1 1");
  content += pdfText(456, y - 12, 8, "Menge", "1 1 1");
  content += pdfText(512, y - 12, 8, "Einheit", "1 1 1");
  return content;
}

function pdfTableRow(row, y) {
  if (row.type === "group") {
    let content = pdfRect(30, y - 16, 535, 16, "0.98 0.91 0.82");
    content += pdfText(36, y - 11, 8, row.label, "0.45 0.23 0");
    return { content, height: 18 };
  }
  let content = pdfLine(30, y - 18, 565, y - 18);
  content += pdfText(36, y - 12, 8, row.pos);
  content += pdfText(66, y - 12, 8, trimForPdf(row.article, 46));
  content += pdfText(318, y - 12, 8, trimForPdf(row.number, 25));
  content += pdfText(456, y - 12, 8, row.qty);
  content += pdfText(512, y - 12, 8, row.unit);
  return { content, height: 20 };
}

function appendPdfTableRows(content, rows, startIndex, startY, bottomY) {
  let y = startY;
  let index = startIndex;
  content += pdfTableHeader(y);
  y -= 24;
  while (index < rows.length) {
    const row = pdfTableRow(rows[index], y);
    if (y - row.height < bottomY) break;
    content += row.content;
    y -= row.height;
    index += 1;
  }
  return { content, index };
}

function createPdfPageContents(image) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const rows = pdfMaterialRows();
  const contents = [];
  let rowIndex = 0;
  let firstPage = true;

  while (firstPage || rowIndex < rows.length) {
    let content = pdfRect(0, 0, pageWidth, pageHeight, "1 1 1");
    content += pdfRect(30, 811, 84, 3, "0.929 0.545 0.102");
    content += pdfText(30, 790, 18, "Nivtec Bühnenplan");
    content += pdfText(30, 770, 10, `${fmtHalf(state.widthHalf)} × ${fmtHalf(state.depthHalf)} m · Höhe ${state.height} cm · ${state.footType === 0 ? "Steckfuß" : "Spindelfuß"}`, "0.25 0.25 0.25");

    let tableStartY = 735;
    if (firstPage) {
      const imageWidth = 535;
      const imageHeight = Math.min(378, imageWidth * image.height / image.width);
      const imageY = 744 - imageHeight;
      content += `q ${pdfNumber(imageWidth)} 0 0 ${pdfNumber(imageHeight)} 30 ${pdfNumber(imageY)} cm /Plan Do Q\n`;
      content += pdfText(30, imageY - 21, 11, "Materialliste");
      tableStartY = imageY - 36;
    } else {
      content += pdfText(30, 747, 11, "Materialliste · Fortsetzung");
    }

    const result = appendPdfTableRows(content, rows, rowIndex, tableStartY, 36);
    contents.push(result.content);
    rowIndex = result.index;
    firstPage = false;
  }

  return contents;
}

function pdfStream(content) {
  const bytes = new TextEncoder().encode(content);
  return [`<< /Length ${bytes.length} >>\nstream\n`, bytes, "\nendstream"];
}

function buildPdf(objects) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let byteOffset = 0;
  const append = (part) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    byteOffset += bytes.length;
  };

  append("%PDF-1.4\n%âãÏÓ\n");
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = byteOffset;
    append(`${id} 0 obj\n`);
    const object = objects[id];
    if (Array.isArray(object)) {
      object.forEach(append);
    } else {
      append(object);
    }
    append("\nendobj\n");
  }

  const xrefOffset = byteOffset;
  append(`xref\n0 ${objects.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < objects.length; id += 1) {
    append(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  append(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob(chunks, { type: "application/pdf" });
}

async function exportPdf() {
  const image = await rasterizePlan("image/jpeg", 0.94);
  const imageBytes = bytesFromDataUrl(image.dataUrl);
  const pageContents = createPdfPageContents(image);
  const objects = [];
  const pageIds = pageContents.map((_, index) => 5 + index * 2);
  const contentIds = pageContents.map((_, index) => 6 + index * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = [`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`, imageBytes, "\nendstream"];

  pageContents.forEach((content, index) => {
    const pageId = pageIds[index];
    const contentId = contentIds[index];
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R >> /XObject << /Plan 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = pdfStream(content);
  });

  triggerBlobDownload(`nivtec-plan-${fmtHalf(state.widthHalf)}x${fmtHalf(state.depthHalf)}m.pdf`, buildPdf(objects));
}

function prepareMail() {
  const body = [
    "Anfrage über den Nivtec Bühnenplaner",
    "",
    `Größe: ${fmtHalf(state.widthHalf)} × ${fmtHalf(state.depthHalf)} m`,
    `Höhe: ${state.height} cm`,
    `Fußtyp: ${state.footType === 0 ? "Steckfuß fest" : "Steckfuß mit Layher-Verstellspindel"}`,
    "",
    "Materialliste:",
    ...lastCalc.materials.map((item) => `${item.pos}. ${articleText(item.article, item.artCode)} (${artNumber(item.article, item.artCode)}) — ${item.qty} ${unitNames[item.unit] || "Stk."}`)
  ].join("\n");
  window.location.href = `mailto:info@nebensound.com?subject=${encodeURIComponent(`Bühnenanfrage ${fmtHalf(state.widthHalf)}×${fmtHalf(state.depthHalf)} m`)}&body=${encodeURIComponent(body)}`;
}

function bindEvents() {
  $("widthRange").addEventListener("input", (event) => updateDimension("width", event.target.value));
  $("depthRange").addEventListener("input", (event) => updateDimension("depth", event.target.value));
  $("widthInput").addEventListener("input", (event) => updateDimension("width", event.target.value));
  $("depthInput").addEventListener("input", (event) => updateDimension("depth", event.target.value));
  document.querySelectorAll("[data-foot]").forEach((button) => {
    button.addEventListener("click", () => {
      state.footType = Number(button.dataset.foot);
      if (state.footType === 0) state.height = [20, 40, 60, 80, 100, 120].reduce((best, value) => Math.abs(value - state.height) < Math.abs(best - state.height) ? value : best, 20);
      if (state.footType === 1 && state.height < 20) state.height = 20;
      render();
    });
  });
  $("specialToggle").addEventListener("change", (event) => {
    state.special = event.target.checked;
    render();
  });
  document.querySelectorAll("[data-rail]").forEach((button) => {
    button.addEventListener("click", () => {
      state.rails[button.dataset.rail] = !state.rails[button.dataset.rail];
      render();
    });
  });
  $("themeButton").addEventListener("click", () => {
    state.theme = state.theme === "light" ? "dark" : "light";
    localStorage.setItem("nivtec-theme", state.theme);
    localStorage.removeItem("nivtec-rust-theme");
    render();
  });
  $("csvButton").addEventListener("click", exportCsv);
  $("csvButtonTop").addEventListener("click", exportCsv);
  $("pdfButton").addEventListener("click", exportPdf);
  $("pdfButtonTop").addEventListener("click", exportPdf);
  $("pngButton").addEventListener("click", exportPng);
  $("mailButton").addEventListener("click", prepareMail);
  $("mailButtonTop").addEventListener("click", prepareMail);
}

try {
  await initWasm();
  bindEvents();
  syncRecommended();
  render();
} catch (error) {
  document.body.innerHTML = `<main class="app"><section class="hero"><div><div class="pill">Fehler</div><h1>WASM konnte nicht geladen werden.</h1><p>${error.message}</p></div></section></main>`;
  throw error;
}
