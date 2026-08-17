/* ==========================================================================
   BOOL( ) CIRCUIT — application logic
   Sections:
   1. Constants & theme / footer / panel wiring
   2. Truth-table input panel builder
   3. Expression parser (tokenizer + recursive-descent, postfix ' and !/~ NOT)
   4. Quine–McCluskey simplification (essential PIs + greedy cover for the rest)
   5. Gate trees: SOP tree -> NAND-only / NOR-only via De Morgan substitution
   6. Circuit diagram layout & SVG rendering (theme-aware, uses CSS vars)
   7. Reading each input mode into a truth vector
   8. Rendering results + verification
   9. Main "generate" handler & event wiring
   ========================================================================== */

const VARNAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

/* -------------------------------------------------------------------------
   1. Theme / footer / panel wiring
   ------------------------------------------------------------------------- */

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const label = document.getElementById('theme-toggle-label');
  if (label) label.textContent = theme === 'dark' ? 'Dark' : 'Light';
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.setAttribute('aria-pressed', theme === 'light');
  try { localStorage.setItem('bool-circuit-theme', theme); } catch (e) { /* ignore storage errors */ }
}

function showPanel(type) {
  document.querySelectorAll('.input-panel').forEach(p => {
    p.classList.toggle('is-hidden', p.dataset.panel !== type);
  });
}

/* -------------------------------------------------------------------------
   2. Truth-table input panel builder (regenerated when var count changes)
   ------------------------------------------------------------------------- */

function buildTruthTableInputPanel(numVars) {
  const varNames = VARNAMES.slice(0, numVars);
  const table = document.getElementById('truth-table-input');
  if (!table) return;

  const theadRow = table.querySelector('thead tr');
  theadRow.innerHTML = varNames.map(v => `<th scope="col">${v}</th>`).join('') +
    `<th scope="col" class="th-output">F</th>`;

  const tbody = table.querySelector('tbody');
  const total = 1 << numVars;
  let html = '';
  for (let i = 0; i < total; i++) {
    const bits = i.toString(2).padStart(numVars, '0');
    // Allocate the whole row to be clickable with .tt-row
    html += `<tr class="tt-row" data-index="${i}">` + bits.split('').map(b => `<td>${b}</td>`).join('') +
      `<td><button type="button" class="cell-toggle" data-val="0" aria-label="Output for row ${i}">0</button></td></tr>`;
  }
  tbody.innerHTML = html;
}

/* -------------------------------------------------------------------------
   3. Expression parser
   Grammar:
     Expression := Term ('+' Term)*
     Term       := Factor ( ('.' )? Factor )*        (implicit AND)
     Factor     := Primary ("'")*                     (postfix NOT)
     Primary    := ('!'|'~') Primary | VAR | '(' Expression ')'
   AST nodes all use a uniform shape: { type, inputs: [...] } (VAR also has .name)
   ------------------------------------------------------------------------- */

function tokenizeExpression(str) {
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z]/.test(c)) { tokens.push({ type: 'VAR', value: c.toUpperCase() }); i++; continue; }
    if (c === "'") { tokens.push({ type: 'NOT' }); i++; continue; }
    if (c === '.' || c === '*') { tokens.push({ type: 'AND' }); i++; continue; }
    if (c === '+') { tokens.push({ type: 'OR' }); i++; continue; }
    if (c === '!' || c === '~') { tokens.push({ type: 'NOTPRE' }); i++; continue; }
    if (c === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
    throw new Error(`Unexpected character "${c}" in expression.`);
  }
  return tokens;
}

class ExprParser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  peek() { return this.tokens[this.pos]; }
  consume() { return this.tokens[this.pos++]; }

  parseExpression() {
    let node = this.parseTerm();
    while (this.peek() && this.peek().type === 'OR') {
      this.consume();
      const right = this.parseTerm();
      node = { type: 'OR', inputs: [node, right] };
    }
    return node;
  }

  parseTerm() {
    let node = this.parseFactor();
    while (this.peek() && ['AND', 'VAR', 'LPAREN', 'NOTPRE'].includes(this.peek().type)) {
      if (this.peek().type === 'AND') this.consume();
      const right = this.parseFactor();
      node = { type: 'AND', inputs: [node, right] };
    }
    return node;
  }

  parseFactor() {
    let node = this.parsePrimary();
    while (this.peek() && this.peek().type === 'NOT') {
      this.consume();
      node = { type: 'NOT', inputs: [node] };
    }
    return node;
  }

  parsePrimary() {
    const tok = this.peek();
    if (!tok) throw new Error('Unexpected end of expression — check for a missing variable or parenthesis.');
    if (tok.type === 'NOTPRE') {
      this.consume();
      return { type: 'NOT', inputs: [this.parsePrimary()] };
    }
    if (tok.type === 'VAR') {
      this.consume();
      return { type: 'VAR', name: tok.value, inputs: [] };
    }
    if (tok.type === 'LPAREN') {
      this.consume();
      const node = this.parseExpression();
      if (!this.peek() || this.peek().type !== 'RPAREN') throw new Error('Missing closing parenthesis ")".');
      this.consume();
      return node;
    }
    throw new Error('Unexpected symbol in expression — check your syntax.');
  }
}

function parseExpressionString(raw) {
  const tokens = tokenizeExpression(raw);
  if (tokens.length === 0) throw new Error('Please enter a Boolean expression.');
  const parser = new ExprParser(tokens);
  const ast = parser.parseExpression();
  if (parser.pos < tokens.length) throw new Error('Could not fully parse the expression — check your syntax.');
  return ast;
}

function collectVars(node, set) {
  if (node.type === 'VAR') { set.add(node.name); return; }
  node.inputs.forEach(c => collectVars(c, set));
}

/* Universal evaluator — works for expression ASTs (VAR/NOT/AND/OR) and for
   the gate trees built later (which add CONST0/CONST1/NAND/NOR). */
function evalNode(node, assign) {
  switch (node.type) {
    case 'VAR': return assign[node.name];
    case 'CONST0': return 0;
    case 'CONST1': return 1;
    case 'NOT': return evalNode(node.inputs[0], assign) ? 0 : 1;
    case 'AND': return (evalNode(node.inputs[0], assign) && evalNode(node.inputs[1], assign)) ? 1 : 0;
    case 'OR': return (evalNode(node.inputs[0], assign) || evalNode(node.inputs[1], assign)) ? 1 : 0;
    case 'NAND': return (evalNode(node.inputs[0], assign) && evalNode(node.inputs[1], assign)) ? 0 : 1;
    case 'NOR': return (evalNode(node.inputs[0], assign) || evalNode(node.inputs[1], assign)) ? 0 : 1;
    default: throw new Error('Unknown node type: ' + node.type);
  }
}

function allAssignments(numVars, varNames) {
  const rows = [];
  const total = 1 << numVars;
  for (let i = 0; i < total; i++) {
    const bits = i.toString(2).padStart(numVars, '0');
    const assign = {};
    for (let v = 0; v < numVars; v++) assign[varNames[v]] = bits[v] === '1' ? 1 : 0;
    rows.push(assign);
  }
  return rows;
}

/* -------------------------------------------------------------------------
   4. Quine–McCluskey simplification
   ------------------------------------------------------------------------- */

function combineBits(a, b) {
  let diffPos = -1, diffCount = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      diffCount++;
      diffPos = i;
      if (diffCount > 1) return null;
    }
  }
  if (diffCount !== 1) return null;
  return a.slice(0, diffPos) + '-' + a.slice(diffPos + 1);
}

function getPrimeImplicants(indices, numVars) {
  let current = indices.map(m => ({ bin: m.toString(2).padStart(numVars, '0'), covers: new Set([m]) }));
  const allPIsMap = new Map();

  while (current.length > 0) {
    const combinedMap = new Map();
    const usedIdx = new Set();

    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const combinedBin = combineBits(current[i].bin, current[j].bin);
        if (combinedBin === null) continue;
        usedIdx.add(i); usedIdx.add(j);
        const covers = new Set([...current[i].covers, ...current[j].covers]);
        if (combinedMap.has(combinedBin)) {
          covers.forEach(c => combinedMap.get(combinedBin).covers.add(c));
        } else {
          combinedMap.set(combinedBin, { bin: combinedBin, covers });
        }
      }
    }

    current.forEach((t, i) => { if (!usedIdx.has(i)) allPIsMap.set(t.bin, t); });
    current = Array.from(combinedMap.values());
  }

  return Array.from(allPIsMap.values());
}

/* Essential PIs first, then a greedy cover for whatever minterms remain.
   (Greedy, not full Petrick's method — gives a minimal-in-practice, always
   correct cover, which is what matters for a verified circuit.) */
function selectEssentialPIs(minterms, dontCares, allPIs) {
  const targets = minterms.filter(m => !dontCares.includes(m));
  if (targets.length === 0) return [];

  const coverMap = new Map();
  targets.forEach(m => coverMap.set(m, []));
  allPIs.forEach((pi, idx) => {
    pi.covers.forEach(c => { if (coverMap.has(c)) coverMap.get(c).push(idx); });
  });

  const selected = new Set();
  targets.forEach(m => {
    const coveringIdx = coverMap.get(m);
    if (coveringIdx.length === 1) selected.add(coveringIdx[0]);
  });

  const covered = new Set();
  selected.forEach(idx => allPIs[idx].covers.forEach(c => { if (targets.includes(c)) covered.add(c); }));

  let remaining = targets.filter(m => !covered.has(m));
  while (remaining.length > 0) {
    let bestIdx = -1, bestCount = -1;
    allPIs.forEach((pi, idx) => {
      if (selected.has(idx)) return;
      const count = remaining.filter(m => pi.covers.has(m)).length;
      if (count > bestCount) { bestCount = count; bestIdx = idx; }
    });
    if (bestIdx === -1 || bestCount <= 0) break;
    selected.add(bestIdx);
    remaining = remaining.filter(m => !allPIs[bestIdx].covers.has(m));
  }

  return Array.from(selected).map(idx => allPIs[idx]);
}

function piTermsToExpression(binList, varNames) {
  if (binList.length === 0) return '0';
  if (binList.some(b => [...b].every(ch => ch === '-'))) return '1';
  const terms = binList.map(bin => {
    let term = '';
    for (let i = 0; i < bin.length; i++) {
      if (bin[i] === '1') term += varNames[i];
      else if (bin[i] === '0') term += varNames[i] + "'";
    }
    return term;
  });
  return terms.join(' + ');
}

/* -------------------------------------------------------------------------
   5. Gate trees: SOP tree, then NAND-only / NOR-only via De Morgan
   ------------------------------------------------------------------------- */

function buildTreeFromPIs(piTerms, varNames) {
  if (piTerms.length === 0) return { type: 'CONST0', inputs: [] };
  const termNodes = piTerms.map(bin => {
    const literals = [];
    for (let i = 0; i < bin.length; i++) {
      if (bin[i] === '1') literals.push({ type: 'VAR', name: varNames[i], inputs: [] });
      else if (bin[i] === '0') literals.push({ type: 'NOT', inputs: [{ type: 'VAR', name: varNames[i], inputs: [] }] });
    }
    if (literals.length === 0) return { type: 'CONST1', inputs: [] };
    return literals.reduce((acc, lit) => acc ? { type: 'AND', inputs: [acc, lit] } : lit, null);
  });
  return termNodes.reduce((acc, t) => acc ? { type: 'OR', inputs: [acc, t] } : t, null);
}

function cloneLeaf(node) {
  if (node.type === 'VAR') return { type: 'VAR', name: node.name, inputs: [] };
  return { type: node.type, inputs: [] };
}

// Helper to prevent O(2^N) exponential tree generation when tying inputs together
function deepCloneNode(node) {
  if (!node) return null;
  return { ...node, inputs: node.inputs.map(deepCloneNode) };
}

function toNANDTree(node) {
  if (node.inputs.length === 0) return cloneLeaf(node);

  // Evaluate children ONCE per layer
  const left = node.inputs[0] ? toNANDTree(node.inputs[0]) : null;
  const right = node.inputs[1] ? toNANDTree(node.inputs[1]) : null;

  if (node.type === 'NOT') {
    return { type: 'NAND', inputs: [left, deepCloneNode(left)] };
  }
  if (node.type === 'AND') {
    const inner = { type: 'NAND', inputs: [left, right] };
    return { type: 'NAND', inputs: [inner, deepCloneNode(inner)] };
  }
  if (node.type === 'OR') {
    const notLeft = { type: 'NAND', inputs: [left, deepCloneNode(left)] };
    const notRight = { type: 'NAND', inputs: [right, deepCloneNode(right)] };
    return { type: 'NAND', inputs: [notLeft, notRight] };
  }
  throw new Error('Unsupported node in NAND conversion: ' + node.type);
}

function toNORTree(node) {
  if (node.inputs.length === 0) return cloneLeaf(node);

  const left = node.inputs[0] ? toNORTree(node.inputs[0]) : null;
  const right = node.inputs[1] ? toNORTree(node.inputs[1]) : null;

  if (node.type === 'NOT') {
    return { type: 'NOR', inputs: [left, deepCloneNode(left)] };
  }
  if (node.type === 'OR') {
    const inner = { type: 'NOR', inputs: [left, right] };
    return { type: 'NOR', inputs: [inner, deepCloneNode(inner)] };
  }
  if (node.type === 'AND') {
    const notLeft = { type: 'NOR', inputs: [left, deepCloneNode(left)] };
    const notRight = { type: 'NOR', inputs: [right, deepCloneNode(right)] };
    return { type: 'NOR', inputs: [notLeft, notRight] };
  }
  throw new Error('Unsupported node in NOR conversion: ' + node.type);
}

/* -------------------------------------------------------------------------
   6. Circuit diagram layout & SVG rendering
   ------------------------------------------------------------------------- */

const CIRCUIT_XSTEP = 160, CIRCUIT_YSTEP = 80, CIRCUIT_LEFT = 70, CIRCUIT_TOP = 40;

function layoutTree(root) {
  let leafIndex = 0;
  const allNodes = [];
  function visit(node) {
    if (node.inputs.length === 0) {
      node._level = 0;
      node._y = leafIndex * CIRCUIT_YSTEP;
      leafIndex++;
    } else {
      node.inputs.forEach(visit);
      node._level = Math.max(...node.inputs.map(n => n._level)) + 1;
      node._y = node.inputs.reduce((s, n) => s + n._y, 0) / node.inputs.length;
    }
    node._x = CIRCUIT_LEFT + node._level * CIRCUIT_XSTEP;
    node._y_px = CIRCUIT_TOP + node._y;
    allNodes.push(node);
  }
  visit(root);
  return allNodes;
}

function shapeFor(type) {
  const big = { w: 56, h: 44 };
  const small = { w: 40, h: 30 };
  switch (type) {
    case 'AND': return { ...big, outTip: big.w * 0.55 + big.h / 2, bubble: false, bubbleR: 0 };
    case 'NAND': return { ...big, outTip: big.w * 0.55 + big.h / 2, bubble: true, bubbleR: 5 };
    case 'OR': return { ...big, outTip: big.w * 0.62, bubble: false, bubbleR: 0 };
    case 'NOR': return { ...big, outTip: big.w * 0.62, bubble: true, bubbleR: 5 };
    case 'NOT': return { ...small, outTip: small.w * 0.75, bubble: true, bubbleR: 5 };
    default: throw new Error('Unknown gate type: ' + type);
  }
}

function drawGate(gx, gy, type) {
  const dims = shapeFor(type);
  const halfH = dims.h / 2;
  let path = '';
  if (type === 'AND' || type === 'NAND') {
    const straightW = dims.w * 0.55;
    path = `M${gx},${gy - halfH} H${gx + straightW} A${halfH},${halfH} 0 0 1 ${gx + straightW},${gy + halfH} H${gx} Z`;
  } else if (type === 'OR' || type === 'NOR') {
    path = `M${gx},${gy - halfH} Q${gx + dims.w * 0.4},${gy - halfH} ${gx + dims.w * 0.62},${gy} ` +
      `Q${gx + dims.w * 0.4},${gy + halfH} ${gx},${gy + halfH} Q${gx + dims.w * 0.18},${gy} ${gx},${gy - halfH} Z`;
  } else if (type === 'NOT') {
    path = `M${gx},${gy - halfH} L${gx + dims.w * 0.75},${gy} L${gx},${gy + halfH} Z`;
  }
  let svg = `<path d="${path}" class="gshape"/>`;
  if (dims.bubble) {
    svg += `<circle cx="${gx + dims.outTip + dims.bubbleR}" cy="${gy}" r="${dims.bubbleR}" class="gbubble"/>`;
  }
  return svg;
}

function buildCircuitSVG(root) {
  const nodes = layoutTree(root);
  const leafNodes = nodes.filter(n => n.inputs.length === 0);
  const gateNodes = nodes.filter(n => n.inputs.length > 0);

  const maxLevel = Math.max(...nodes.map(n => n._level));
  const width = CIRCUIT_LEFT + maxLevel * CIRCUIT_XSTEP + 170;
  const height = CIRCUIT_TOP * 2 + Math.max(leafNodes.length - 1, 0) * CIRCUIT_YSTEP + 20;

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="circuit-svg" role="img" aria-label="Logic circuit diagram">`;
  svg += `<style>
    .gwire{stroke:var(--ink-muted);stroke-width:1.6;fill:none;}
    .gshape{stroke:var(--ink);stroke-width:1.6;fill:var(--surface-raised);}
    .gbubble{stroke:var(--ink);stroke-width:1.6;fill:var(--surface);}
    .glabel{font-family:var(--font-mono);font-size:13px;fill:var(--ink);}
    .goutlabel{font-family:var(--font-mono);font-size:13px;fill:var(--accent);font-weight:600;}
  </style>`;

  leafNodes.forEach(n => {
    const label = n.type === 'VAR' ? n.name : (n.type === 'CONST0' ? '0' : '1');
    svg += `<text x="${n._x - 10}" y="${n._y_px + 5}" text-anchor="end" class="glabel">${label}</text>`;
    svg += `<line x1="${n._x}" y1="${n._y_px}" x2="${n._x + 20}" y2="${n._y_px}" class="gwire"/>`;
    n._outX = n._x + 20;
  });

  gateNodes.forEach(n => {
    const dims = shapeFor(n.type);
    const gx = n._x, gy = n._y_px;
    svg += drawGate(gx, gy, n.type);
    n._outX = gx + dims.outTip + (dims.bubble ? dims.bubbleR * 2 : 0);

    const inputYs = n.inputs.length === 2 ? [gy - 10, gy + 10] : [gy];
    n.inputs.forEach((child, idx) => {
      const py = inputYs[idx];
      const startX = child._outX, startY = child._y_px;
      const midX = (startX + gx) / 2;
      svg += `<path d="M${startX},${startY} H${midX} V${py} H${gx}" class="gwire"/>`;
    });
  });

  svg += `<line x1="${root._outX}" y1="${root._y_px}" x2="${root._outX + 30}" y2="${root._y_px}" class="gwire"/>`;
  svg += `<text x="${root._outX + 38}" y="${root._y_px + 5}" class="goutlabel">F</text>`;
  svg += `</svg>`;
  return svg;
}

/* -------------------------------------------------------------------------
   7. Reading each input mode into a truth vector
   ------------------------------------------------------------------------- */

function parseIndexList(str, maxExclusive, label) {
  if (!str || !str.trim()) return [];
  const parts = str.split(',').map(s => s.trim()).filter(s => s.length > 0);
  const nums = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) throw new Error(`Invalid ${label} value "${p}" — please use whole numbers.`);
    const n = parseInt(p, 10);
    if (n < 0 || n >= maxExclusive) throw new Error(`${label} value ${n} is out of range (0–${maxExclusive - 1}).`);
    nums.push(n);
  }
  return nums;
}

function checkOverlap(a, b) {
  const setB = new Set(b);
  const dup = a.find(x => setB.has(x));
  if (dup !== undefined) throw new Error(`Index ${dup} appears in both the term list and the don't-care list.`);
}

function readTruthTableInput(numVars) {
  // Target the new button element instead of text inputs
  const inputs = document.querySelectorAll('#truth-table-input tbody .cell-toggle');
  const total = 1 << numVars;
  if (inputs.length !== total) throw new Error('Truth table size mismatch — try reselecting the number of variables.');
  const vector = [];
  inputs.forEach((el, i) => {
    const v = el.dataset.val.toUpperCase();
    if (v === '0' || v === '1') vector.push(parseInt(v, 10));
    else if (v === 'X') vector.push('X');
    else throw new Error(`Row ${i} of the truth table needs a 0, 1, or X.`);
  });
  return vector;
}

function getFunctionFromInput(inputType, numVars, varNames) {
  const total = 1 << numVars;

  if (inputType === 'expression') {
    const raw = document.getElementById('expression-input').value.trim();
    if (!raw) throw new Error('Please enter a Boolean expression.');
    const ast = parseExpressionString(raw);
    const used = new Set();
    collectVars(ast, used);
    used.forEach(v => {
      if (!varNames.includes(v)) {
        throw new Error(`Variable "${v}" is not among the selected ${numVars} variable(s) (${varNames.join(', ')}).`);
      }
    });
    const rows = allAssignments(numVars, varNames);
    const truthVector = rows.map(r => evalNode(ast, r));
    const minterms = [];
    truthVector.forEach((v, i) => { if (v === 1) minterms.push(i); });
    return { truthVector, minterms, dontCares: [], originalEvalFn: (assign) => evalNode(ast, assign) };
  }

  if (inputType === 'truth-table') {
    const truthVector = readTruthTableInput(numVars);
    const minterms = [], dontCares = [];
    truthVector.forEach((v, i) => { if (v === 1) minterms.push(i); else if (v === 'X') dontCares.push(i); });
    return { truthVector, minterms, dontCares, originalEvalFn: null };
  }

  if (inputType === 'minterms') {
    const minterms = parseIndexList(document.getElementById('minterms-input').value, total, 'minterm');
    const dontCares = parseIndexList(document.getElementById('minterms-dontcare').value, total, "don't-care");
    if (minterms.length === 0) throw new Error('Enter at least one minterm.');
    checkOverlap(minterms, dontCares);
    const truthVector = new Array(total).fill(0);
    minterms.forEach(i => { truthVector[i] = 1; });
    dontCares.forEach(i => { truthVector[i] = 'X'; });
    return { truthVector, minterms: [...new Set(minterms)], dontCares: [...new Set(dontCares)], originalEvalFn: null };
  }

  if (inputType === 'maxterms') {
    const maxterms = parseIndexList(document.getElementById('maxterms-input').value, total, 'maxterm');
    const dontCares = parseIndexList(document.getElementById('maxterms-dontcare').value, total, "don't-care");
    if (maxterms.length === 0) throw new Error('Enter at least one maxterm.');
    checkOverlap(maxterms, dontCares);
    const truthVector = new Array(total).fill(1);
    maxterms.forEach(i => { truthVector[i] = 0; });
    dontCares.forEach(i => { truthVector[i] = 'X'; });
    const minterms = [];
    truthVector.forEach((v, i) => { if (v === 1) minterms.push(i); });
    return { truthVector, minterms, dontCares: [...new Set(dontCares)], originalEvalFn: null };
  }

  throw new Error('Unknown input type.');
}

/* -------------------------------------------------------------------------
   8. Rendering results + verification
   ------------------------------------------------------------------------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSimplifiedExpression(str) {
  document.querySelector('#result-expression .result-body').innerHTML =
    `<p class="mono-result">F = ${escapeHtml(str)}</p>`;
}

function renderTruthTable(vector, varNames, numVars) {
  const rows = allAssignments(numVars, varNames);
  let html = '<div class="table-scroll"><table class="truth-table"><thead><tr>';
  varNames.forEach(v => { html += `<th scope="col">${v}</th>`; });
  html += '<th scope="col" class="th-output">F</th></tr></thead><tbody>';
  rows.forEach((assign, i) => {
    html += '<tr>';
    varNames.forEach(v => { html += `<td>${assign[v]}</td>`; });
    const val = vector[i];
    html += `<td>${val === 'X' ? '<span class="cell-x">X</span>' : val}</td>`;
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  document.querySelector('#result-truth-table .result-body').innerHTML = html;
}

function renderCircuitInto(cardId, tree) {
  const container = document.querySelector(`#${cardId} .diagram-body`);
  container.innerHTML = buildCircuitSVG(tree);
}

function renderVerification(status, inputType) {
  const items = document.querySelectorAll('#result-verification .verify-item');
  const labels = inputType === 'expression'
    ? ['Original expression', 'Simplified expression', 'NAND-only circuit', 'NOR-only circuit']
    : ['Given input', 'Simplified expression', 'NAND-only circuit', 'NOR-only circuit'];
  const values = [status.origSelfMatch, status.simpMatch, status.nandMatch, status.norMatch];

  items.forEach((li, i) => {
    li.innerHTML = '<span class="verify-dot" aria-hidden="true"></span>' + labels[i];
    li.dataset.status = values[i] ? 'pass' : 'fail';
  });

  const summary = document.querySelector('#result-verification .placeholder-text');
  const allPass = values.every(Boolean);
  summary.textContent = allPass
    ? "All representations match on every input row (don't-cares excluded). ✓"
    : 'Mismatch detected — check the highlighted item(s) above.';
}

function showError(msg) {
  let banner = document.getElementById('error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'error-banner';
    banner.className = 'error-banner';
    const panel = document.getElementById('input-section');
    panel.parentNode.insertBefore(banner, panel);
  }
  banner.textContent = msg;
  banner.style.display = 'block';
}

function clearError() {
  const banner = document.getElementById('error-banner');
  if (banner) banner.style.display = 'none';
}

/* -------------------------------------------------------------------------
   9. Main "generate" handler & event wiring
   ------------------------------------------------------------------------- */

function generate() {
  clearError();
  try {
    const numVars = parseInt(document.getElementById('var-count').value, 10);
    const varNames = VARNAMES.slice(0, numVars);
    const inputType = document.getElementById('input-type').value;

    const { truthVector, minterms, dontCares, originalEvalFn } = getFunctionFromInput(inputType, numVars, varNames);
    const uniqueMinterms = [...new Set(minterms)];
    const uniqueDontCares = [...new Set(dontCares)];

    const allPIs = getPrimeImplicants([...uniqueMinterms, ...uniqueDontCares], numVars);
    const essential = selectEssentialPIs(uniqueMinterms, uniqueDontCares, allPIs);
    const simplifiedExprStr = piTermsToExpression(essential.map(p => p.bin), varNames);
    const simplifiedTree = buildTreeFromPIs(essential.map(p => p.bin), varNames);
    const nandTree = toNANDTree(simplifiedTree);
    const norTree = toNORTree(simplifiedTree);

    renderSimplifiedExpression(simplifiedExprStr);
    renderTruthTable(truthVector, varNames, numVars);
    renderCircuitInto('result-basic-gates', simplifiedTree);
    renderCircuitInto('result-nand', nandTree);
    renderCircuitInto('result-nor', norTree);

    const rows = allAssignments(numVars, varNames);
    let simpMatch = true, nandMatch = true, norMatch = true, origSelfMatch = true;
    rows.forEach((assign, i) => {
      if (truthVector[i] === 'X') return;
      const target = truthVector[i];
      if (evalNode(simplifiedTree, assign) !== target) simpMatch = false;
      if (evalNode(nandTree, assign) !== target) nandMatch = false;
      if (evalNode(norTree, assign) !== target) norMatch = false;
      if (inputType === 'expression' && originalEvalFn(assign) !== target) origSelfMatch = false;
    });

    renderVerification({ origSelfMatch, simpMatch, nandMatch, norMatch }, inputType);
  } catch (err) {
    showError(err.message || 'Something went wrong — please check your input.');
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  let savedTheme = 'dark';
  try { savedTheme = localStorage.getItem('bool-circuit-theme') || 'dark'; } catch (e) { /* ignore */ }
  setTheme(savedTheme);

  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  buildTruthTableInputPanel(parseInt(document.getElementById('var-count').value, 10));
  showPanel(document.getElementById('input-type').value);

  document.getElementById('var-count').addEventListener('change', (e) => {
    buildTruthTableInputPanel(parseInt(e.target.value, 10));
  });
  
  document.getElementById('input-type').addEventListener('change', (e) => showPanel(e.target.value));
  
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });
  
  document.getElementById('generate-btn').addEventListener('click', generate);

  // Handle full-row clicking for the interactive truth table
  document.getElementById('truth-table-input').addEventListener('click', (e) => {
    const row = e.target.closest('.tt-row');
    if (!row) return;
    
    const btn = row.querySelector('.cell-toggle');
    if (btn) {
      const current = btn.dataset.val;
      const next = current === '0' ? '1' : (current === '1' ? 'X' : '0');
      btn.dataset.val = next;
      btn.textContent = next;
    }
  });
});