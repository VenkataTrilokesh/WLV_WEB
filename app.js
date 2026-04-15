/* ============================================================
   app.js — k-WL Graph Analyzer
   Complete algorithm + D3 visualization + UI logic
   ============================================================ */

'use strict';

// ---- STATE ------------------------------------------------
const state = {
  mode: 'single',
  k: 1,
  soundEnabled: true,
  graphs: [],         // parsed graph objects
  wlResults: [],      // per-graph WL color sequences
  iterData: [],       // per-iteration snapshot
  currentIter: 0,
};

// ---- AUDIO ------------------------------------------------
const Audio = (() => {
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function play(type) {
    if (!state.soundEnabled) return;
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);
      if (type === 'click') {
        osc.frequency.setValueAtTime(520, c.currentTime);
        gain.gain.setValueAtTime(0.04, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.08);
        osc.start(c.currentTime);
        osc.stop(c.currentTime + 0.08);
      } else if (type === 'complete') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, c.currentTime);
        osc.frequency.setValueAtTime(550, c.currentTime + 0.12);
        osc.frequency.setValueAtTime(660, c.currentTime + 0.24);
        gain.gain.setValueAtTime(0.05, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.5);
        osc.start(c.currentTime);
        osc.stop(c.currentTime + 0.5);
      } else if (type === 'error') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, c.currentTime);
        gain.gain.setValueAtTime(0.04, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.2);
        osc.start(c.currentTime);
        osc.stop(c.currentTime + 0.2);
      }
    } catch(e) {}
  }
  return { play };
})();

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
    if (text)  this.label.textContent = text;
    if (val != null) {
      this.bar.style.width = val + '%';
      this.pct.textContent = val + '%';
    }
  },
  hide() { this.el.classList.add('hidden'); }
};

// ---- GRAPH PARSING ----------------------------------------
function parseGraph(text) {
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Empty file');

  const firstParts = lines[0].split(/\s+/).map(Number);
  let n, m, edgeStart;

  if (firstParts.length >= 2 && !isNaN(firstParts[0]) && !isNaN(firstParts[1])) {
    n = firstParts[0]; m = firstParts[1]; edgeStart = 1;
  } else {
    // Try to auto-detect: read all edges and infer n
    edgeStart = 0; m = lines.length;
    n = 0;
  }

  const adjacency = {};
  const edges = [];

  for (let i = edgeStart; i < lines.length; i++) {
    const parts = lines[i].split(/\s+/).map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) continue;
    const [u, v] = parts;
    if (!adjacency[u]) adjacency[u] = new Set();
    if (!adjacency[v]) adjacency[v] = new Set();
    adjacency[u].add(v);
    adjacency[v].add(u);
    edges.push([u, v]);
    n = Math.max(n, u + 1, v + 1);
  }

  // Ensure all nodes exist
  for (let i = 0; i < n; i++) {
    if (!adjacency[i]) adjacency[i] = new Set();
  }

  return { n, edges, adjacency };
}

// ---- k-WL ALGORITHM ----------------------------------------
function runWL(graph, k, maxIter = 10) {
  const { n, adjacency } = graph;
  const nodes = Array.from({ length: n }, (_, i) => i);

  // Initial coloring: degree-based for richer start
  let colors = {};
  for (const node of nodes) {
    colors[node] = adjacency[node].size; // degree as initial color
  }

  const iterations = [{ ...colors }];
  let hashCounter = 0;
  const hashMap = new Map();

  function hashColor(val) {
    const key = String(val);
    if (!hashMap.has(key)) hashMap.set(key, hashCounter++);
    return hashMap.get(key);
  }

  // Normalize to compact integers
  function normalizeColors(c) {
    const vals = [...new Set(Object.values(c))].sort((a, b) => a - b);
    const remap = {};
    vals.forEach((v, i) => remap[v] = i);
    const result = {};
    for (const node of nodes) result[node] = remap[c[node]];
    return result;
  }

  colors = normalizeColors(colors);
  iterations[0] = { ...colors };

  for (let iter = 0; iter < maxIter; iter++) {
    const newColors = {};

    for (const node of nodes) {
      const neighborColors = [...adjacency[node]].map(nb => colors[nb]).sort((a, b) => a - b);
      const signature = `${colors[node]}|${neighborColors.join(',')}`;
      const key = String(signature);
      if (!hashMap.has(key)) hashMap.set(key, hashCounter++);
      newColors[node] = hashMap.get(key);
    }

    const normalized = normalizeColors(newColors);
    iterations.push({ ...normalized });

    // Check for convergence
    const prevClasses = new Set(Object.values(colors)).size;
    const newClasses = new Set(Object.values(normalized)).size;
    const changed = nodes.some(nd => normalized[nd] !== colors[nd]);

    colors = normalized;
    if (!changed) break; // stable
  }

  return iterations;
}

// ---- COMPARE TWO GRAPHS ------------------------------------ 
function compareGraphs(iter1, iter2) {
  // Degree sequences
  const deg1 = iter1[0]; // initial colors = degrees
  const deg2 = iter2[0];
  const degSeq1 = Object.values(deg1).sort((a, b) => a - b);
  const degSeq2 = Object.values(deg2).sort((a, b) => a - b);
  const degMatch = degSeq1.length === degSeq2.length && degSeq1.every((v, i) => v === degSeq2[i]);

  // WL certificate comparison per iteration
  const maxIter = Math.max(iter1.length, iter2.length);
  const certificates1 = iter1.map(colors => {
    const freq = {};
    Object.values(colors).forEach(c => freq[c] = (freq[c] || 0) + 1);
    return Object.entries(freq).sort().map(e => e.join(':')).join(',');
  });
  const certificates2 = iter2.map(colors => {
    const freq = {};
    Object.values(colors).forEach(c => freq[c] = (freq[c] || 0) + 1);
    return Object.entries(freq).sort().map(e => e.join(':')).join(',');
  });

  let firstDiff = -1;
  for (let i = 0; i < Math.min(certificates1.length, certificates2.length); i++) {
    if (certificates1[i] !== certificates2[i]) { firstDiff = i; break; }
  }

  const lastIter = Math.min(iter1.length, iter2.length) - 1;
  const wlMatch = certificates1[lastIter] === certificates2[lastIter];
  const isomorphic = degMatch && wlMatch;

  return { isomorphic, degMatch, wlMatch, firstDiff, certificates1, certificates2 };
}

// ---- D3 VISUALIZATION -------------------------------------- 
const NODE_PALETTE = [
  '#4f73ff', '#7c5cfc', '#0d9e8a', '#e67e22', '#c94040',
  '#2980b9', '#8e44ad', '#27ae60', '#d35400', '#2c3e50',
  '#16a085', '#c0392b', '#2471a3', '#1a5276', '#6c3483'
];

function colorForLabel(label) {
  return NODE_PALETTE[label % NODE_PALETTE.length];
}

function drawGraph(svgEl, graph, colors, { tooltip } = {}) {
  const { n, edges, adjacency } = graph;
  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();

  const rect = svgEl.getBoundingClientRect();
  const W = rect.width || 400;
  const H = rect.height || 340;

  const nodes = Array.from({ length: n }, (_, i) => ({ id: i, label: colors[i] ?? 0 }));
  const links = edges.map(([s, t]) => ({ source: s, target: t }));

  // D3 force simulation
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(Math.min(80, W / (n + 1) * 2.5)).strength(0.6))
    .force('charge', d3.forceManyBody().strength(-Math.max(60, 400 / n)))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(22))
    .alphaDecay(0.028);

  const g = svg.append('g');

  // Edges
  const link = g.append('g').attr('class', 'links')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', 'rgba(148, 163, 184, 0.45)')
    .attr('stroke-width', 1.5)
    .attr('stroke-linecap', 'round');

  // Node shadow/glow
  const defs = svg.append('defs');
  defs.append('filter').attr('id', 'node-glow')
    .append('feDropShadow')
    .attr('dx', 0).attr('dy', 2)
    .attr('stdDeviation', 3)
    .attr('flood-opacity', 0.22);

  // Nodes
  const node = g.append('g').attr('class', 'nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', 'node-group')
    .style('cursor', 'pointer');

  // Node circles
  const circles = node.append('circle')
    .attr('r', 0)
    .attr('fill', d => colorForLabel(d.label))
    .attr('stroke', 'white')
    .attr('stroke-width', 2)
    .attr('filter', 'url(#node-glow)');

  // Animate in
  circles.transition()
    .delay((d, i) => i * 30)
    .duration(400)
    .ease(d3.easeCubicOut)
    .attr('r', 14);

  // Node labels
  node.append('text')
    .text(d => d.id)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', 'white')
    .attr('font-family', "'DM Mono', monospace")
    .attr('font-size', '10px')
    .attr('font-weight', '700')
    .attr('pointer-events', 'none')
    .style('opacity', 0)
    .transition().delay((d, i) => i * 30 + 200).duration(300)
    .style('opacity', 1);

  // Tooltip interaction
  const tooltipEl = document.getElementById('tooltip');

  node
    .on('mouseover', function(event, d) {
      d3.select(this).select('circle')
        .transition().duration(120)
        .attr('r', 18)
        .attr('stroke-width', 2.5);

      if (tooltipEl) {
        const deg = adjacency[d.id] ? adjacency[d.id].size : 0;
        tooltipEl.innerHTML = `
          <strong style="font-family:'DM Mono',monospace">Node ${d.id}</strong><br>
          Color class: <span style="color:${colorForLabel(d.label)};font-weight:700">${d.label}</span><br>
          Degree: ${deg}
        `;
        tooltipEl.classList.add('visible');
        tooltipEl.removeAttribute('aria-hidden');
      }
    })
    .on('mousemove', function(event) {
      if (tooltipEl) {
        tooltipEl.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY - 30}px, 0)`;
      }
    })
    .on('mouseout', function() {
      d3.select(this).select('circle')
        .transition().duration(150)
        .attr('r', 14)
        .attr('stroke-width', 2);

      if (tooltipEl) {
        tooltipEl.classList.remove('visible');
        tooltipEl.setAttribute('aria-hidden', 'true');
      }
    });

  // Drag behavior
  const drag = d3.drag()
    .on('start', (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null; d.fy = null;
    });
  node.call(drag);

  // Tick
  simulation.on('tick', () => {
    // Clamp to bounds
    nodes.forEach(d => {
      d.x = Math.max(20, Math.min(W - 20, d.x));
      d.y = Math.max(20, Math.min(H - 20, d.y));
    });

    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);

    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // Return update function for color transitions
  return function updateColors(newColors) {
    node.each(function(d) {
      d.label = newColors[d.id] ?? 0;
    });
    node.select('circle')
      .transition().duration(400).ease(d3.easeCubicInOut)
      .attr('fill', d => colorForLabel(d.label));
  };
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

  // Compute degrees
  const degrees = {};
  for (let i = 0; i < n; i++) degrees[i] = adjacency[i] ? adjacency[i].size : 0;

  // Find anomalies (if comparing, we mark nodes with unique degrees)
  const degFreq = {};
  Object.values(degrees).forEach(d => degFreq[d] = (degFreq[d] || 0) + 1);

  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'deg-row';
    const isAnomaly = degFreq[degrees[i]] === 1 && n > 3;
    row.innerHTML = `
      <span class="deg-node">v${i}</span>
      <span class="deg-val${isAnomaly ? ' anomaly' : ''}">${degrees[i]} edge${degrees[i] !== 1 ? 's' : ''}</span>
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

  // 1. Summary stats
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

  const statsRow = statsCard.querySelector('#stats-row');
  const g1 = graphs[0];
  const g2 = graphs[1];

  const totalNodes = g2 ? g1.n + g2.n : g1.n;
  const totalEdges = g2 ? g1.edges.length + g2.edges.length : g1.edges.length;
  const iters = iterData[0] ? iterData[0].length : 1;
  const colorClasses = iterData[0] ? new Set(Object.values(iterData[0][iterData[0].length - 1])).size : 0;

  const statItems = [
    { label: 'Graphs', value: graphs.length, note: 'analyzed' },
    { label: 'Total Nodes', value: totalNodes, note: `${g2 ? `${g1.n} + ${g2.n}` : 'single graph'}` },
    { label: 'Iterations', value: iters, note: 'WL refinement' },
    { label: 'Color Classes', value: colorClasses, note: 'final partition' },
  ];

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

  // Animate counters
  setTimeout(() => {
    statsRow.querySelectorAll('.stat-value').forEach(el => {
      const target = parseInt(el.dataset.target);
      animateCounter(el, 0, target, 700);
    });
  }, 200);

  // 2. Verdict (only in compare mode)
  if (compareResult) {
    const verdictCard = document.createElement('div');
    const cls = compareResult.isomorphic ? 'pass' : 'fail';
    verdictCard.className = `verdict-card ${cls} anim-slide-up anim-d2`;

    const wlStatus = compareResult.wlMatch ? 'Identical' : 'Different';
    const degStatus = compareResult.degMatch ? 'Match' : 'Mismatch';
    const firstDiffText = compareResult.firstDiff >= 0
      ? `Diverges at iteration ${compareResult.firstDiff}`
      : 'Stable across all iterations';

    verdictCard.innerHTML = `
      <div class="verdict-body">
        <div class="verdict-main">
          <div class="verdict-tag">Isomorphism Verdict</div>
          <div class="verdict-result">${compareResult.isomorphic ? '✓ Isomorphic' : '✗ Non-Isomorphic'}</div>
          <p class="verdict-desc">
            ${compareResult.isomorphic
              ? 'The WL test cannot distinguish these graphs — they may be structurally equivalent. Note: WL is not a complete isomorphism test.'
              : 'The WL test distinguishes these graphs — they are definitively <em>not</em> isomorphic. Their color refinements produce different certificates.'
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
            <span class="signal-name">WL Certificate</span>
            <span class="signal-val">${wlStatus}</span>
            <span class="signal-sub">Final color histogram comparison</span>
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

  // 3. Iteration viewer
  const iterCard = document.createElement('div');
  iterCard.className = 'iter-card anim-slide-up anim-d3';

  const numIters = iterData[0] ? iterData[0].length : 1;
  const tabsHTML = Array.from({ length: numIters }, (_, i) => {
    const hasDiff = compareResult && compareResult.firstDiff === i;
    return `<button class="iter-tab ${i === 0 ? 'active' : ''} ${hasDiff ? 'has-diff' : ''}" data-iter="${i}">
      ${i === 0 ? 'Initial' : `Iter ${i}`}
    </button>`;
  }).join('');

  iterCard.innerHTML = `
    <div class="iter-header">
      <div class="card-header" style="margin-bottom:0">
        <div class="card-eyebrow">WL Refinement</div>
        <h3>Color Iterations</h3>
      </div>
      <div class="iter-tabs-wrap">
        ${tabsHTML}
        ${compareResult && compareResult.firstDiff >= 0
          ? `<div class="diff-banner visible">⚡ Diff at iter ${compareResult.firstDiff}</div>`
          : ''}
      </div>
    </div>
    <div class="graph-grid ${graphs.length === 1 ? 'single' : ''}" id="graph-grid"></div>
  `;
  stack.appendChild(iterCard);

  // Build graph panels
  const graphGrid = iterCard.querySelector('#graph-grid');
  const svgRefs = [];
  const updateFns = [];

  graphs.forEach((graph, gi) => {
    const panelEl = document.createElement('div');
    panelEl.className = 'graph-panel anim-pop-in';
    panelEl.style.animationDelay = (gi * 0.07 + 0.2) + 's';

    const label = gi === 0 ? 'Graph A' : 'Graph B';
    const colors = iterData[gi] ? iterData[gi][0] : {};
    const colorClasses = new Set(Object.values(colors)).size;

    panelEl.innerHTML = `
      <div class="graph-panel-head">
        <div>
          <div class="graph-kicker">${label}</div>
          <h4>${graph.n} nodes, ${graph.edges.length} edges</h4>
        </div>
        <span class="panel-badge" id="panel-badge-${gi}">${colorClasses} colors</span>
      </div>
      <div class="graph-canvas" id="canvas-${gi}">
        <svg class="graph-svg" id="svg-${gi}"></svg>
      </div>
      <div class="graph-footer">
        <span class="graph-chip">n = ${graph.n}</span>
        <span class="graph-chip">m = ${graph.edges.length}</span>
        <span class="graph-chip">Δ = ${Math.max(...Object.values(graph.adjacency).map(s => s.size), 0)}</span>
      </div>
    `;
    graphGrid.appendChild(panelEl);
  });

  // Draw graphs after DOM is stable
  setTimeout(() => {
    graphs.forEach((graph, gi) => {
      const svgEl = document.getElementById(`svg-${gi}`);
      if (!svgEl) return;
      const initialColors = iterData[gi] ? iterData[gi][0] : {};
      const updateFn = drawGraph(svgEl, graph, initialColors, { tooltip: true });
      updateFns.push({ gi, fn: updateFn });
    });
  }, 80);

  // Tab switching
  iterCard.querySelectorAll('.iter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      Audio.play('click');
      iterCard.querySelectorAll('.iter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const iter = parseInt(tab.dataset.iter);

      // Update each graph
      graphs.forEach((_, gi) => {
        if (!iterData[gi]) return;
        const colors = iterData[gi][iter] || iterData[gi][iterData[gi].length - 1];
        const updater = updateFns.find(u => u.gi === gi);
        if (updater) updater.fn(colors);
        const badge = document.getElementById(`panel-badge-${gi}`);
        if (badge) {
          const classes = new Set(Object.values(colors)).size;
          badge.textContent = classes + ' colors';
        }
      });
    });
  });

  // 4. Degree tables
  const tablesCard = document.createElement('div');
  tablesCard.className = `tables-card anim-slide-up anim-d4`;
  tablesCard.innerHTML = `
    <div class="card-header">
      <div class="card-eyebrow">Structural Analysis</div>
      <h3>Degree Distribution</h3>
    </div>
    <div class="tables-grid ${graphs.length === 1 ? 'single' : ''}" id="tables-grid"></div>
  `;
  stack.appendChild(tablesCard);

  const tablesGrid = tablesCard.querySelector('#tables-grid');
  const labels = ['Graph A', 'Graph B'];
  graphs.forEach((graph, gi) => buildDegTable(tablesGrid, graph, labels[gi]));

  area.appendChild(stack);
}

// ---- COUNTER ANIMATION ------------------------------------- 
function animateCounter(el, from, to, duration) {
  const start = performance.now();
  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * ease);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ---- EMPTY STATE ANIMATED GRAPH ---------------------------- 
function drawEmptyStateGraph() {
  const container = document.getElementById('empty-graph');
  if (!container) return;

  const W = 220, H = 180;
  const svg = d3.select(container)
    .append('svg')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('width', W).attr('height', H);

  // Simple example graph for decoration
  const nodes = [
    { id: 0, x: 110, y: 40 },
    { id: 1, x: 50, y: 110 },
    { id: 2, x: 170, y: 110 },
    { id: 3, x: 30, y: 160 },
    { id: 4, x: 110, y: 155 },
    { id: 5, x: 190, y: 155 },
  ];
  const links = [[0,1],[0,2],[1,2],[1,3],[2,5],[1,4],[2,4],[4,5]];
  const palette = ['#4f73ff','#7c5cfc','#0d9e8a','#e67e22','#7c5cfc','#4f73ff'];

  svg.append('g').selectAll('line').data(links).join('line')
    .attr('x1', d => nodes[d[0]].x).attr('y1', d => nodes[d[0]].y)
    .attr('x2', d => nodes[d[1]].x).attr('y2', d => nodes[d[1]].y)
    .attr('stroke', 'rgba(148,163,184,0.35)').attr('stroke-width', 1.5);

  const ng = svg.append('g').selectAll('g').data(nodes).join('g')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  ng.append('circle').attr('r', 0).attr('fill', (d, i) => palette[i])
    .attr('stroke', 'white').attr('stroke-width', 2)
    .transition().delay((d, i) => i * 80).duration(500).ease(d3.easeBackOut)
    .attr('r', 14);

  ng.append('text').text(d => d.id)
    .attr('text-anchor', 'middle').attr('dy', '0.35em')
    .attr('fill', 'white').attr('font-family', "'DM Mono',monospace")
    .attr('font-size', '10').attr('font-weight', '700').attr('pointer-events', 'none')
    .style('opacity', 0).transition().delay((d, i) => i * 80 + 300).duration(300)
    .style('opacity', 1);

  // Cycle colors for ambiance
  let step = 0;
  const colorSets = [
    ['#4f73ff','#7c5cfc','#0d9e8a','#e67e22','#7c5cfc','#4f73ff'],
    ['#e67e22','#4f73ff','#7c5cfc','#0d9e8a','#4f73ff','#7c5cfc'],
    ['#0d9e8a','#e67e22','#4f73ff','#7c5cfc','#0d9e8a','#e67e22'],
  ];

  setInterval(() => {
    step = (step + 1) % colorSets.length;
    svg.selectAll('circle').transition().duration(800).ease(d3.easeCubicInOut)
      .attr('fill', (d, i) => colorSets[step][i]);
  }, 2200);
}

// ---- MAIN RUN ----------------------------------------------
async function runAnalysis() {
  Audio.play('click');

  const file1 = document.getElementById('file1').files[0];
  const file2 = document.getElementById('file2').files[0];
  const k = state.k;

  if (!file1) {
    showError('Please upload at least one graph file to analyze.');
    return;
  }

  if (state.mode === 'compare' && !file2) {
    showError('Compare mode requires two graph files. Please upload Graph B.');
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

    let g2 = null;
    if (state.mode === 'compare' && file2) {
      const text2 = await readFile(file2);
      Progress.set('Parsing Graph B…', 35);
      await delay(60);
      g2 = parseGraph(text2);
    }

    Progress.set('Running WL refinement…', 55);
    await delay(80);

    const iter1 = runWL(g1, k);
    let iter2 = null;
    if (g2) {
      Progress.set('Comparing graphs…', 75);
      await delay(60);
      iter2 = runWL(g2, k);
    }

    Progress.set('Building visualization…', 90);
    await delay(60);

    const graphs = g2 ? [g1, g2] : [g1];
    const iterData = g2 ? [iter1, iter2] : [iter1];
    const compareResult = g2 ? compareGraphs(iter1, iter2) : null;

    Progress.set('Complete!', 100);
    await delay(400);
    Progress.hide();

    renderResults(graphs, iterData, compareResult);
    Audio.play('complete');

  } catch (err) {
    Progress.hide();
    showError('Failed to parse graph: ' + err.message + '. Check the file format.');
    Audio.play('error');
    console.error(err);
  } finally {
    runBtn.classList.remove('loading');
    runBtn.querySelector('.run-btn-label').textContent = 'Run Analysis';
  }
}

function showError(msg) {
  const area = document.getElementById('results-area');
  area.innerHTML = `<div class="banner error anim-slide-up">${msg}</div>`;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- EVENT WIRING ------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  Progress.init();

  // Mode buttons
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

  // k stepper
  const kInput = document.getElementById('k-input');
  const kDisplay = document.getElementById('k-display');

  function setK(val) {
    val = Math.max(1, Math.min(5, val));
    state.k = val;
    kInput.value = val;
    kDisplay.textContent = val;
    // Animate bounce
    kDisplay.style.transform = 'scale(1.3)';
    setTimeout(() => kDisplay.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)', 0);
    setTimeout(() => { kDisplay.style.transform = 'scale(1)'; }, 50);
  }

  document.getElementById('k-dec').addEventListener('click', () => { Audio.play('click'); setK(state.k - 1); });
  document.getElementById('k-inc').addEventListener('click', () => { Audio.play('click'); setK(state.k + 1); });
  kInput.addEventListener('input', () => setK(parseInt(kInput.value) || 1));

  // File uploads
  setupUpload('file1', 'fname1', 'zone1');
  setupUpload('file2', 'fname2', 'zone2');

  // Sound toggle
  const soundBtn = document.getElementById('sound-toggle');
  soundBtn.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    soundBtn.setAttribute('aria-pressed', state.soundEnabled);
    if (state.soundEnabled) Audio.play('click');
  });

  // Run button
  document.getElementById('run-btn').addEventListener('click', runAnalysis);

  // Draw empty state graph
  drawEmptyStateGraph();

  // Ambient bg color shift
  animateBgOrbs();
});

function setupUpload(inputId, fnameId, zoneId) {
  const input = document.getElementById(inputId);
  const fname = document.getElementById(fnameId);
  const zone  = document.getElementById(zoneId);

  input.addEventListener('change', () => {
    if (input.files[0]) {
      fname.textContent = input.files[0].name;
      zone.classList.add('loaded');
      Audio.play('click');
    }
  });

  // Drag-and-drop
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.txt')) {
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
  // Shift hue of orbs slowly over time for ambient effect
  let hue = 0;
  const orb1 = document.querySelector('.orb-1');
  const orb2 = document.querySelector('.orb-2');
  const orb3 = document.querySelector('.orb-3');

  function tick() {
    hue += 0.1;
    if (orb1) orb1.style.background = `radial-gradient(circle, hsla(${220 + Math.sin(hue * 0.01) * 20}, 90%, 65%, 0.09) 0%, transparent 70%)`;
    if (orb2) orb2.style.background = `radial-gradient(circle, hsla(${260 + Math.sin(hue * 0.008 + 2) * 25}, 85%, 62%, 0.08) 0%, transparent 70%)`;
    if (orb3) orb3.style.background = `radial-gradient(circle, hsla(${165 + Math.sin(hue * 0.012 + 4) * 30}, 80%, 50%, 0.06) 0%, transparent 70%)`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}