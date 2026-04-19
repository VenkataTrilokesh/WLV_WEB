
'use strict';

// ---- STATE ------------------------------------------------
const state = {
  mode: 'single',
  k: 1,
  soundEnabled: false,
};

// ---- SAFE LIMITS for k-WL (n^k tuples) --------------------
const KWL_LIMITS = {
  1: Infinity,
  2: 500,
  3: 100,
  4: 30,
  5: 15,
};

function getMaxSafeN(k) {
  return KWL_LIMITS[k] ?? 10;
}

// ---- PROGRESS --------------------------------------------- 
const Progress = {
  el: null, bar: null, label: null, pct: null,
  init() {
    this.el    = document.getElementById('progress-panel');
    this.bar   = document.getElementById('progress-bar');
    this.label = document.getElementById('progress-label');
    this.pct   = document.getElementById('progress-pct');
  },
  show(text, val) {
    this.el.classList.remove('hidden');
    this.set(text, val);
  },
  set(text, val) {
    if (text)     this.label.textContent = text;
    if (val != null) {
      this.bar.style.width = val + '%';
      this.pct.textContent = val + '%';
    }
  },
  hide() { this.el.classList.add('hidden'); }
};

// ---- GRAPH PARSING ----------------------------------------
function parseGraph(text) {
  const lines = text.trim()
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('%'));

  if (!lines.length) throw new Error('Empty file');

  const adjacency = {};
  const edges = [];
  let n = 0;
  let edgeStart = 0;

  // Detect optional "n m" header (exactly 2 positive integers on first line)
  const firstParts = lines[0].split(/\s+/).map(Number);
  if (
    firstParts.length === 2 &&
    Number.isInteger(firstParts[0]) && firstParts[0] > 0 &&
    Number.isInteger(firstParts[1]) && firstParts[1] >= 0 &&
    lines.length > 1
  ) {
    n = firstParts[0];
    edgeStart = 1;
  }

  for (let i = edgeStart; i < lines.length; i++) {
    const parts = lines[i].split(/[\s,\t]+/).map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) continue;
    const u = parts[0], v = parts[1];
    if (!adjacency[u]) adjacency[u] = new Set();
    if (!adjacency[v]) adjacency[v] = new Set();
    adjacency[u].add(v);
    adjacency[v].add(u);
    edges.push([u, v]);
    n = Math.max(n, u + 1, v + 1);
  }

  // Ensure every node index 0..n-1 exists in adjacency
  for (let i = 0; i < n; i++) {
    if (!adjacency[i]) adjacency[i] = new Set();
  }

  if (n === 0 || edges.length === 0) {
    throw new Error('No valid edges found. Expected lines with "u v" pairs (0-indexed).');
  }

  return { n, edges, adjacency };
}

// ---- TRUE k-WL ALGORITHM ----------------------------------
function runKWL(graph, k, maxIter = 12, sharedHashMap = null) {
  const { n, adjacency } = graph;
  const nodes = Array.from({ length: n }, (_, i) => i);

  // Build all ordered k-tuples (n^k total)
  let tuples = [[]];
  for (let d = 0; d < k; d++) {
    const next = [];
    for (const t of tuples)
      for (const v of nodes) next.push([...t, v]);
    tuples = next;
  }

  let hashCounter = sharedHashMap ? sharedHashMap.size : 0;
  const hashMap = sharedHashMap || new Map();

  function getHash(key) {
    if (!hashMap.has(key)) hashMap.set(key, hashCounter++);
    return hashMap.get(key);
  }

  const tupleKey = t => t.join(',');

  // Initial colouring: encode adjacency pattern + degree sequence + equality pattern within tuple
  let colors = {};
  for (const t of tuples) {
    const degrees = t.map(v => adjacency[v].size).join(',');
    let adjPattern = '';
    for (let i = 0; i < k; i++)
      for (let j = i + 1; j < k; j++)
        adjPattern += adjacency[t[i]].has(t[j]) ? '1' : '0';
    let eqPattern = '';
    for (let i = 0; i < k; i++)
      for (let j = i + 1; j < k; j++)
        eqPattern += (t[i] === t[j]) ? '1' : '0';
    colors[tupleKey(t)] = getHash(`init:${degrees}|${adjPattern}|${eqPattern}`);
  }

  // Map tuple colors → per-node color (mode across tuples containing that node)
  function nodeColorsFromTupleColors(tColors) {
    const nodeColor = {};
    for (let i = 0; i < n; i++) nodeColor[i] = [];
    for (const t of tuples) {
      const c = tColors[tupleKey(t)];
      for (const node of t) nodeColor[node].push(c);
    }
    const result = {};
    for (let i = 0; i < n; i++) {
      const arr = nodeColor[i];
      const freq = {};
      let best = arr[0], bestCount = 0;
      for (const c of arr) {
        freq[c] = (freq[c] || 0) + 1;
        if (freq[c] > bestCount) { bestCount = freq[c]; best = c; }
      }
      result[i] = best ?? 0;
    }
    return result;
  }

  const iterations = [nodeColorsFromTupleColors(colors)];

  for (let iter = 0; iter < maxIter; iter++) {
    const newColors = {};

    for (const t of tuples) {
      const tk = tupleKey(t);
      // For each position i, collect colors of tuples formed by swapping t[i] with each neighbor
      const neighborMultiset = [];
      for (let i = 0; i < k; i++) {
        const nbrs = Array.from(adjacency[t[i]]).sort((a, b) => a - b);
        for (const neighbor of nbrs) {
          const newTuple = [...t];
          newTuple[i] = neighbor;
          const nc = colors[tupleKey(newTuple)];
          if (nc !== undefined) neighborMultiset.push(`${i}:${nc}`);
        }
      }
      neighborMultiset.sort();

      const degPattern = t.map(v => adjacency[v].size).join(',');
      const sig = `${colors[tk]}|${neighborMultiset.join(';')}|${degPattern}`;
      newColors[tk] = getHash(sig);
    }

    iterations.push(nodeColorsFromTupleColors(newColors));

    const changed = tuples.some(t => newColors[tupleKey(t)] !== colors[tupleKey(t)]);
    colors = newColors;
    if (!changed) break;
  }

  return { iterations, _finalTupleColors: colors, tuples };
}

// Build canonical colour histogram (certificate)
function certificate(tupleColorMap) {
  const freq = {};
  for (const c of Object.values(tupleColorMap)) freq[c] = (freq[c] || 0) + 1;
  return Object.entries(freq).map(([c, cnt]) => `${c}:${cnt}`).sort().join(',');
}

// ---- COMPARE TWO GRAPHS ------------------------------------ 
function compareGraphs(g1, g2, k, maxIter = 12) {
  const sharedMap = new Map();
  const r1 = runKWL(g1, k, maxIter, sharedMap);
  const r2 = runKWL(g2, k, maxIter, sharedMap);

  const degSeq = graph =>
    Array.from({ length: graph.n }, (_, i) => graph.adjacency[i].size).sort((a, b) => a - b);
  const ds1 = degSeq(g1), ds2 = degSeq(g2);
  const degMatch = ds1.length === ds2.length && ds1.every((v, i) => v === ds2[i]);

  const cert1 = certificate(r1._finalTupleColors);
  const cert2 = certificate(r2._finalTupleColors);
  const wlMatch = cert1 === cert2;

  const nodeCert = nodeColors => {
    const freq = {};
    Object.values(nodeColors).forEach(c => { freq[c] = (freq[c] || 0) + 1; });
    return Object.entries(freq).map(([c, cnt]) => `${c}:${cnt}`).sort().join(',');
  };

  const certs1 = r1.iterations.map(nodeCert);
  const certs2 = r2.iterations.map(nodeCert);

  let firstDiff = -1;
  for (let i = 0; i < Math.min(certs1.length, certs2.length); i++) {
    if (certs1[i] !== certs2[i]) { firstDiff = i; break; }
  }

  return {
    isomorphic: degMatch && wlMatch,
    degMatch, wlMatch, firstDiff,
    iter1: r1.iterations,
    iter2: r2.iterations,
  };
}

// ---- D3 VISUALIZATION -------------------------------------- 
const NODE_PALETTE = [
  '#4f73ff', '#7c5cfc', '#0d9e8a', '#e67e22', '#c94040',
  '#2980b9', '#8e44ad', '#27ae60', '#d35400', '#2c3e50',
  '#16a085', '#c0392b', '#f39c12', '#1a5276', '#6c3483',
];

function colorForLabel(label) {
  const idx = ((label % NODE_PALETTE.length) + NODE_PALETTE.length) % NODE_PALETTE.length;
  return NODE_PALETTE[idx];
}

function drawGraph(svgEl, graph, initialColors) {
  const { n, edges, adjacency } = graph;
  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();

  const rect = svgEl.getBoundingClientRect();
  const W = rect.width || 400;
  const H = rect.height || 340;

  const nodes = Array.from({ length: n }, (_, i) => ({ id: i, label: initialColors[i] ?? 0 }));
  const links = edges.map(([s, t]) => ({ source: s, target: t }));

  const charge = -Math.max(60, Math.min(400, 400 / Math.max(n, 1)));
  const linkDist = Math.min(80, (W / Math.max(n + 1, 2)) * 2.5);

  const simulation = d3.forceSimulation(nodes)
    .force('link',      d3.forceLink(links).id(d => d.id).distance(linkDist).strength(0.5))
    .force('charge',    d3.forceManyBody().strength(charge))
    .force('center',    d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(22))
    .alphaDecay(0.026);

  const g = svg.append('g');

  const defs = svg.append('defs');
  defs.append('filter').attr('id', 'node-glow')
    .append('feDropShadow')
    .attr('dx', 0).attr('dy', 2)
    .attr('stdDeviation', 3)
    .attr('flood-opacity', 0.22);

  const link = g.append('g')
    .selectAll('line').data(links).join('line')
    .attr('stroke', 'rgba(148, 163, 184, 0.45)')
    .attr('stroke-width', 1.5)
    .attr('stroke-linecap', 'round');

  const nodeG = g.append('g')
    .selectAll('g').data(nodes).join('g')
    .style('cursor', 'pointer');

  const circles = nodeG.append('circle')
    .attr('r', 0)
    .attr('fill', d => colorForLabel(d.label))
    .attr('stroke', 'white')
    .attr('stroke-width', 2)
    .attr('filter', 'url(#node-glow)');

  circles.transition()
    .delay((_, i) => i * 30)
    .duration(420)
    .ease(d3.easeCubicOut)
    .attr('r', 14);

  nodeG.append('text')
    .text(d => d.id)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', 'white')
    .attr('font-family', "'DM Mono', monospace")
    .attr('font-size', n > 20 ? '8px' : '10px')
    .attr('font-weight', '700')
    .attr('pointer-events', 'none')
    .style('opacity', 0)
    .transition().delay((_, i) => i * 30 + 200).duration(300)
    .style('opacity', 1);

  const tooltipEl = document.getElementById('tooltip');

  nodeG
    .on('mouseover', function(event, d) {
      d3.select(this).select('circle')
        .transition().duration(120)
        .attr('r', 18).attr('stroke-width', 2.5);
      if (tooltipEl) {
        const deg = adjacency[d.id] ? adjacency[d.id].size : 0;
        tooltipEl.innerHTML = `
          <strong style="font-family:'DM Mono',monospace">Node ${d.id}</strong><br>
          Color class: <span style="color:${colorForLabel(d.label)};font-weight:700">${d.label}</span><br>
          Degree: ${deg}
        `;
        tooltipEl.classList.add('visible');
      }
    })
    .on('mousemove', function(event) {
      if (tooltipEl) {
        tooltipEl.style.transform = `translate3d(${event.clientX + 14}px,${event.clientY - 30}px,0)`;
      }
    })
    .on('mouseout', function() {
      d3.select(this).select('circle')
        .transition().duration(150)
        .attr('r', 14).attr('stroke-width', 2);
      if (tooltipEl) {
        tooltipEl.classList.remove('visible');
        tooltipEl.setAttribute('aria-hidden', 'true');
      }
    });

  const drag = d3.drag()
    .on('start', (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
    .on('end',  (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null; d.fy = null;
    });
  nodeG.call(drag);

  simulation.on('tick', () => {
    nodes.forEach(d => {
      d.x = Math.max(20, Math.min(W - 20, d.x));
      d.y = Math.max(20, Math.min(H - 20, d.y));
    });
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    nodeG.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // Return a function that re-colors nodes without restarting the simulation
  return function updateColors(newColors) {
    nodeG.each(function(d) { d.label = newColors[d.id] ?? 0; });
    nodeG.select('circle')
      .transition().duration(400).ease(d3.easeCubicInOut)
      .attr('fill', d => colorForLabel(d.label));
  };
}

// ---- EMPTY STATE ANIMATED GRAPH (FIX: explicit dimensions) ----
function drawEmptyStateGraph() {
  const container = document.getElementById('empty-graph');
  if (!container) return;

  // FIX: must set explicit size before D3 appends SVG
  container.style.width  = '220px';
  container.style.height = '180px';

  const W = 220, H = 180;
  const svg = d3.select(container)
    .append('svg')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('width', W)
    .attr('height', H);

  const nodesData = [
    { id: 0, x: 110, y: 36 },
    { id: 1, x: 48,  y: 106 },
    { id: 2, x: 172, y: 106 },
    { id: 3, x: 28,  y: 162 },
    { id: 4, x: 110, y: 158 },
    { id: 5, x: 192, y: 162 },
  ];
  const linksData = [[0,1],[0,2],[1,2],[1,3],[2,5],[1,4],[2,4],[4,5]];
  const palette   = ['#4f73ff','#7c5cfc','#0d9e8a','#e67e22','#7c5cfc','#4f73ff'];

  svg.append('g').selectAll('line').data(linksData).join('line')
    .attr('x1', d => nodesData[d[0]].x).attr('y1', d => nodesData[d[0]].y)
    .attr('x2', d => nodesData[d[1]].x).attr('y2', d => nodesData[d[1]].y)
    .attr('stroke', 'rgba(148,163,184,0.35)').attr('stroke-width', 1.8);

  const ng = svg.append('g')
    .selectAll('g').data(nodesData).join('g')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  ng.append('circle')
    .attr('r', 0)
    .attr('fill', (_, i) => palette[i])
    .attr('stroke', 'white').attr('stroke-width', 2.5)
    .transition()
    .delay((_, i) => i * 90)
    .duration(560)
    .ease(d3.easeBackOut)
    .attr('r', 15);

  ng.append('text')
    .text(d => d.id)
    .attr('text-anchor', 'middle').attr('dy', '0.35em')
    .attr('fill', 'white')
    .attr('font-family', "'DM Mono',monospace")
    .attr('font-size', '10')
    .attr('font-weight', '700')
    .attr('pointer-events', 'none')
    .style('opacity', 0)
    .transition().delay((_, i) => i * 90 + 360).duration(300)
    .style('opacity', 1);

  const colorSets = [
    ['#4f73ff','#7c5cfc','#0d9e8a','#e67e22','#7c5cfc','#4f73ff'],
    ['#e67e22','#4f73ff','#7c5cfc','#0d9e8a','#4f73ff','#7c5cfc'],
    ['#0d9e8a','#e67e22','#4f73ff','#7c5cfc','#0d9e8a','#e67e22'],
  ];
  let step = 0;
  setInterval(() => {
    step = (step + 1) % colorSets.length;
    svg.selectAll('circle')
      .transition().duration(900).ease(d3.easeCubicInOut)
      .attr('fill', (_, i) => colorSets[step][i]);
  }, 2400);
}

// ---- DEGREE TABLE ------------------------------------------
function buildDegTable(container, graph, label) {
  const { n, adjacency } = graph;
  const wrapper = document.createElement('div');
  wrapper.className = 'deg-table-wrap anim-slide-up';

  const head = document.createElement('div');
  head.className = 'deg-table-head';
  head.textContent = label + ' — Node Degrees';
  wrapper.appendChild(head);

  const body = document.createElement('div');
  body.className = 'deg-table-body';

  const degrees = {};
  for (let i = 0; i < n; i++) degrees[i] = adjacency[i] ? adjacency[i].size : 0;

  const degFreq = {};
  Object.values(degrees).forEach(d => degFreq[d] = (degFreq[d] || 0) + 1);

  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'deg-row';
    const isAnomaly = degFreq[degrees[i]] === 1 && n > 3;
    row.innerHTML = `
      <span class="deg-node">v${i}</span>
      <span class="deg-val${isAnomaly ? ' anomaly' : ''}">${degrees[i]}</span>
    `;
    body.appendChild(row);
  }

  wrapper.appendChild(body);
  container.appendChild(wrapper);
}

// ---- RESULT RENDERING -------------------------------------- 
function renderResults(graphs, iterData, compareResult) {
  const area = document.getElementById('results-area');
  area.innerHTML = '';

  const stack = document.createElement('div');
  stack.className = 'result-stack';

  // Stats card
  const g1 = graphs[0], g2 = graphs[1];
  const totalNodes   = g2 ? g1.n + g2.n : g1.n;
  const iters        = iterData[0] ? iterData[0].length : 1;
  const colorClasses = iterData[0]
    ? new Set(Object.values(iterData[0][iterData[0].length - 1])).size : 0;

  const statsCard = document.createElement('div');
  statsCard.className = 'stats-card anim-slide-up';
  statsCard.innerHTML = `
    <div class="card-header">
      <div class="card-eyebrow">Overview</div>
      <h3>Analysis Summary</h3>
    </div>
    <div class="stats-row" id="stats-row"></div>
  `;
  stack.appendChild(statsCard);

  const statItems = [
    { label: 'Graphs',        value: graphs.length,  note: 'analyzed' },
    { label: 'Total Nodes',   value: totalNodes,      note: g2 ? `${g1.n} + ${g2.n}` : 'single graph' },
    { label: 'Iterations',    value: iters,           note: `${state.k}-WL refinement` },
    { label: 'Color Classes', value: colorClasses,    note: 'final partition' },
  ];

  const statsRow = statsCard.querySelector('#stats-row');
  statItems.forEach((s, i) => {
    const box = document.createElement('div');
    box.className = `stat-box anim-slide-up anim-d${i + 1}`;
    box.innerHTML = `
      <div class="stat-label">${s.label}</div>
      <div class="stat-value" data-target="${s.value}">0</div>
      <div class="stat-note">${s.note}</div>
    `;
    statsRow.appendChild(box);
  });

  setTimeout(() => {
    statsRow.querySelectorAll('.stat-value').forEach(el => {
      animateCounter(el, 0, parseInt(el.dataset.target), 700);
    });
  }, 200);

  // Verdict card (compare mode only)
  if (compareResult) {
    const cls = compareResult.isomorphic ? 'pass' : 'fail';
    const verdictCard = document.createElement('div');
    verdictCard.className = `verdict-card ${cls} anim-slide-up anim-d2`;

    const wlStatus      = compareResult.wlMatch ? 'Identical' : 'Different';
    const degStatus     = compareResult.degMatch ? 'Match'    : 'Mismatch';
    const firstDiffText = compareResult.firstDiff >= 0
      ? `Diverges at iteration ${compareResult.firstDiff}`
      : 'Stable across all iterations';

    verdictCard.innerHTML = `
      <div class="verdict-body">
        <div class="verdict-main">
          <div class="verdict-tag">Isomorphism Verdict — ${state.k}-WL Test</div>
          <div class="verdict-result">${compareResult.isomorphic ? '✓ Isomorphic' : '✗ Non-Isomorphic'}</div>
          <p class="verdict-desc">
            ${compareResult.isomorphic
              ? `The ${state.k}-WL test cannot distinguish these graphs — they may be structurally equivalent. Note: k-WL is not a complete isomorphism test for all k.`
              : `The ${state.k}-WL test distinguishes these graphs — they are definitively <em>not</em> isomorphic. Their color refinements produce different certificates.`
            }
          </p>
        </div>
        <div class="verdict-signals">
          <div class="signal-item ${compareResult.degMatch ? 'pass' : 'fail'}">
            <span class="signal-name">Degree Sequence</span>
            <span class="signal-val">${degStatus}</span>
            <span class="signal-sub">${compareResult.degMatch ? 'Both graphs share the same degree multiset' : 'Degree sequences differ'}</span>
          </div>
          <div class="signal-item ${compareResult.wlMatch ? 'pass' : 'fail'}">
            <span class="signal-name">${state.k}-WL Certificate</span>
            <span class="signal-val">${wlStatus}</span>
            <span class="signal-sub">Final tuple color histogram comparison</span>
          </div>
          <div class="signal-item ${compareResult.firstDiff >= 0 ? 'warn' : 'pass'}">
            <span class="signal-name">Divergence</span>
            <span class="signal-val">${compareResult.firstDiff >= 0 ? `Iter ${compareResult.firstDiff}` : 'None'}</span>
            <span class="signal-sub">${firstDiffText}</span>
          </div>
        </div>
      </div>
    `;
    stack.appendChild(verdictCard);
  }

  // Iteration viewer
  const iterCard = document.createElement('div');
  iterCard.className = 'iter-card anim-slide-up anim-d3';

  const numIters = iterData[0] ? iterData[0].length : 1;
  const tabsHTML = Array.from({ length: numIters }, (_, i) => {
    const hasDiff = compareResult && compareResult.firstDiff === i;
    return `<button class="iter-tab${i === 0 ? ' active' : ''}${hasDiff ? ' has-diff' : ''}" data-iter="${i}">
      ${i === 0 ? 'Initial' : `Iter ${i}`}
    </button>`;
  }).join('');

  iterCard.innerHTML = `
    <div class="iter-header">
      <div class="card-header" style="margin-bottom:0">
        <div class="card-eyebrow">${state.k}-WL Refinement</div>
        <h3>Color Iterations</h3>
      </div>
      <div class="iter-tabs-wrap">
        ${tabsHTML}
        ${compareResult && compareResult.firstDiff >= 0
          ? `<div class="diff-banner visible">⚡ Diff at iter ${compareResult.firstDiff}</div>` : ''}
      </div>
    </div>
    <div class="graph-grid${graphs.length === 1 ? ' single' : ''}" id="graph-grid"></div>
  `;
  stack.appendChild(iterCard);

  const graphGrid = iterCard.querySelector('#graph-grid');
  const updateFns = [];

  graphs.forEach((graph, gi) => {
    const panelEl = document.createElement('div');
    panelEl.className = 'graph-panel anim-pop-in';
    panelEl.style.animationDelay = (gi * 0.07 + 0.2) + 's';

    const label  = gi === 0 ? 'Graph A' : 'Graph B';
    const colors = iterData[gi] ? iterData[gi][0] : {};
    const cc     = new Set(Object.values(colors)).size;
    const maxDeg = Math.max(...Object.values(graph.adjacency).map(s => s.size), 0);

    panelEl.innerHTML = `
      <div class="graph-panel-head">
        <div>
          <div class="graph-kicker">${label}</div>
          <h4>${graph.n} nodes, ${graph.edges.length} edges</h4>
        </div>
        <span class="panel-badge" id="panel-badge-${gi}">${cc} colors</span>
      </div>
      <div class="graph-canvas" id="canvas-${gi}">
        <svg class="graph-svg" id="svg-${gi}"></svg>
      </div>
      <div class="graph-footer">
        <span class="graph-chip">n = ${graph.n}</span>
        <span class="graph-chip">m = ${graph.edges.length}</span>
        <span class="graph-chip">Δ = ${maxDeg}</span>
        <span class="graph-chip kwl-chip">${state.k}-WL</span>
      </div>
    `;
    graphGrid.appendChild(panelEl);
  });

  setTimeout(() => {
    graphs.forEach((graph, gi) => {
      const svgEl = document.getElementById(`svg-${gi}`);
      if (!svgEl) return;
      const initColors = iterData[gi] ? iterData[gi][0] : {};
      const fn = drawGraph(svgEl, graph, initColors);
      updateFns.push({ gi, fn });
    });
  }, 100);

  iterCard.querySelectorAll('.iter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      Audio.play('click');
      iterCard.querySelectorAll('.iter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const iter = parseInt(tab.dataset.iter);

      graphs.forEach((_, gi) => {
        if (!iterData[gi]) return;
        const colors = iterData[gi][iter] ?? iterData[gi][iterData[gi].length - 1];
        const updater = updateFns.find(u => u.gi === gi);
        if (updater) updater.fn(colors);
        const badge = document.getElementById(`panel-badge-${gi}`);
        if (badge) badge.textContent = new Set(Object.values(colors)).size + ' colors';
      });
    });
  });

  // Degree tables
  const tablesCard = document.createElement('div');
  tablesCard.className = 'tables-card anim-slide-up anim-d4';
  tablesCard.innerHTML = `
    <div class="card-header">
      <div class="card-eyebrow">Structural Analysis</div>
      <h3>Degree Distribution</h3>
    </div>
    <div class="tables-grid${graphs.length === 1 ? ' single' : ''}" id="tables-grid"></div>
  `;
  stack.appendChild(tablesCard);

  const tablesGrid = tablesCard.querySelector('#tables-grid');
  graphs.forEach((graph, gi) => buildDegTable(tablesGrid, graph, gi === 0 ? 'Graph A' : 'Graph B'));

  area.appendChild(stack);
}

// ---- COUNTER ANIMATION ------------------------------------- 
function animateCounter(el, from, to, duration) {
  const start = performance.now();
  (function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * ease);
    if (progress < 1) requestAnimationFrame(tick);
  })(start);
}

// ---- ERROR DISPLAYS ----------------------------------------
function showError(msg) {
  const area = document.getElementById('results-area');
  area.innerHTML = `<div class="banner error anim-slide-up">${msg}</div>`;
}

function showKWLError(msg) {
  const area  = document.getElementById('results-area');
  const lines = msg.split('\n').filter(Boolean);

  area.innerHTML = `
    <div class="kwl-error-card anim-slide-up">
      <div class="kwl-error-icon">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="12" stroke="#c94040" stroke-width="1.8"/>
          <path d="M14 8v7M14 18v2" stroke="#c94040" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="kwl-error-body">
        <div class="kwl-error-title">Graph too large for k=${state.k}</div>
        <div class="kwl-error-main">${lines[0] || msg}</div>
        ${lines.length > 1 ? `<div class="kwl-error-detail">${lines.slice(1).join('<br>')}</div>` : ''}
        <div class="kwl-error-hint">
          <strong>Reference: Safe limits per k value</strong>
          <table class="kwl-limits-mini">
            <thead><tr><th>k</th><th>Max nodes</th><th>Tuple count</th></tr></thead>
            <tbody>
              <tr class="${state.k===1?'active-k':''}"><td>1</td><td>Unlimited</td><td>n</td></tr>
              <tr class="${state.k===2?'active-k':''}"><td>2</td><td>≤ 500</td><td>n²</td></tr>
              <tr class="${state.k===3?'active-k':''}"><td>3</td><td>≤ 100</td><td>n³</td></tr>
              <tr class="${state.k===4?'active-k':''}"><td>4</td><td>≤ 30</td><td>n⁴</td></tr>
              <tr class="${state.k===5?'active-k':''}"><td>5</td><td>≤ 15</td><td>n⁵</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ---- FILE READING ------------------------------------------
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- Custom error class ------------------------------------
class KWLSizeError extends Error {
  constructor(msg) { super(msg); this.name = 'KWLSizeError'; }
}

function recommendK(n) {
  for (let k = 5; k >= 1; k--)
    if (n <= getMaxSafeN(k)) return k;
  return 1;
}

// ---- MAIN RUN ----------------------------------------------
async function runAnalysis() {
  Audio.play('click');

  const file1 = document.getElementById('file1').files[0];
  const file2 = document.getElementById('file2').files[0];
  const k     = state.k;

  if (!file1) {
    showError('⚠️ No file uploaded. Please upload at least one graph file to analyze.');
    return;
  }
  if (state.mode === 'compare' && !file2) {
    showError('⚠️ Compare mode requires two graph files. Please upload Graph B.');
    return;
  }

  const runBtn = document.getElementById('run-btn');
  runBtn.classList.add('loading');
  runBtn.querySelector('.run-btn-label').textContent = 'Analyzing…';

  Progress.show('Reading files…', 5);

  try {
    await delay(80);
    const text1 = await readFile(file1);
    Progress.set('Parsing Graph A…', 20);
    await delay(60);
    const g1 = parseGraph(text1);

    // Safety check Graph A
    const maxN = getMaxSafeN(k);
    if (g1.n > maxN) {
      throw new KWLSizeError(
        `Graph A has ${g1.n} nodes, but k=${k} only supports up to ${maxN} nodes safely.\n` +
        `With ${g1.n} nodes and k=${k}, the algorithm would need to process ${g1.n}^${k} = ${Math.pow(g1.n, k).toLocaleString()} tuples — this would crash your browser.\n\n` +
        `Fix: reduce k to ${recommendK(g1.n)}, or use a smaller graph (≤ ${maxN} nodes for k=${k}).`
      );
    }

    let g2 = null;
    if (state.mode === 'compare' && file2) {
      const text2 = await readFile(file2);
      Progress.set('Parsing Graph B…', 35);
      await delay(60);
      g2 = parseGraph(text2);

      // Safety check Graph B
      if (g2.n > maxN) {
        throw new KWLSizeError(
          `Graph B has ${g2.n} nodes, but k=${k} only supports up to ${maxN} nodes safely.\n` +
          `Fix: reduce k to ${recommendK(g2.n)}, or use a smaller graph (≤ ${maxN} nodes for k=${k}).`
        );
      }
    }

    Progress.set(`Running ${k}-WL refinement…`, 55);
    await delay(80);

    let iter1, iter2, compareResult;

    if (g2) {
      Progress.set('Comparing graphs…', 75);
      await delay(60);
      compareResult = compareGraphs(g1, g2, k);
      iter1 = compareResult.iter1;
      iter2 = compareResult.iter2;
    } else {
      const result = runKWL(g1, k);
      iter1 = result.iterations;
    }

    Progress.set('Building visualization…', 90);
    await delay(60);

    const graphs   = g2 ? [g1, g2] : [g1];
    const iterData = g2 ? [iter1, iter2] : [iter1];

    Progress.set('Complete!', 100);
    await delay(400);
    Progress.hide();

    renderResults(graphs, iterData, compareResult);
    Audio.play('complete');

  } catch (err) {
    Progress.hide();
    if (err instanceof KWLSizeError) showKWLError(err.message);
    else showError('⚠️ Failed to parse graph: ' + err.message + '. Check the file format (edges as "u v" per line, 0-indexed).');
    Audio.play('error');
    console.error(err);
  } finally {
    runBtn.classList.remove('loading');
    runBtn.querySelector('.run-btn-label').textContent = 'Run Analysis';
  }
}

function setK(val) {
  val = Math.max(1, Math.min(5, val));
  state.k = val;

  const display = document.getElementById('k-display');
  display.textContent = val;

  // Trigger bump animation
  display.classList.remove('bump');
  void display.offsetWidth; // force reflow to restart animation
  display.classList.add('bump');

  // Highlight the matching row in the safe-limits table
  document.querySelectorAll('.kwl-limits-table tbody tr').forEach(row => {
    row.classList.toggle('active-k', parseInt(row.dataset.k) === val);
  });
}

function setupUpload(inputId, fnameId, zoneId) {
  const input = document.getElementById(inputId);
  const fname = document.getElementById(fnameId);
  const zone  = document.getElementById(zoneId);
  if (!input || !zone) return;

  input.addEventListener('change', () => {
    if (input.files[0]) {
      fname.textContent = input.files[0].name;
      zone.classList.add('loaded');
      Audio.play('click');
    }
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      fname.textContent = file.name;
      zone.classList.add('loaded');
      Audio.play('click');
    }
  });
}

// ---- BACKGROUND ORB ANIMATION ----------------------------- 
function animateBgOrbs() {
  let hue = 0;
  const orb1 = document.querySelector('.orb-1');
  const orb2 = document.querySelector('.orb-2');
  const orb3 = document.querySelector('.orb-3');
  function tick() {
    hue += 0.1;
    if (orb1) orb1.style.background = `radial-gradient(circle,hsla(${220+Math.sin(hue*.01)*20},90%,65%,0.09) 0%,transparent 70%)`;
    if (orb2) orb2.style.background = `radial-gradient(circle,hsla(${260+Math.sin(hue*.008+2)*25},85%,62%,0.08) 0%,transparent 70%)`;
    if (orb3) orb3.style.background = `radial-gradient(circle,hsla(${165+Math.sin(hue*.012+4)*30},80%,50%,0.06) 0%,transparent 70%)`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ---- EVENT WIRING ------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  Progress.init();

  // Mode toggle
  document.getElementById('btn-single').addEventListener('click', () => {
    Audio.play('click');
    state.mode = 'single';
    document.getElementById('btn-single').classList.add('active');
    document.getElementById('btn-compare').classList.remove('active');
    document.querySelectorAll('.compare-only').forEach(el => el.classList.add('hidden'));
  });

  document.getElementById('btn-compare').addEventListener('click', () => {
    Audio.play('click');
    state.mode = 'compare';
    document.getElementById('btn-compare').classList.add('active');
    document.getElementById('btn-single').classList.remove('active');
    document.querySelectorAll('.compare-only').forEach(el => el.classList.remove('hidden'));
  });

  // k steppers — no input element, purely button-driven
  document.getElementById('k-dec').addEventListener('click', () => { Audio.play('click'); setK(state.k - 1); });
  document.getElementById('k-inc').addEventListener('click', () => { Audio.play('click'); setK(state.k + 1); });

  // File uploads
  setupUpload('file1', 'fname1', 'zone1');
  setupUpload('file2', 'fname2', 'zone2');

  // Sound toggle
  const soundBtn = document.getElementById('sound-toggle');
  soundBtn.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    soundBtn.setAttribute('aria-pressed', String(state.soundEnabled));
    if (state.soundEnabled) Audio.play('click');
  });

  // Run analysis
  document.getElementById('run-btn').addEventListener('click', runAnalysis);

  // Empty state demo graph
  drawEmptyStateGraph();

  // Orb animation
  animateBgOrbs();

  // Highlight default k=1 row
  setK(1);
});
