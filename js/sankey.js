// Define the subfields
const subfieldOrder = [
  "Artificial Intelligence",
  "Computational Theory and Mathematics",
  "Computer Graphics and Computer-Aided Design",
  "Computer Networks and Communications",
  "Computer Science Applications",
  "Computer Vision and Pattern Recognition",
  "Hardware and Architecture",
  "Human-Computer Interaction",
  "Information Systems",
  "Signal Processing",
  "Software",
  "Unknown" // always include fallback
];

// Fixed ordinal color scale
const colorScale = d3.scaleOrdinal()
  .domain(subfieldOrder)
  .range([
    "#d62728", // Artificial Intelligence
    "#393b79", // Computational Theory and Mathematics
    "#ff7f0e", // Computer Graphics and Computer-Aided Design
    "#2ca02c", // Computer Networks and Communications
    "#17becf", // Computer Science Applications
    "#9467bd", // Computer Vision and Pattern Recognition
    "#7f7f0e", // Hardware and Architecture
    "#e377c2", // Human-Computer Interaction
    "#bcbd22", // Information Systems
    "#8c564b", // Signal Processing
    "#1f77b4", // Software
    "#7f7f7f"  // Unknown
  ]);

const W = 1120, H = 760;
const M = { top: 30, right: 20, bottom: 140, left: 20 };
const innerW = W - M.left - M.right;
const innerH = H - M.top - M.bottom;

// Basic DOM targets
const container = d3.select("#viz")
  .style("position", "relative"); // for absolute-positioned UI elements

const svg = container.append("svg")
  .attr("width", W)
  .attr("height", H);

const g = svg.append("g")
  .attr("transform", `translate(${M.left},${M.top})`);

// Tooltip (styled inline)
const tooltip = d3.select("body").append("div")
  .attr("class", "tooltip")
  .style("display", "none")
  .style("position", "absolute")
  .style("pointer-events", "none")
  .style("background", "white")
  .style("border", "1px solid rgba(0,0,0,0.12)")
  .style("padding", "8px")
  .style("border-radius", "6px")
  .style("font-family", "sans-serif")
  .style("font-size", "12px")
  .style("box-shadow", "0 6px 18px rgba(16,24,40,0.08)");

// Side panel (hidden initially) - Notion-like slide-in panel
const sidePanel = container.append("div")
  .attr("id", "sidePanel")
  .style("position", "absolute")
  .style("right", "12px")
  .style("top", "12px")
  .style("width", "380px")
  .style("max-width", "38%")
  .style("height", (H - 24) + "px")
  .style("background", "#fff")
  .style("border", "1px solid rgba(0,0,0,0.08)")
  .style("box-shadow", "0 12px 40px rgba(2,6,23,0.12)")
  .style("border-radius", "8px")
  .style("padding", "16px")
  .style("font-family", "sans-serif")
  .style("font-size", "13px")
  .style("overflow", "auto")
  .style("transform", "translateX(420px)")
  .style("transition", "transform 300ms ease")
  .style("z-index", 1000)
  .style("display", "none"); // initially hidden

function openSidePanel(htmlContent) {
  sidePanel.html(htmlContent).style("display", "block").style("transform", "translateX(0)");
}
function closeSidePanel() {
  sidePanel.style("transform", "translateX(420px)");
  // delay hide to allow transition
  setTimeout(() => sidePanel.style("display", "none"), 320);
}

// Add a small close control at top-right of panel (delegated)
sidePanel.append("div")
  .attr("id", "sideClose")
  .style("position", "absolute")
  .style("right", "10px")
  .style("top", "8px")
  .style("cursor", "pointer")
  .html("✕")
  .on("click", closeSidePanel);

// Colors
const color10 = d3.schemeTableau10;

// ---- Load authors.json ----
d3.json("authors.json").then(rawData => {

  // normalize into array
  const rawArray = Array.isArray(rawData) ? rawData : [rawData];

  if (!rawArray.length) {
    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH / 2)
      .attr("text-anchor", "middle")
      .text("authors.json empty or missing");
    return;
  }

  // ---- Transform raw data into internal author objects ----
  // Keep original metrics for filtering & side panel:
  // We expect fields like "Institution (OpenAlex)", "H-Index", "I10-Index", "Works Count", "Cited By Count", "ORCID", "OpenAlex ID", "Nome", "Cognome"
  const authorsRaw = rawArray.map((a, i) => {
    // safe accessors
    const inst = a["Institution (OpenAlex)"] || a.institution || a.institution_name || "";
    return {
      raw: a,
      id: `A${i + 1}`,
      given_name: a.Nome || "",
      family_name: a.Cognome || "",
      name: ((a.Nome || "") + " " + (a.Cognome || "")).trim(),
      institution: inst,
      hindex: Number(a["H-Index"] ?? a["H_Index"] ?? a.hindex ?? NaN),
      i10index: Number(a["I10-Index"] ?? a.i10 ?? NaN),
      works_count: Number(a["Works Count"] ?? a.works_count ?? NaN),
      cited_by_count: Number(a["Cited By Count"] ?? a.cited_by_count ?? NaN),
      orcid: a.ORCID || "",
      openalex: a["OpenAlex ID"] || a.openalex || "",
      yearly: a.Yearly_Subfields || {}
    };
  });

  // discover overall year range and possible subfields across dataset
  const allYearsSet = new Set();
  const allSubfieldsSet = new Set();

  for (const a of authorsRaw) {
    for (const [yStr, sfObj] of Object.entries(a.yearly || {})) {
      const y = +yStr;
      if (!Number.isNaN(y)) allYearsSet.add(y);
      for (const sf of Object.keys(sfObj || {})) allSubfieldsSet.add(sf);
    }
  }

  // fallback
  if (allYearsSet.size === 0) {
    g.append("text").attr("x", innerW / 2).attr("y", innerH / 2).attr("text-anchor", "middle").text("No years in authors.json");
    return;
  }

  const yearMinAll = d3.min(Array.from(allYearsSet));
  const yearMaxAll = d3.max(Array.from(allYearsSet));

  // We'll maintain a "filteredAuthors" view (authorsRaw filtered by the UI filters)
  let filteredAuthors = authorsRaw.slice();

  // mode: 'entire' (cumulative up to year) or 'year' (only that year's counts)
  let mainMode = 'entire';

  // helper: compute cumulative counts up to year OR counts only in that year
  function countsFor(author, year, mode = mainMode) {
    // returns {sf: count}
    const out = {};
    for (const [yStr, sfObj] of Object.entries(author.yearly || {})) {
      const y = +yStr;
      if (Number.isNaN(y)) continue;
      if (mode === 'entire') {
        if (y > year) continue;
        for (const [sf, c] of Object.entries(sfObj || {})) out[sf] = (out[sf] || 0) + Number(c || 0);
      } else { // 'year' specific
        if (y !== year) continue;
        for (const [sf, c] of Object.entries(sfObj || {})) out[sf] = (out[sf] || 0) + Number(c || 0);
      }
    }
    return out;
  }

  // compute main subfield for an author at year given mode
  function mainSubfieldFor(author, year, mode = mainMode) {
    const c = countsFor(author, year, mode);
    let best = { sf: "Unknown", cnt: 0 };
    for (const [sf, cnt] of Object.entries(c)) {
      const n = Number(cnt || 0);
      if (n > best.cnt || (n === best.cnt && sf < best.sf)) best = { sf, cnt: n };
    }
    return best.sf;
  }

  // isActive by counts > 0 up to year (for mode 'entire' this is cumulative; for 'year' it's presence in that year)
  function isActiveBy(author, year, mode = mainMode) {
    const c = countsFor(author, year, mode);
    return Object.values(c).some(v => v > 0);
  }

  // Master state
  let currentYear = yearMinAll;

  // UI: filters panel (top-left)
  const filterPanel = container.append("div")
    .attr("id", "filterPanel")
    .style("position", "absolute")
    .style("left", "12px")
    .style("top", "110px")
    .style("background", "#fff")
    .style("padding", "8px")
    .style("border-radius", "8px")
    .style("box-shadow", "0 8px 22px rgba(2,6,23,0.06)")
    .style("font-family", "sans-serif")
    .style("font-size", "12px")
    .style("z-index", 900);

  filterPanel.append("div").style("font-weight", "700").text("Filters");

  // text filters: name / surname
  filterPanel.append("div").style("margin-top", "6px").html(`<input id="nameFilter" placeholder="Name contains" style="width:160px;padding:6px;border-radius:4px;border:1px solid #ddd">`);
  filterPanel.append("div").style("margin-top", "6px").html(`<input id="surnameFilter" placeholder="Surname contains" style="width:160px;padding:6px;border-radius:4px;border:1px solid #ddd">`);
  // institution
  filterPanel.append("div").style("margin-top", "6px").html(`<input id="instFilter" placeholder="Institution contains" style="width:160px;padding:6px;border-radius:4px;border:1px solid #ddd">`);

  // numeric filters with operator selector
  function numericFilterRow(label, idBase) {
    const row = filterPanel.append("div").style("margin-top", "6px");
    row.append("select")
      .attr("id", idBase + "_op")
      .style("padding", "6px")
      .style("margin-right", "6px")
      .html(`<option value=">=">&ge;</option><option value="=">=</option><option value="<=">&le;</option>`);
    row.append("input")
      .attr("id", idBase + "_val")
      .attr("placeholder", label)
      .style("width", "100px")
      .style("padding", "6px")
      .style("border-radius", "4px")
      .style("border", "1px solid #ddd");
  }
  numericFilterRow("H-Index", "hindex");
  numericFilterRow("I10-Index", "i10");
  numericFilterRow("Works Count", "works");
  numericFilterRow("Cited By", "cited");

  // Apply / Reset buttons
  const buttonsDiv = filterPanel.append("div").style("margin-top", "8px");
  buttonsDiv.append("button").text("Apply").style("padding", "6px 8px").style("margin-right", "6px").on("click", applyFilters);
  buttonsDiv.append("button").text("Reset").style("padding", "6px 8px").on("click", resetFilters);

  // Mode toggle: entire vs specific year
  const modeDiv = container.append("div")
    .style("position", "absolute")
    .style("left", "12px")
    .style("top", "36px")
    .style("background", "#fff")
    .style("padding", "8px")
    .style("border-radius", "8px")
    .style("box-shadow", "0 8px 22px rgba(2,6,23,0.06)")
    .style("font-family", "sans-serif")
    .style("font-size", "12px")
    .style("z-index", 900);

  modeDiv.append("div").style("font-weight", "700").text("Main subfield mode");
  const modeButtons = modeDiv.append("div").style("margin-top", "6px");
  const entireBtn = modeButtons.append("button").text("Entire career").style("padding", "6px 8px").style("margin-right", "6px").on("click", () => { mainMode = 'entire'; updateAll(true); updateModeButtons(); });
  const yearBtn = modeButtons.append("button").text("Specific year").style("padding", "6px 8px").on("click", () => { mainMode = 'year'; updateAll(true); updateModeButtons(); });
  function updateModeButtons() {
    entireBtn.style("background", mainMode === 'entire' ? "#2563eb" : "#fff").style("color", mainMode === 'entire' ? "#fff" : "#000");
    yearBtn.style("background", mainMode === 'year' ? "#2563eb" : "#fff").style("color", mainMode === 'year' ? "#fff" : "#000");
  }
  updateModeButtons();

  // Year slider and autoplay UI (bottom area)
  const centerX = innerW / 2;
  const centerY = innerH / 2 - 40;

  // We will create the axis and slider track now, but cluster centers and mapping updated later
  const xScale = d3.scaleLinear().domain([yearMinAll, yearMaxAll]).range([60, innerW - 60]);

  // Build tick years set (Start, multiples of 5 from 1980..., End)
  const tickSet = new Set();
  tickSet.add(yearMinAll);
  for (let y = Math.max(1950, yearMinAll); y <= yearMaxAll; y += 5) tickSet.add(y);
  tickSet.add(yearMaxAll);
  const tickYears = Array.from(tickSet).sort((a, b) => a - b);

  const xAxis = d3.axisBottom(xScale).tickValues(tickYears).tickFormat(y => (y === yearMinAll ? "Start" : (y === yearMaxAll ? "End" : y)));

  g.append("g").attr("class", "axis").attr("transform", `translate(0, ${innerH})`).call(xAxis)
    .selectAll("text").style("font-family", "sans-serif").style("font-size", "11px").style("fill", "#0f172a");

  const sliderG = g.append("g").attr("transform", `translate(0, ${innerH})`);

  sliderG.append("line")
    .attr("x1", xScale.range()[0]).attr("x2", xScale.range()[1]).attr("y1", 0).attr("y2", 0)
    .attr("stroke", "#e6eef9").attr("stroke-width", 10).attr("stroke-linecap", "round");

  const trackLeft = sliderG.append("rect")
    .attr("x", xScale.range()[0]).attr("y", -6).attr("width", xScale(currentYear) - xScale.range()[0]).attr("height", 12)
    .attr("rx", 6).attr("fill", "#c7ddff").attr("opacity", 0.95);

  const handle = sliderG.append("circle")
    .attr("class", "handle")
    .attr("r", 10)
    .attr("cx", xScale(currentYear))
    .attr("cy", 0)
    .attr("fill", "#2563eb")
    .attr("stroke", "#123a8a")
    .attr("stroke-width", 2)
    .style("cursor", "pointer")
    .style("filter", "drop-shadow(0 3px 6px rgba(16,24,40,0.12))");

  // Big year label
  const yearLabel = g.append("text")
    .attr("x", innerW / 2)
    .attr("y", innerH + 56)
    .attr("text-anchor", "middle")
    .attr("font-size", "44px")
    .attr("font-weight", "700")
    .attr("fill", "#0f172a")
    .text(currentYear);

  // Autoplay button (right of slider)
  const playX = innerW - 30;
  const playBtn = sliderG.append("g").attr("transform", `translate(${playX}, 0)`).style("cursor", "pointer");
  playBtn.append("rect").attr("x", -22).attr("y", -22).attr("width", 44).attr("height", 44).attr("rx", 8).attr("fill", "#2563eb");
  const playIcon = playBtn.append("text").attr("text-anchor", "middle").attr("alignment-baseline", "middle").attr("fill", "#fff").attr("font-size", "18px").text("▶");

  let autoplay = false;
  let autoplayInterval = null;

  playBtn.on("click", () => {
    autoplay = !autoplay;
    playIcon.text(autoplay ? "⏸" : "▶");

    if (autoplay) {
      if (!autoplayInterval) {
        autoplayInterval = d3.interval(() => {
          let nextYear = currentYear + 1;
          if (nextYear > yearMaxAll) nextYear = yearMinAll; // wrap
          setYear(nextYear, true);
        }, 1000);
      }
    } else {
      if (autoplayInterval) {
        autoplayInterval.stop();
        autoplayInterval = null;
      }
    }
  });

  // Drag anywhere on sliderG
  sliderG.call(d3.drag().on("start drag", (event) => {
    const px = Math.max(xScale.range()[0], Math.min(xScale.range()[1], event.x));
    const yr = Math.round(xScale.invert(px));
    setYear(yr, true);
  }));

  // Phantom toggle button
  let showPhantoms = true;
  const phantomToggle = container.append("button")
    .attr("id", "phantomToggle")
    .style("position", "absolute")
    .style("left", "10px")
    .style("top", "10px")
    .text("Hide Phantoms")
    .on("click", function () {
      showPhantoms = !showPhantoms;
      d3.select(this).text(showPhantoms ? "Hide Phantoms" : "Show Phantoms");
      updatePhantoms(); updateClustersAndLabels();
    });

  // --- Dynamically created cluster centers, nodes, simulation, layers ---
  let clusterKeys = []; // current visible cluster keys
  let clusterCenterMap = new Map(); // mapping sf-> {x,y}

  const phantomLayer = g.append("g").attr("class", "phantomLayer");
  const nodesLayer = g.append("g").attr("class", "nodesLayer");
  const labelLayer = g.append("g").attr("class", "labelLayer");

  // initially, we'll create nodes from filteredAuthors (filteredAuthors is authorsRaw filtered)
  filteredAuthors = authorsRaw.slice(); // initial no filter

  // nodes dataset: one node per filtered author (with dynamic subfield and active)
  let nodes = []; // {id,name,authorRef,subfield,active,x,y,...}

  function rebuildNodes() {
    const prevNodesById = new Map(nodes.map(d => [d.id, d])); // store old positions
    nodes = filteredAuthors.map(a => {
      const sf = mainSubfieldFor(a, currentYear, mainMode);
      const active = isActiveBy(a, currentYear, mainMode);
      const prev = prevNodesById.get(a.id);
      return {
        id: a.id,
        author: a,
        name: a.name,
        institution: a.institution,
        hindex: a.hindex,
        i10index: a.i10index,
        works_count: a.works_count,
        cited_by_count: a.cited_by_count,
        orcid: a.orcid,
        openalex: a.openalex,
        rawYearly: a.yearly,
        history: a.history,
        subfield: sf,
        active,
        x: prev ? prev.x : centerX,
        y: prev ? prev.y : centerY,
        vx: 0, vy: 0
      };
    });
  }

  rebuildNodes();

  // Simulation
  let simulation = createSimulation();

  function createSimulation() {
    return d3.forceSimulation(nodes)
      .alphaMin(0.001)
      .velocityDecay(0.35)
      .force("x", d3.forceX(d => (clusterCenterMap.get(d.subfield)?.x ?? centerX)).strength(0.14))
      .force("y", d3.forceY(d => (clusterCenterMap.get(d.subfield)?.y ?? centerY)).strength(0.14))
      .force("collide", d3.forceCollide(3.8).strength(0.95))
      .on("tick", ticked);
  }

  // D3 selections for nodes (update pattern)
  let dotsSel = nodesLayer.selectAll("circle").data(nodes, d => d.id);
  dotsSel.exit().remove();
  dotsSel = nodesLayer.selectAll("circle").data(nodes, d => d.id)
    .join(
      enter => enter.append("circle")
        .attr("r", 3.3)
        .attr("opacity", d => d.active ? 0.95 : 0)
        .attr("pointer-events", d => d.active ? "all" : "none")
        .attr("fill", "#aaa")
        .on("mousemove", (event, d) => {
          const cs = countsFor(d.author, currentYear, mainMode);
          const items = Object.entries(cs).sort((a, b) => b[1] - a[1]);
          const maxCount = items.length ? Math.max(...items.map(([_, c]) => c)) : 1;

          // SVG dimensions
          const barHeight = 18;
          const barSpacing = 4;
          const svgWidth = 200;
          const svgHeight = items.length * (barHeight + barSpacing);

          // Build SVG HTML
          const svgHtml = `
            <svg width="${svgWidth}" height="${svgHeight}">
            ${items.map(([sf, c], i) => {
            const barWidth = (c / maxCount) * svgWidth;
            const y = i * (barHeight + barSpacing);
            const color = colorScale(sf);
            return `
            <rect x="0" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}"></rect>
            <text x="5" y="${y + barHeight / 2 + 5}" font-size="12" font-weight="700" fill="#000">${c}</text>
            <text x="27" y="${y + barHeight / 2 + 2}" font-size="12" font-weight="700" fill="#000" dominant-baseline="middle" style="pointer-events:none">${escapeHTML(sf)}</text>
            `;
          }).join('')}
          </svg>
          `;

          tooltip.style("display", "block")
            .style("left", `${event.pageX + 12}px`)
            .style("top", `${event.pageY + 12}px`)
            .html(`
            <div style="font-weight:700">${escapeHTML(d.name)}</div>
            <div style="margin-top:6px">Main: <b>${escapeHTML(d.subfield)}</b></div>
            <div style="margin-top:6px">Institution: ${escapeHTML(d.institution || "—")}</div>
            <div style="margin-top:12px">Subfields Occurrences (${mainMode === 'entire' ? 'up to' : 'in'} ${currentYear}):</div>
            <div style="margin:6px 0 0 0;position:relative">${svgHtml}</div>
          `);
        })
        .on("mouseout", () => tooltip.style("display", "none"))
        .on("click", (event, d) => {
          // open side panel for d
          const raw = d.author;
          const orcidHtml = raw.orcid ? `<div>ORCID: <a href="https://orcid.org/${encodeURIComponent(raw.orcid)}" target="_blank" rel="noopener noreferrer">${escapeHTML(raw.orcid)}</a></div>` : "";
          const openalexHtml = raw.openalex ? `<div>OpenAlex: <a href="${escapeHTML(raw.openalex)}" target="_blank" rel="noopener noreferrer">${escapeHTML(raw.openalex)}</a></div>` : "";
          const html = `<div style="display:flex;justify-content:space-between;align-items:center;">
                          <h2 style="margin:0;padding:0">${escapeHTML(d.name)}</h2>
                        </div>
                        <div style="margin-top:10px"><b>Institution:</b> ${escapeHTML(d.institution || "—")}</div>
                        <div style="margin-top:6px"><b>Main subfield (${mainMode === 'entire' ? 'cumulative' : 'year-only'}):</b> ${escapeHTML(d.subfield)}</div>
                        <div style="margin-top:10px">
                          <b>Metrics</b>
                          <ul style="margin:6px 0 0 18px;padding:0">
                            <li>H-Index: ${isNaN(d.hindex) ? "—" : d.hindex}</li>
                            <li>I10-Index: ${isNaN(d.i10index) ? "—" : d.i10index}</li>
                            <li>Works Count: ${isNaN(d.works_count) ? "—" : d.works_count}</li>
                            <li>Cited By: ${isNaN(d.cited_by_count) ? "—" : d.cited_by_count}</li>
                          </ul>
                        </div>
                        <div style="margin-top:10px">${orcidHtml}${openalexHtml}</div>
                        <div style="margin-top:10px">
                          <button id="sideCloseBtn" style="padding:6px 8px;border-radius:6px;border:0;background:#2563eb;color:#fff;cursor:pointer">Close</button>
                        </div>`;
          openSidePanel(html);
          // hook close
          d3.select("#sideCloseBtn").on("click", closeSidePanel);
        }),
      update => update,
      exit => exit.remove()
    );

  // compute dynamic clusters (subfields to show) based on filteredAuthors and phantom presence
  function computeVisibleSubfields(year) {
    const present = new Set();
    // authors active in this filtered set at year (mode-aware)
    for (const a of filteredAuthors) {
      const cs = countsFor(a, year, mainMode);
      for (const [sf, cnt] of Object.entries(cs)) {
        if (cnt > 0) present.add(sf);
      }
    }
    // also include phantom target subfields (which are computed from counts >0 for authors)
    // but since phantom logic uses countsFor above, present already includes them
    return Array.from(present).sort();
  }

  // update cluster centers mapping based on visible subfields
  function updateClustersAndLabels() {
    const visible = computeVisibleSubfields(currentYear);
    clusterCenterMap = new Map();
    if (visible.length === 0) visible.push("Unknown");

    const rCluster = Math.min(innerW, innerH) * 0.35;   // cluster circle radius
    const rLabel = Math.min(innerW, innerH) * 0.45;   // outer circle for labels
    const angleStep = (2 * Math.PI) / visible.length;

    visible.forEach((sf, i) => {
      const angle = i * angleStep - Math.PI / 2;
      clusterCenterMap.set(sf, {
        x: centerX + rCluster * Math.cos(angle),
        y: centerY + rCluster * Math.sin(angle),
        angle: angle
      });
    });
    clusterCenterMap.set("Unknown", { x: centerX, y: centerY, angle: 0 });
    clusterKeys = Array.from(clusterCenterMap.keys());

    // draw cluster labels outside clusters
    const labelsData = clusterKeys;
    const activeNodes = nodes.filter(n => n.active);
    const counts = d3.rollup(activeNodes, v => v.length, d => d.subfield);
    const total = activeNodes.length || 1;

    const labels = labelLayer.selectAll("g.label").data(labelsData, d => d);
    const enter = labels.enter().append("g").attr("class", "label");
    enter.append("text").attr("class", "cluster-label").style("font-family", "sans-serif").style("font-size", "12px");

    const merged = enter.merge(labels);
    merged.attr("transform", d => {
      const { angle } = clusterCenterMap.get(d);
      const x = centerX + rLabel * Math.cos(angle);
      const y = centerY + rLabel * Math.sin(angle);
      return `translate(${x}, ${y})`;
    })
      .style("text-anchor", d => {
        const angle = clusterCenterMap.get(d).angle;
        return (angle > -Math.PI / 2 && angle < Math.PI / 2) ? "start" : "end";
      });

    merged.select("text")
      .selectAll("tspan")
      .data(d => {
        if (d == "Artificial Intelligence") d_short = "AI";
        else if (d == "Computational Theory and Mathematics") d_short = "CT & Math";
        else if (d == "Computer Graphics and Computer-Aided Design") d_short = "CG & CAD";
        else if (d == "Computer Networks and Communications") d_short = "Net & Comm";
        else if (d == "Computer Science Applications") d_short = "CS App";
        else if (d == "Computer Vision and Pattern Recognition") d_short = "CV & PR";
        else if (d == "Hardware and Architecture") d_short = "HW & Arch";
        else if (d == "Human-Computer Interaction") d_short = "HCI";
        else if (d == "Information Systems") d_short = "Info Sys";
        else if (d == "Signal Processing") d_short = "Signal";
        else if (d == "Software") d_short = "Software";
        else if (d == "Unknown") d_short = "Unknown";
        const pct = ((counts.get(d) || 0) / total * 100);
        return [d_short, `${pct.toFixed(1)}%`]; // two lines
      })
      .join("tspan")
      .text(d => d)
      .attr("x", 0)
      .attr("dy", (d, i) => i === 0 ? 0 : "1.2em"); // first line stays, second line moves down

    labels.exit().remove();
  }


  // Phantom computation: returns array of {parent, subfield, count, tx, ty}
  function computePhantomsForYear(year) {
    const out = [];
    for (const n of nodes) {
      if (!isActiveBy(n.author, year, mainMode)) continue;
      const counts = countsFor(n.author, year, mainMode);
      const main = mainSubfieldFor(n.author, year, mainMode);
      for (const [sf, cnt] of Object.entries(counts)) {
        if (cnt > 0 && sf !== main) {
          // only include if cluster center exists (we will compute cluster centers before calling this)
          if (clusterCenterMap.has(sf)) {
            out.push({ parent: n, subfield: sf, count: Number(cnt || 0), tx: clusterCenterMap.get(sf).x, ty: clusterCenterMap.get(sf).y });
          }
        }
      }
    }
    return out;
  }

  let phantomData = [];

  function updatePhantoms() {
    phantomData = computePhantomsForYear(currentYear);
    // determine normalization for opacity scaling 0.01 - 0.30
    const counts = phantomData.map(d => d.count);
    const maxCount = counts.length ? d3.max(counts) : 1;
    // set mapping
    const opacityScale = d3.scaleLinear().domain([0, maxCount]).range([0.01, 0.30]);

    // LINKS
    const links = phantomLayer.selectAll("line").data(showPhantoms ? phantomData : [], d => `${d.parent.id}-${d.subfield}`);
    links.join(
      enter => enter.append("line")
        .attr("stroke", "#999")
        .attr("stroke-width", d => Math.max(0.4, Math.log(d.count + 1) * 0.45))
        .attr("opacity", d => opacityScale(d.count)),
      update => update.attr("stroke-width", d => Math.max(0.4, Math.log(d.count + 1) * 0.45)).attr("opacity", d => opacityScale(d.count)),
      exit => exit.remove()
    );

    // PHANTOM DOTS
    /*
    const pDots = phantomLayer.selectAll(".phantom-dot").data(showPhantoms ? phantomData : [], d => `${d.parent.id}-${d.subfield}`);
    pDots.join(
      enter => enter.append("circle").attr("class", "phantom-dot").attr("r", 5.8).attr("fill", d => colorScale(d.subfield)).attr("opacity", d => Math.max(0.01, opacityScale(d.count))),
      update => update.attr("opacity", d => Math.max(0.01, opacityScale(d.count))),
      exit => exit.remove()
    );

    // position phantom dots at cluster centers
    phantomLayer.selectAll(".phantom-dot").attr("cx", d => d.tx).attr("cy", d => d.ty);
    */
  }

  // Tick behavior
  function ticked() {
    // node positions
    nodesLayer.selectAll("circle").attr("cx", d => d.x).attr("cy", d => d.y);

    // phantom links endpoints: parent -> cluster center
    phantomLayer.selectAll("line")
      .attr("x1", d => d.parent.x)
      .attr("y1", d => d.parent.y)
      .attr("x2", d => d.tx)
      .attr("y2", d => d.ty);
  }

  // update D3 nodes binding when nodes array changes
  function updateNodeSelection() {
    // join new nodes
    const sel = nodesLayer.selectAll("circle").data(nodes, d => d.id);
    sel.exit().remove();
    sel.enter().append("circle")
      .attr("r", 3.3)
      .attr("opacity", d => d.active ? 0.95 : 0)
      .attr("pointer-events", d => d.active ? "all" : "none")
      .attr("fill", d => colorScale(d.subfield))
      .on("mousemove", (event, d) => {
        const cs = countsFor(d.author, currentYear, mainMode);
        const items = Object.entries(cs).sort((a, b) => b[1] - a[1]);
        const maxCount = items.length ? Math.max(...items.map(([_, c]) => c)) : 1;

        // SVG dimensions
        const barHeight = 18;
        const barSpacing = 4;
        const svgWidth = 200;
        const svgHeight = items.length * (barHeight + barSpacing);

        // Build SVG HTML
        const svgHtml = `
            <svg width="${svgWidth}" height="${svgHeight}">
            ${items.map(([sf, c], i) => {
          const barWidth = (c / maxCount) * svgWidth;
          const y = i * (barHeight + barSpacing);
          const color = colorScale(sf);
          return `
            <rect x="0" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}"></rect>
            <text x="5" y="${y + barHeight / 2 + 5}" font-size="12" font-weight="700" fill="#000">${c}</text>
            <text x="27" y="${y + barHeight / 2 + 2}" font-size="12" font-weight="700" fill="#000" dominant-baseline="middle" style="pointer-events:none">${escapeHTML(sf)}</text>
            `;
        }).join('')}
          </svg>
          `;

        tooltip.style("display", "block")
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY + 12}px`)
          .html(`
            <div style="font-weight:700">${escapeHTML(d.name)}</div>
            <div style="margin-top:6px">Main: <b>${escapeHTML(d.subfield)}</b></div>
            <div style="margin-top:6px">Institution: ${escapeHTML(d.institution || "—")}</div>
            <div style="margin-top:12px">Subfields Occurrences (${mainMode === 'entire' ? 'up to' : 'in'} ${currentYear}):</div>
            <div style="margin:6px 0 0 0;position:relative">${svgHtml}</div>
          `);
      })
      .on("mouseout", () => tooltip.style("display", "none"))
      .on("click", (event, d) => {
        const orcidHtml = d.orcid ? `<div>ORCID: <a href="https://orcid.org/${encodeURIComponent(d.orcid)}" target="_blank" rel="noopener noreferrer">${escapeHTML(d.orcid)}</a></div>` : "";
        const openalexHtml = d.openalex ? `<div>OpenAlex: <a href="${escapeHTML(d.openalex)}" target="_blank" rel="noopener noreferrer">${escapeHTML(d.openalex)}</a></div>` : "";
        const html = `<div style="display:flex;justify-content:space-between;align-items:center;"><h2 style="margin:0">${escapeHTML(d.name)}</h2></div>
                      <div style="margin-top:10px"><b>Institution:</b> ${escapeHTML(d.institution || "—")}</div>
                      <div style="margin-top:6px"><b>Main subfield:</b> ${escapeHTML(d.subfield)}</div>
                      <div style="margin-top:10px"><b>Metrics</b><ul style="margin:6px 0 0 18px;padding:0"><li>H-Index: ${isNaN(d.hindex) ? "—" : d.hindex}</li><li>I10-Index: ${isNaN(d.i10index) ? "—" : d.i10index}</li><li>Works Count: ${isNaN(d.works_count) ? "—" : d.works_count}</li><li>Cited By: ${isNaN(d.cited_by_count) ? "—" : d.cited_by_count}</li></ul></div>
                      <div style="margin-top:8px">${orcidHtml}${openalexHtml}</div>
                      <div style="margin-top:12px"><button id="sideCloseBtn" style="padding:6px 8px;border-radius:6px;border:0;background:#2563eb;color:#fff;cursor:pointer">Close</button></div>`;
        openSidePanel(html);
        d3.select("#sideCloseBtn").on("click", closeSidePanel);
      });

    // update attributes for existing selection
    nodesLayer.selectAll("circle")
      .attr("opacity", d => d.active ? 0.95 : 0)
      .attr("pointer-events", d => d.active ? "all" : "none")
      .attr("fill", d => colorScale(d.subfield));
  }

  // setYear: main update function for the visualization. Preserves everything.
  function setYear(year, animate) {
    if (year < yearMinAll) year = yearMinAll;
    if (year > yearMaxAll) year = yearMaxAll;
    currentYear = Math.round(year);

    // update slider visuals
    const cx = xScale(currentYear);
    handle.attr("cx", cx);
    trackLeft.attr("width", cx - xScale.range()[0]);
    yearLabel.text(currentYear);

    // Recompute filteredAuthors' nodes main subfield & active flags
    rebuildNodes();
    // Recompute visible clusters based on filtered authors and phantom targets
    // computeVisibleSubfields uses filteredAuthors and counts
    // rebuild cluster centers
    const visibleSubfields = computeVisibleSubfields(currentYear);
    // If none visible, ensure Unknown
    if (visibleSubfields.length === 0) visibleSubfields.push("Unknown");
    // assign cluster centers on circle
    clusterCenterMap = new Map();
    const r = Math.min(innerW, innerH) * 0.35;
    for (let i = 0; i < visibleSubfields.length; i++) {
      const sf = visibleSubfields[i];
      const angle = (i / visibleSubfields.length) * 2 * Math.PI - Math.PI / 2;
      clusterCenterMap.set(sf, { x: centerX + r * Math.cos(angle), y: centerY + r * Math.sin(angle) });
    }
    clusterCenterMap.set("Unknown", { x: centerX, y: centerY });
    clusterKeys = Array.from(clusterCenterMap.keys());

    // update nodes array (recreate so simulation rebinds)
    // preserve existing x/y if possible
    const prevPositions = new Map(nodes.map(n => [n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy }]));
    nodes = filteredAuthors.map(a => {
      const sf = mainSubfieldFor(a, currentYear, mainMode);
      const active = isActiveBy(a, currentYear, mainMode);
      const prev = prevPositions.get(a.id) || {};
      return {
        id: a.id,
        author: a,
        name: a.name,
        institution: a.institution,
        hindex: a.hindex,
        i10index: a.i10index,
        works_count: a.works_count,
        cited_by_count: a.cited_by_count,
        orcid: a.orcid,
        openalex: a.openalex,
        rawYearly: a.yearly,
        history: a.history,
        subfield: sf,
        active,
        x: prev.x ?? (centerX + (Math.random() - 0.5) * 20),
        y: prev.y ?? (centerY + (Math.random() - 0.5) * 20),
        vx: prev.vx ?? 0,
        vy: prev.vy ?? 0
      };
    });

    // restart simulation with new nodes & updated forces
    if (simulation) simulation.stop();
    simulation = d3.forceSimulation(nodes)
      .alphaMin(0.001)
      .velocityDecay(0.35)
      .force("x", d3.forceX(d => (clusterCenterMap.get(d.subfield)?.x ?? centerX)).strength(0.14))
      .force("y", d3.forceY(d => (clusterCenterMap.get(d.subfield)?.y ?? centerY)).strength(0.14))
      .force("collide", d3.forceCollide(3.8).strength(0.95))
      .on("tick", ticked);

    // rebind nodes selection
    updateNodeSelection();

    // update labels and phantoms
    updateClustersAndLabels();
    updatePhantoms();

    // animate if asked
    if (animate) simulation.alpha(0.8).restart();
  }

  // Apply filters: read UI values, filter authorsRaw into filteredAuthors, then update view
  function applyFilters() {
    const nameSub = (document.getElementById("nameFilter").value || "").trim().toLowerCase();
    const surnameSub = (document.getElementById("surnameFilter").value || "").trim().toLowerCase();
    const instSub = (document.getElementById("instFilter").value || "").trim().toLowerCase();

    const hOp = document.getElementById("hindex_op").value;
    const hNum = document.getElementById("hindex_val").value.trim();
    const i10Op = document.getElementById("i10_op").value;
    const i10Num = document.getElementById("i10_val").value.trim();
    const worksOp = document.getElementById("works_op").value;
    const worksNum = document.getElementById("works_val").value.trim();
    const citedOp = document.getElementById("cited_op").value;
    const citedNum = document.getElementById("cited_val").value.trim();

    filteredAuthors = authorsRaw.filter(a => {
      if (nameSub && !a.name.toLowerCase().includes(nameSub)) return false;
      if (surnameSub && !a.family_name.toLowerCase().includes(surnameSub)) return false;
      if (instSub && !a.institution.toLowerCase().includes(instSub)) return false;

      // Numeric filters
      const checks = [
        [hOp, a.hindex, hNum],
        [i10Op, a.i10index, i10Num],
        [worksOp, a.works_count, worksNum],
        [citedOp, a.cited_by_count, citedNum]
      ];

      for (const [op, val, numStr] of checks) {
        if (numStr.trim() === "") continue;
        const num = Number(numStr);
        if (op === ">=" && !(val >= num)) return false;
        if (op === "<=" && !(val <= num)) return false;
        if (op === "=" && !(val === num)) return false;
      }

      return true;
    });

    // After filter, update visualization at the same year
    setYear(currentYear, true);
  }

  // reset filters to empty and show all authors
  function resetFilters() {
    document.getElementById("nameFilter").value = "";
    document.getElementById("surnameFilter").value = "";
    document.getElementById("instFilter").value = "";
    document.getElementById("hindex_val").value = "";
    document.getElementById("i10_val").value = "";
    document.getElementById("works_val").value = "";
    document.getElementById("cited_val").value = "";
    filteredAuthors = authorsRaw.slice();
    setYear(currentYear, true);
  }

  // updateAll wrapper for when mode changes
  function updateAll(animate) {
    // re-filter (we keep current filter inputs as-is)
    // filteredAuthors already reflect filters; so just setYear
    setYear(currentYear, animate);
  }

  // utility escapeHTML
  function escapeHTML(s) {
    return String(s || "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[m]));
  }

  // initial render
  setYear(currentYear, false);

  // cleanup timers on unload
  window.addEventListener("beforeunload", () => { clearAutoplay(); });

}).catch(err => {
  console.error("Failed to load authors.json:", err);
  g.append("text").attr("x", innerW / 2).attr("y", innerH / 2).attr("text-anchor", "middle").text("Error loading authors.json — see console");
});
