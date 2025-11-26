// Define the subfields
export const subfieldOrder = [
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
export const colorScale = d3.scaleOrdinal()
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

// General Visualization Dimensions
export const W = 1120, H = 960;
export const M = { top: 30, right: 20, bottom: 140, left: 20 };
export const innerW = W - M.left - M.right;
export const innerH = H - M.top - M.bottom;

export function escapeHTML(s) {
    return String(s || "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[m]));
}
