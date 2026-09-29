// Runs inside the map page. Returns every layout defect it can see: wrapped or clipped header
// items, card content spilling out of its card, text escaping a card, and overlapping cards.
(() => {
  const problems = [];
  const r = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const b = r(el);
    const cs = getComputedStyle(el);
    return b.width > 0 && b.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
  };
  const header = document.querySelector("header");
  if (header) {
    if (header.scrollWidth > header.clientWidth + 1) problems.push(`header overflows: ${header.scrollWidth} > ${header.clientWidth}`);
    const hb = r(header);
    for (const el of header.querySelectorAll("h1, span, button, [role=tab], input, a")) {
      if (!visible(el)) continue;
      const b = r(el);
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (el.matches("span, h1") && el.children.length === 0 && b.height > lh * 1.5) problems.push(`header text wraps: "${el.textContent.trim().slice(0, 40)}"`);
      if (b.right > hb.right + 1 || b.left < hb.left - 1) problems.push(`header item clipped: "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}"`);
    }
  }
  // List view: every chip and row must sit fully inside the visible area.
  const vw = document.documentElement.clientWidth;
  for (const el of document.querySelectorAll("[role=toolbar] button, section li > button, li button[aria-expanded]")) {
    if (!visible(el)) continue;
    const b = r(el);
    if (b.right > vw + 1 || b.left < -1) problems.push(`list item off screen: "${el.textContent.trim().slice(0, 30)}"`);
    for (const t of el.querySelectorAll("span")) {
      if (!visible(t) || t.children.length) continue;
      const tb = r(t);
      if (tb.right > b.right + 1) problems.push(`list text escapes its row: "${t.textContent.trim().slice(0, 30)}"`);
    }
  }
  // Text squeezed into a narrow column wraps one word per line. Flag any multi-word text block
  // outside the canvas that runs to 4+ lines while under 120px wide.
  for (const el of document.querySelectorAll("main p, main span, main div, [role=dialog] p")) {
    if (!visible(el) || el.closest(".react-flow") || [...el.childNodes].every((c) => c.nodeType !== 3)) continue;
    const words = el.textContent.trim().split(/\s+/).length;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    const b = r(el);
    if (words >= 4 && b.width < 120 && b.height > lh * 3.5) problems.push(`text squeezed into a narrow column: "${el.textContent.trim().slice(0, 30)}"`);
  }
  const nodes = [...document.querySelectorAll(".react-flow__node")].filter(visible);
  for (const n of nodes) {
    const card = n.firstElementChild;
    if (!card) continue;
    const nb = r(n);
    const cb = r(card);
    if (cb.height > nb.height + 1) problems.push(`card taller than node ${n.dataset.id}: ${Math.round(cb.height)} > ${Math.round(nb.height)}`);
    for (const el of card.querySelectorAll("*")) {
      if (!visible(el) || el.closest("button[aria-label^='Show '], button[aria-label^='Hide items'], .react-flow__handle")) continue;
      const b = r(el);
      if (b.bottom > cb.bottom + 1 || b.right > cb.right + 1 || b.left < cb.left - 1 || b.top < cb.top - 1) {
        problems.push(`content escapes card ${n.dataset.id}: "${el.textContent.trim().slice(0, 30)}"`);
        break;
      }
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = r(nodes[i]);
      const b = r(nodes[j]);
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1) problems.push(`cards overlap: ${nodes[i].dataset.id} x ${nodes[j].dataset.id}`);
    }
  }
  return JSON.stringify({ cards: nodes.length, problems });
})()
