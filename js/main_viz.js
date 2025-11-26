/*
  main_viz.js
  Integrated visualization of Computer Science authors by subfield.
  Requires: d3.v7 loaded in the HTML.

  Copyright 2025 Marco Monteverde
  License: MIT

  Notes: Phantom link opacity scaled 0.01 - 0.30 based on phantom count
*/

window.console.log("Module started!");

import { subfieldOrder, colorScale } from "./common.js";
import { W, H, M, innerW, innerH, escapeHTML } from "./common.js";

// Basic DOM targets
const container = d3.select("#viz")
	.style("position", "relative"); // for absolute-positioned UI elements

const svg = container.append("svg")
	.attr("width", W)
	.attr("height", H);

const g = svg.append("g")
	.attr("transform", `translate(${M.left},${M.top})`);

const groupMetricDiv = container.append("div")
	.attr("id", "groupMetric")
	.style("position", "absolute")
	.style("left", "12px")
	.style("top", "480px")
	.style("background", "#fff")
	.style("padding", "8px 12px")
	.style("border-radius", "8px")
	.style("box-shadow", "0 8px 22px rgba(2,6,23,0.06)")
	.style("font-family", "sans-serif")
	.style("font-size", "12px")
	.style("z-index", 950)
	.text(""); // will update dynamically

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

// ---- Load authors.json ----
d3.json("./json/authors.json").then(rawData => {

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
	const normalizeYearly = obj => {
		const out = {};
		for (const [y, val] of Object.entries(obj || {})) {
			out[String(y)] = val;
		}
		return out;
	};

	const authorsRaw = rawArray.map((a, i) => {
		const inst = a["Institution (OpenAlex)"] || a.institution || a.institution_name || "";
		return {
			raw: a,
			id: `A${i + 1}`,
			given_name: a.Nome || "",
			family_name: a.Cognome || "",
			name: ((a.Nome || "") + " " + (a.Cognome || "")).trim(),
			institution: inst,
			hindex: Number(a["H-Index"] ?? a.H_Index ?? a.hindex ?? NaN),
			i10index: Number(a["I10-Index"] ?? a.i10 ?? NaN),
			works_count: Number(a["Works Count"] ?? a.works_count ?? NaN),
			cited_by_count: Number(a["Cited By Count"] ?? a.cited_by_count ?? NaN),
			orcid: a.ORCID || "",
			openalex: a["OpenAlex ID"] || a.openalex || "",
			yearly: a.Yearly_Subfields || {},
			yearly_topics: normalizeYearly(a.Yearly_Topics || {}),
			yearly_fields: normalizeYearly(a.Yearly_Fields || {})
		};
	});

	// Precompute counts per author for optimization #3
	authorsRaw.forEach(a => {
		// initialize unified cache object
		a._cache = {
			year: {},         // per-year subfield counts (for Force 'year' mode)
			entire: {},       // cumulative subfield counts up to year (for Force 'entire' mode)
			sankeyYear: {},   // per-year pair counts (for Sankey 'year' mode)
			sankeyEntire: {}  // cumulative pair counts up to year (for Sankey 'entire' mode)
		};

		// 1) Build subfield counts per year (Force)
		// a.yearly was set earlier when mapping authorsRaw (a.Yearly_Subfields || {})
		for (const [yStr, sfObj] of Object.entries(a.yearly || {})) {
			const y = Number(yStr);
			if (Number.isNaN(y)) continue;
			a._cache.year[y] = {};
			for (const [sf, c] of Object.entries(sfObj || {})) {
				a._cache.year[y][sf] = Number(c || 0);
			}
		}

		// Build cumulative 'entire' subfield counts per year
		{
			const yearsSorted = Object.keys(a._cache.year).map(Number).filter(n => !isNaN(n)).sort((u, v) => u - v);
			let running = {};
			for (const y of yearsSorted) {
				const counts = a._cache.year[y] || {};
				for (const [sf, val] of Object.entries(counts)) {
					running[sf] = (running[sf] || 0) + Number(val || 0);
				}
				// store a copy for this year (keyed by numeric year -> will be stringified as object key)
				a._cache.entire[y] = { ...running };
			}
		}

		// 2) Build pair counts per year (Sankey) from a.yearly_fields (a.Yearly_Fields || {})
		for (const [yStr, pairObj] of Object.entries(a.yearly_fields || {})) {
			const y = Number(yStr);
			if (Number.isNaN(y)) continue;
			a._cache.sankeyYear[y] = {};
			for (const [pair, v] of Object.entries(pairObj || {})) {
				a._cache.sankeyYear[y][pair] = Number(v || 0);
			}
		}

		// Build cumulative 'entire' pair counts per year for Sankey
		{
			const yearsSortedPairs = Object.keys(a._cache.sankeyYear).map(Number).filter(n => !isNaN(n)).sort((u, v) => u - v);
			let runningPairs = {};
			for (const y of yearsSortedPairs) {
				const counts = a._cache.sankeyYear[y] || {};
				for (const [pair, val] of Object.entries(counts)) {
					runningPairs[pair] = (runningPairs[pair] || 0) + Number(val || 0);
				}
				a._cache.sankeyEntire[y] = { ...runningPairs };
			}
		}

		// 3) Backwards compatibility: alias for code that expects a._sankeyPairs
		a._sankeyPairs = {
			year: a._cache.sankeyYear,
			entire: a._cache.sankeyEntire
		};
	});
	// ---- end replacement block ----

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
		if (!author._cache) return {}; // safety fallback

		if (mode === 'year') {
			return author._cache.year[year] || {};
		} else { // 'entire'
			// Find the closest year <= requested year
			const years = Object.keys(author._cache.entire).map(Number).filter(y => y <= year);
			if (!years.length) return {};
			const maxYear = Math.max(...years);
			return author._cache.entire[maxYear] || {};
		}
	}

	function countsForFields(author, year, mode) {
		const yearlyFields = author.Yearly_Fields || author.yearly_fields || {};
		if (mode === "year") {
			return yearlyFields[String(year)] || {};
		} else if (mode === "entire") {
			const agg = {};
			for (const [y, pairs] of Object.entries(yearlyFields)) {
				if (+y > year) continue;
				for (const [pair, val] of Object.entries(pairs)) {
					agg[pair] = (agg[pair] || 0) + val;
				}
			}
			return agg;
		}
		return {};
	}

	// helper: compute interdisciplinary for an author
	function interdisciplinarity(author, year, mode = mainMode) {
		const counts = countsFor(author, year, mode);
		const values = Object.values(counts).map(Number).filter(v => v > 0);
		if (!values.length) return 0;
		const maxVal = Math.max(...values);
		const sumVal = d3.sum(values);
		return 1 - maxVal / sumVal;
	}

	// helper: compute group interdisciplinarity (Force/Sankey)
	function groupInterdisciplinarity(authors, year, mode = mainMode, fieldType = 'subfield') {
		const aggCounts = {};
		authors.forEach(a => {
			const counts = (fieldType === 'subfield')
				? countsFor(a, year, mode)
				: countsForFields(a, year, mode);
			for (const [key, val] of Object.entries(counts)) {
				aggCounts[key] = (aggCounts[key] || 0) + Number(val || 0);
			}
		});
		const values = Object.values(aggCounts).filter(v => v > 0);
		if (!values.length) return 0;
		const maxVal = Math.max(...values);
		const sumVal = d3.sum(values);
		return 1 - maxVal / sumVal;
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

	// Generate HTML for topics section in side panel
	function topicsHtml(author, year) {
		let topicsByYear = {};

		if (mainMode === 'year') {
			const yearStr = String(year);
			topicsByYear = author.yearly_topics?.[yearStr] || {};
		} else { // 'entire' mode: aggregate all years <= currentYear
			for (const [yStr, topics] of Object.entries(author.yearly_topics || {})) {
				const y = +yStr;
				if (y <= year) {
					for (const [key, count] of Object.entries(topics)) {
						topicsByYear[key] = (topicsByYear[key] || 0) + Number(count);
					}
				}
			}
		}

		if (!Object.keys(topicsByYear).length) {
			return "<div>No topics available for this selection</div>";
		}

		const subfieldMap = {};

		Object.entries(topicsByYear).forEach(([key, count]) => {
			if (!key.includes("---")) return;
			const [subfield, topic] = key.split("---");
			if (!subfieldMap[subfield]) subfieldMap[subfield] = [];
			subfieldMap[subfield].push({ topic, count: Number(count) });
		});

		Object.values(subfieldMap).forEach(arr => arr.sort((a, b) => b.count - a.count));

		const sortedSubfields = Object.entries(subfieldMap)
			.map(([sf, topics]) => ({ sf, total: topics.reduce((sum, t) => sum + t.count, 0), topics }))
			.sort((a, b) => b.total - a.total);

		let html = "<div style='margin-top:15px'><b>TOPICS:</b></div>";
		sortedSubfields.forEach(s => {
			html += `<div style="margin-top:6px"><b>${s.sf}</b></div>`;
			s.topics.forEach(t => {
				html += `<div style="margin-left:12px">• ${t.count} ${t.topic}</div>`;
			});
		});

		return html;
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

	// -------------------------------------------------------------------------------------------------------------------------
	// SANKEY VISUALIZATION ----------------------------------------------------------------------------------------------------
	// -------------------------------------------------------------------------------------------------------------------------
	const vizToggleBtn = filterPanel.append("button")
		.text("Switch to Sankey")
		.style("margin-top", "8px")
		.style("padding", "6px 8px")
		.on("click", () => {
			showSankey = !showSankey;
			vizToggleBtn.text(showSankey ? "Switch to Force View" : "Switch to Sankey");
			console.log("Sankey mode:", showSankey);
			updateAll(false); // redraw current visualization
		});

	let showSankey = false; // global flag

	function updateSankey() {
		// Aggregate pair totals across filteredAuthors using the precomputed author._sankeyPairs
		const pairTotals = new Map(); // pair -> total count

		for (const author of filteredAuthors) {
			const sankey = author._sankeyPairs || { year: {}, entire: {} };
			let pairs = {};

			if (mainMode === 'year') {
				pairs = sankey.year?.[String(currentYear)] || {};
			} else { // 'entire' mode: take cumulative up to currentYear from author's precomputed cumulative map
				const years = Object.keys(sankey.entire || {}).map(Number).filter(y => !isNaN(y) && y <= currentYear);
				if (years.length) {
					const yy = Math.max(...years);
					pairs = sankey.entire[yy] || {};
				} else {
					pairs = {};
				}
			}

			for (const [pair, val] of Object.entries(pairs || {})) {
				const v = Number(val || 0);
				if (v <= 0) continue;
				pairTotals.set(pair, (pairTotals.get(pair) || 0) + v);
			}
		}

		// nothing to draw -> clear sankey visuals and return
		if (!pairTotals.size) {
			sankeyLayer.selectAll("*").remove();
			phantomLayer.selectAll("*").remove();
			g.selectAll(".sankeyLabelLayer").remove();
			return;
		}

		// Build links and nodes
		const links = [];
		const nodesSet = new Set();

		for (const [pair, count] of pairTotals.entries()) {
			const parts = String(pair).split('---');
			if (parts.length < 2) continue;
			const subfield = parts[0];
			const field = parts[1];
			links.push({ source: subfield, target: field, value: count });
			nodesSet.add(subfield);
			nodesSet.add(field);
		}

		if (!links.length) {
			sankeyLayer.selectAll("*").remove();
			phantomLayer.selectAll("*").remove();
			g.selectAll(".sankeyLabelLayer").remove();
			return;
		}

		const nodes = Array.from(nodesSet).map(name => ({ name }));
		const nameToIndex = new Map(nodes.map((d, i) => [d.name, i]));
		const sankeyLinks = links.map(l => ({
			source: nameToIndex.get(l.source),
			target: nameToIndex.get(l.target),
			value: l.value
		}));

		// Sankey layout area
		const leftMargin = 200;
		const rightEdge = innerW - 50;
		const sankeyWidth = rightEdge - leftMargin;
		const sankeyHeight = innerH - 50;

		const sankeyGen = d3.sankey()
			.nodeWidth(20)
			.nodePadding(10)
			.extent([[leftMargin, 20], [rightEdge, sankeyHeight]]);

		// Run layout (give fresh plain objects so d3 can mutate them)
		const graph = sankeyGen({
			nodes: nodes.map(d => Object.assign({}, d)),
			links: sankeyLinks.map(d => Object.assign({}, d))
		});

		// remove old defs (we recreate gradients); do not remove whole sankeyLayer to allow joins
		sankeyLayer.select("defs").remove();
		phantomLayer.selectAll("*").remove(); // keep behavior from original
		g.selectAll(".sankeyLabelLayer").remove(); // remove older labels (we'll recreate)

		const defs = sankeyLayer.append("defs");

		// LINKS: keyed by sourceName->targetName to avoid full DOM churn
		const linkKey = d => `${d.source.name}->${d.target.name}`;
		const linkSel = sankeyLayer.selectAll("path.sankey-link").data(graph.links, linkKey);

		linkSel.join(
			enter => enter.append("path")
				.attr("class", "sankey-link")
				.attr("fill", "none")
				.attr("opacity", 0.8),
			update => update,
			exit => exit.remove()
		)
			.attr("d", d3.sankeyLinkHorizontal())
			.attr("stroke-width", d => Math.max(1, d.width))
			.attr("stroke", d => {
				// create stable id per pair (sanitized)
				const safe = s => String(s).replace(/\W+/g, "_").replace(/^_+|_+$/g, "");
				const gradId = `grad_${safe(d.source.name)}__${safe(d.target.name)}`;
				// avoid duplicate defs for same id (we already removed defs at top of function)
				const gradient = defs.append("linearGradient")
					.attr("id", gradId)
					.attr("gradientUnits", "userSpaceOnUse")
					.attr("x1", d.source.x1)
					.attr("y1", (d.y0 + d.y1) / 2)
					.attr("x2", d.target.x0)
					.attr("y2", (d.y0 + d.y1) / 2);

				gradient.append("stop")
					.attr("offset", "0%")
					.attr("stop-color", colorScale(d.source.name) || "#888");

				gradient.append("stop")
					.attr("offset", "100%")
					.attr("stop-color", colorScale(d.target.name) || "#888");

				return `url(#${gradId})`;
			})
			.attr("fill", "none")
			.attr("opacity", 0.8);

		// NODES: keyed by name
		const nodeSel = sankeyLayer.selectAll("rect.sankey-node").data(graph.nodes, d => d.name);
		nodeSel.join(
			enter => enter.append("rect").attr("class", "sankey-node").attr("stroke", "#000"),
			update => update,
			exit => exit.remove()
		)
			.attr("x", d => d.x0)
			.attr("y", d => d.y0)
			.attr("width", d => d.x1 - d.x0)
			.attr("height", d => d.y1 - d.y0)
			.attr("fill", d => colorScale(d.name) || "#888");

		// LABELS: new layer under sankeyLayer so it rotates/moves consistently
		const labelLayer = sankeyLayer.append("g").attr("class", "sankeyLabelLayer");
		labelLayer.selectAll("text.sankey-label")
			.data(graph.nodes, d => d.name)
			.join("text")
			.attr("class", "sankey-label")
			.attr("x", d => d.x0 < sankeyWidth / 2 ? d.x1 + 4 : d.x0 - 4)
			.attr("y", d => (d.y1 + d.y0) / 2)
			.attr("text-anchor", d => d.x0 < sankeyWidth / 2 ? "start" : "end")
			.attr("alignment-baseline", "middle")
			.style("font-family", "sans-serif")
			.style("font-size", "12px")
			.text(d => d.name);
	}

	// -------------------------------------------------------------------------------------------------------------------------
	// -------------------------------------------------------------------------------------------------------------------------
	// -------------------------------------------------------------------------------------------------------------------------

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
		.attr("y", innerH + 70)
		.attr("text-anchor", "middle")
		.attr("font-size", "44px")
		.attr("font-weight", "700")
		.attr("fill", "#0f172a")
		.text(currentYear);

	// Autoplay button (left of slider)
	const playX = 10; // slight padding
	const playBtn = sliderG.append("g")
		.attr("transform", `translate(${playX}, 0)`)
		.style("cursor", "pointer");

	// Circle background
	playBtn.append("circle")
		.attr("r", 20)
		.attr("fill", "url(#playGradient)")
		.style("filter", "drop-shadow(0px 2px 4px rgba(0,0,0,0.2))");

	// Define gradient for nicer look
	const defs = sliderG.append("defs");
	const gradient = defs.append("linearGradient")
		.attr("id", "playGradient")
		.attr("x1", "0%").attr("y1", "0%")
		.attr("x2", "100%").attr("y2", "100%");
	gradient.append("stop").attr("offset", "0%").attr("stop-color", "#3b82f6");
	gradient.append("stop").attr("offset", "100%").attr("stop-color", "#2563eb");

	// Define icon shapes
	const playPath = "M-5,-8 L10,0 L-5,8 Z"; // triangle
	const pausePath = "M-8,-8 H-2 V8 H-8 Z M2,-8 H8 V8 H2 Z"; // two bars

	// Add play icon
	const playIcon = playBtn.append("path")
		.attr("d", playPath)
		.attr("fill", "#fff");

	// Hover effect: scale slightly
	playBtn.on("mouseenter", function () {
		d3.select(this).transition().duration(200)
			.attr("transform", `translate(${playX}, 0) scale(1.1)`);
	}).on("mouseleave", function () {
		d3.select(this).transition().duration(200)
			.attr("transform", `translate(${playX}, 0) scale(1)`);
	});

	let autoplay = false;
	let autoplayInterval = null;

	playBtn.on("click", () => {
		autoplay = !autoplay;

		// Transition icon shape
		playIcon.transition().duration(200)
			.attr("d", autoplay ? pausePath : playPath);

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
	const sankeyLayer = g.append("g").attr("class", "sankeyLayer");


	// initially, we'll create nodes from filteredAuthors (filteredAuthors is authorsRaw filtered)
	filteredAuthors = authorsRaw.slice(); // initial no filter

	// nodes dataset: one node per filtered author (with dynamic subfield and active)
	let nodes = []; // {id,name,authorRef,subfield,active,x,y,...}

	// Simulation
	let simulation = d3.forceSimulation()
		.alphaMin(0.001)
		.velocityDecay(0.35)
		.force("x", d3.forceX().strength(0.14))
		.force("y", d3.forceY().strength(0.14))
		.force("collide", d3.forceCollide(3.8).strength(0.95))
		.on("tick", ticked);

	updateNodeSelection();

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
		// clusterCenterMap already computed in setYear()
		const rLabel = Math.min(innerW, innerH) * 0.45; // outer circle for labels

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
				let d_short = d;
				if (d === "Artificial Intelligence") d_short = "AI";
				else if (d === "Computational Theory and Mathematics") d_short = "CT & Math";
				else if (d === "Computer Graphics and Computer-Aided Design") d_short = "CG & CAD";
				else if (d === "Computer Networks and Communications") d_short = "Net & Comm";
				else if (d === "Computer Science Applications") d_short = "CS App";
				else if (d === "Computer Vision and Pattern Recognition") d_short = "CV & PR";
				else if (d === "Hardware and Architecture") d_short = "HW & Arch";
				else if (d === "Human-Computer Interaction") d_short = "HCI";
				else if (d === "Information Systems") d_short = "Info Sys";
				else if (d === "Signal Processing") d_short = "Signal";
				else if (d === "Software") d_short = "Software";
				else if (d === "Unknown") d_short = "Unknown";

				const pct = ((counts.get(d) || 0) / total * 100);
				return [d_short, `${pct.toFixed(1)}%`]; // two lines
			})
			.join("tspan")
			.text(d => d)
			.attr("x", 0)
			.attr("dy", (d, i) => i === 0 ? 0 : "1.2em");

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
		// build subfield bars SVG
		const buildSVG = d => {
			const cs = countsFor(d.author, currentYear, mainMode);
			const items = Object.entries(cs).sort((a, b) => b[1] - a[1]);
			const max = items.length ? Math.max(...items.map(([_, c]) => c)) : 1;
			const h = 18, gap = 4, w = 200, H = items.length * (h + gap);
			return `<svg width="${w}" height="${H}">${items.map(([sf, c], i) => {
				const y = i * (h + gap), bw = (c / max) * w, color = colorScale(sf);
				return `<rect x="0" y="${y}" width="${bw}" height="${h}" fill="${color}"></rect>
				<text x="5" y="${y + h / 2 + 5}" font-size="12" font-weight="700" fill="#000">${c}</text>
				<text x="27" y="${y + h / 2 + 2}" font-size="12" font-weight="700" fill="#000" dominant-baseline="middle" style="pointer-events:none">${escapeHTML(sf)}</text>`;
			}).join('')}</svg>`;
		};

		// tooltip content
		const tooltipHtml = (d, svg) => `
		<div style="font-weight:700">${escapeHTML(d.author.name)}</div>
		<div style="margin-top:6px"><b>Main subfield: </b>${escapeHTML(d.subfield)}</div>
		<div style="margin-top:6px"><b>Interdisciplinarity:</b> ${(interdisciplinarity(d.author, currentYear, mainMode) * 100).toFixed(1)}%</div>
		<div style="margin-top:12px"><b>Subfields Occurrences</b> (${mainMode === 'entire' ? 'up to' : 'in'} ${currentYear}):</div>
		<div style="margin:6px 0 0 0;position:relative">${svg}</div>`;

		// side panel content
		const sideHtml = (d, svg) => {
			const orcid = d.author.orcid ? `<div><b>ORCID:</b> <a href="https://orcid.org/${encodeURIComponent(d.author.orcid)}" target="_blank" rel="noopener noreferrer">${escapeHTML(d.author.orcid)}</a></div>` : "";
			const openalex = d.author.openalex ? `<div><b>OpenAlex:</b> <a href="${escapeHTML(d.author.openalex)}" target="_blank" rel="noopener noreferrer">${escapeHTML(d.author.openalex)}</a></div>` : "";
			return `<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">${escapeHTML(d.author.name)}</h2></div>
		<div style="margin-top:10px"><b>Institution:</b> ${escapeHTML(d.author.institution || "—")}</div>
		<div style="margin-top:6px"><b>Main subfield:</b> ${escapeHTML(d.subfield)}</div>
		<div style="margin-top:6px"><b>Interdisciplinarity:</b> ${(interdisciplinarity(d.author, currentYear, mainMode) * 100).toFixed(1)}%</div>
		<div style="margin-top:10px"><b>Metrics</b><ul style="margin:6px 0 0 18px;padding:0">
			<li>H-Index: ${isNaN(d.author.hindex) ? "—" : d.author.hindex}</li>
			<li>I10-Index: ${isNaN(d.author.i10index) ? "—" : d.author.i10index}</li>
			<li>Works Count: ${isNaN(d.author.works_count) ? "—" : d.author.works_count}</li>
			<li>Cited By: ${isNaN(d.author.cited_by_count) ? "—" : d.author.cited_by_count}</li>
		</ul></div>
		<div style="margin-top:8px">${orcid}${openalex}</div>
		<div style="margin-top:12px"><b>Subfields Occurrences</b> (${mainMode === 'entire' ? 'up to' : 'in'} ${currentYear}):</div>
		<div style="margin:6px 0 0 0;position:relative">${svg}</div>
		${topicsHtml(d.author, currentYear)}
		<div style="margin-top:12px"><button id="sideCloseBtn" style="padding:6px 8px;border-radius:6px;border:0;background:#2563eb;color:#fff;cursor:pointer">Close</button></div>`;
		};

		// reusable function to set base attributes
		const setAttrs = sel => sel
			.attr("opacity", d => d.active ? 0.95 : 0)
			.attr("pointer-events", d => d.active ? "all" : "none")
			.attr("fill", d => colorScale(d.subfield));

		// data join
		const sel = nodesLayer.selectAll("circle").data(nodes, d => d.id);
		sel.exit().remove();
		setAttrs(sel.enter().append("circle").attr("r", 3.3)
			.on("mousemove", (e, d) => {
				const svg = buildSVG(d);
				tooltip.style("display", "block")
					.style("left", `${e.pageX + 12}px`).style("top", `${e.pageY + 12}px`)
					.html(tooltipHtml(d, svg));
			})
			.on("mouseout", () => tooltip.style("display", "none"))
			.on("click", (e, d) => {
				const svg = buildSVG(d);
				openSidePanel(sideHtml(d, svg));
				d3.select("#sideCloseBtn").on("click", closeSidePanel);
			})
		);

		// update existing circles
		setAttrs(sel);
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

		// update nodes in place
		nodes.forEach(n => {
			n.subfield = mainSubfieldFor(n.author, currentYear, mainMode);
			n.active = isActiveBy(n.author, currentYear, mainMode);
		});

		// for new authors after filtering
		const existingIds = new Set(nodes.map(n => n.id));
		filteredAuthors.forEach(a => {
			if (!existingIds.has(a.id)) {
				nodes.push({
					id: a.id,
					author: a,
					subfield: mainSubfieldFor(a, currentYear, mainMode),
					active: isActiveBy(a, currentYear, mainMode),
					x: centerX + (Math.random() - 0.5) * 20,
					y: centerY + (Math.random() - 0.5) * 20,
					vx: 0,
					vy: 0
				});
			}
		});

		// remove nodes that are no longer in filteredAuthors
		const filteredIds = new Set(filteredAuthors.map(a => a.id));
		nodes = nodes.filter(n => filteredIds.has(n.id));

		// update cluster centers
		const visibleSubfields = computeVisibleSubfields(currentYear);
		if (visibleSubfields.length === 0) visibleSubfields.push("Unknown");

		clusterCenterMap = new Map();
		const r = Math.min(innerW, innerH) * 0.35;
		visibleSubfields.forEach((sf, i) => {
			const angle = (i / visibleSubfields.length) * 2 * Math.PI - Math.PI / 2;
			clusterCenterMap.set(sf, { x: centerX + r * Math.cos(angle), y: centerY + r * Math.sin(angle), angle });
		});
		clusterKeys = Array.from(clusterCenterMap.keys());

		// update forces
		simulation.nodes(nodes);
		simulation.force("x").x(d => clusterCenterMap.get(d.subfield)?.x ?? centerX);
		simulation.force("y").y(d => clusterCenterMap.get(d.subfield)?.y ?? centerY);

		// update UI
		updateNodeSelection();
		updateClustersAndLabels();
		updatePhantoms();
		if (showSankey) {
			updateSankey();
		}

		// Update group interdisciplinarity display
		if (showSankey) {
			const val = groupInterdisciplinarity(filteredAuthors, currentYear, mainMode, 'external');
			groupMetricDiv.html(`<b>Outer Interdisciplinarity:</b><br><b style="font-size: 24px; padding-left: 32px;">${(val * 100).toFixed(1)}%</b>`);
		} else {
			const val = groupInterdisciplinarity(filteredAuthors, currentYear, mainMode, 'subfield');
			groupMetricDiv.html(`<b>Inner Interdisciplinarity:</b><br><b style="font-size: 24px; padding-left: 30px;">${(val * 100).toFixed(1)}%</b>`);
		}

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
		updateAll(true);
		//setYear(currentYear, true);
	}

	// updateAll wrapper for when mode changes
	function updateAll(forceRestart = false) {
		console.log("updateSankey called for year:", currentYear);
		if (showSankey) {
			// Hide force-directed view
			nodesLayer.style("display", "none");
			phantomLayer.style("display", "none");
			labelLayer.style("display", "none");

			// Show Sankey
			sankeyLayer.style("display", "block");

			updateSankey();
		} else {
			// Show force-directed view
			nodesLayer.style("display", "block");
			phantomLayer.style("display", "block");
			labelLayer.style("display", "block");

			// Hide Sankey
			sankeyLayer.style("display", "none");
			g.selectAll(".sankeyLabelLayer").remove();

			setYear(currentYear, forceRestart);
		}

		// Update group interdisciplinarity display
		if (showSankey) {
			const val = groupInterdisciplinarity(filteredAuthors, currentYear, mainMode, 'external');
			groupMetricDiv.html(`<b>Outer Interdisciplinarity</b><br><b style="font-size: 24px; padding-left: 32px;"> ${(val * 100).toFixed(1)}%</b>`);
		} else {
			const val = groupInterdisciplinarity(filteredAuthors, currentYear, mainMode, 'subfield');
			groupMetricDiv.html(`<b>Inner Interdisciplinarity</b><br><b style="font-size: 24px; padding-left: 30px;"> ${(val * 100).toFixed(1)}%</b>`);
		}
	}

	// initial render
	setYear(currentYear, false);

	// cleanup timers on unload
	window.addEventListener("beforeunload", () => {
		if (autoplayInterval) autoplayInterval.stop();
	});

}).catch(err => {
	console.error("Failed to load authors.json:", err);
	g.append("text").attr("x", innerW / 2).attr("y", innerH / 2).attr("text-anchor", "middle").text("Error loading authors.json — see console");
});
