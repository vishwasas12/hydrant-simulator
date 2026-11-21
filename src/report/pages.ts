/** Report styles. The report is laid out on A4 sheets, on screen and in print alike. */
export const reportStyles = `
  :root { --ink: #1c1b19; --muted: #5d5c58; --line: #d4d2ca; --rule: #e6e4dd; --soft: #f4f4f1; --brand: #16325c; }
  * { box-sizing: border-box; }
  html { background: #dcdbd5; }
  body { margin: 0; color: var(--ink); font: 11.5px/1.5 'Segoe UI', system-ui, -apple-system, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .toolbar { position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; gap: 16px;
    padding: 8px 20px; background: rgba(255,255,255,.96); border-bottom: 1px solid var(--line); }
  .toolbar .status { font-size: 12px; color: var(--muted); }
  .toolbar button { height: 30px; padding: 0 14px; font: inherit; font-size: 12.5px; cursor: pointer; background: var(--brand); color: #fff; border: 0; border-radius: 4px; }

  /* Unpaged content, shown only until the sheets are laid out. */
  #source { width: 210mm; margin: 24px auto; padding: 14mm 15mm; background: #fff; }
  .paged #source { display: none; }

  /* A4 sheets, a fraction under 297 mm tall so print never spills onto a blank page. */
  #pages { display: flex; flex-direction: column; align-items: center; gap: 22px; padding: 24px 0 48px; }
  #pages:empty { display: none; }
  .page { position: relative; display: flex; flex-direction: column; width: 210mm; height: 296mm; padding: 11mm 15mm 9mm;
    overflow: hidden; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.08); }
  .running { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 7mm; padding-bottom: 5px;
    font-size: 9px; color: #6f6d68; border-bottom: 1px solid var(--line); }
  .running .brand { font-weight: 700; letter-spacing: .2em; color: var(--brand); }
  .page-body { flex: 1; min-height: 0; display: flow-root; }
  .page-body > :first-child { margin-top: 0; }
  .folio { display: flex; justify-content: space-between; gap: 16px; margin-top: 5mm; padding-top: 5px;
    font-size: 9px; color: #6f6d68; border-top: 1px solid var(--line); }
  .page.cover .running { display: none; }
  .continued { margin: 0 0 6px; font-size: 10.5px; font-style: italic; color: var(--muted); }

  .letterhead { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding-bottom: 12px; border-bottom: 3px solid var(--brand); }
  .company { font-size: 28px; font-weight: 700; letter-spacing: .24em; color: var(--brand); line-height: 1; }
  .doc-type { text-align: right; font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--brand); }
  .doc-type span { display: block; font-weight: 400; letter-spacing: .06em; color: var(--muted); }
  .title-block { padding: 34mm 0 6px; }
  .title-block .eyebrow { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 6px 0 14px; font-size: 30px; font-weight: 600; line-height: 1.2; }
  .doc-control { margin: 18px 0 0; font-size: 11px; }
  .doc-control th { width: 17%; background: var(--soft); font-weight: 600; border: 1px solid var(--line); }
  .doc-control td { width: 33%; border: 1px solid var(--line); }
  .doc-control th, .doc-control td { padding: 6px 9px; vertical-align: middle; }
  .contents-block { margin-top: 22mm; }
  .contents-block h2 { margin: 0 0 8px; }
  .contents { margin: 0; padding: 0; list-style: none; font-size: 12px; }
  .contents li { padding: 4px 0; }
  .contents a { display: flex; align-items: baseline; gap: 8px; color: inherit; text-decoration: none; }
  .contents b { width: 22px; font-weight: 600; color: var(--brand); }
  .contents .dots { flex: 1; border-bottom: 1px dotted #b9b7ae; transform: translateY(-3px); }
  .contents .pg { min-width: 18px; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }

  section { margin-top: 26px; }
  h2 { display: flex; gap: 12px; margin: 26px 0 10px; padding-bottom: 5px; font-size: 14px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
    color: var(--brand); border-bottom: 1.5px solid var(--brand); }
  section > h2 { margin-top: 0; }
  h2 b { font-weight: 700; }
  h3 { margin: 16px 0 6px; font-size: 12px; font-weight: 600; }
  p { margin: 6px 0; }
  .lead { margin-bottom: 10px; }
  .note { font-size: 10.5px; color: var(--muted); }
  .verdict { margin: 0 0 14px; padding: 11px 14px; border-left: 4px solid; font-size: 14px; font-weight: 600; }
  .verdict.pass { background: #e9f3e7; border-color: #0a7a0a; color: #0a5f0a; }
  .verdict.fail { background: #fbe9e8; border-color: #b3261e; color: #8f2020; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 10px 0 14px; }
  .fact { padding: 9px 12px; background: var(--soft); border-left: 3px solid var(--brand); }
  .fact span { display: block; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  .fact strong { display: block; font-size: 15px; font-weight: 600; }
  .fact small { display: block; font-size: 10.5px; color: var(--muted); }
  .findings { margin: 6px 0 10px; padding-left: 18px; }
  .findings li { margin: 4px 0; }
  .drawing { padding: 6px; border: 1px solid var(--line); }
  .drawing svg { display: block; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 8px 0; font-size: 10.5px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }

  table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin: 4px 0 8px; }
  th { padding: 5px 6px; text-align: left; vertical-align: bottom; font-weight: 600; background: var(--soft); border-bottom: 1px solid var(--ink); }
  td { padding: 3px 6px; vertical-align: top; border-bottom: 1px solid var(--rule); }
  td:first-child { white-space: nowrap; }
  tfoot td { font-weight: 600; border-top: 1px solid var(--ink); border-bottom: 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  td.pass { color: #0a6b0a; font-weight: 600; }
  td.fail { color: #a32020; font-weight: 600; }
  .schedule td:last-child { width: 50%; }
  .kv { width: auto; min-width: 55%; }
  .kv th { width: 230px; padding: 3px 24px 3px 0; font-weight: 400; color: var(--muted); background: none; border-bottom: 1px solid var(--rule); vertical-align: top; }
  .basis td:first-child { white-space: normal; width: 24%; font-weight: 600; }
  .basis td:last-child { width: 32%; color: var(--muted); }
  .formulas td { padding: 5px 6px; vertical-align: middle; }
  .formulas td.num { width: 28px; color: var(--muted); }
  .formulas td:nth-child(2) { width: 34%; white-space: normal; }
  .expr { font-family: 'Cambria Math', Cambria, 'Times New Roman', serif; font-size: 12.5px; font-style: italic; }
  .notation { width: auto; min-width: 60%; }
  .notation td.expr { width: 110px; }
  .numbered { margin: 4px 0 10px; padding-left: 22px; }
  .numbered li { margin: 4px 0; padding-left: 2px; }
  .statement { margin-top: 18px; padding: 10px 12px; font-size: 11px; background: var(--soft); border-left: 3px solid var(--brand); }
  .chart { margin: 6px 0 14px; }
  .chart svg { display: block; max-width: 100%; height: auto; }
  .issues { margin: 6px 0 12px; padding: 8px 12px 8px 30px; background: #fdf6e3; border-left: 3px solid #c98a00; }
  .issues li { margin: 2px 0; }
  .end { margin-top: 28px; text-align: center; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }

  @page { size: A4; margin: 0; }
  @media print {
    html, body { background: none; }
    .toolbar { display: none; }
    #pages { display: block; padding: 0; zoom: 1 !important; }
    .page { margin: 0; box-shadow: none; break-after: page; }
    .page:last-child { break-after: auto; }
  }
`;

/**
 * Lays the report out on A4 sheets in the browser. Each block goes on the
 * current sheet; tables and lists that run past the foot continue on the next
 * sheet (tables repeat their header row), headings stay with the block that
 * follows them, and a section starts a fresh sheet when little room is left.
 * The contents list is then given page numbers. Plain script, run in the
 * report window.
 */
export const paginateScript = `
(function () {
  var source = document.getElementById('source');
  var holder = document.getElementById('pages');
  var template = document.getElementById('page-template');
  var pages = [], body = null, pending = [];
  var MIN_ROWS = 3, MIN_ITEMS = 2, SECTION_ROOM = 0.25;

  function newPage(kind) {
    var page = template.content.firstElementChild.cloneNode(true);
    if (kind) page.classList.add(kind);
    holder.appendChild(page);
    pages.push(page);
    body = page.querySelector('.page-body');
    pending = [];
  }
  function bottom(el) { return el.getBoundingClientRect().bottom; }
  function overflows() {
    var last = body.lastElementChild;
    return !!last && bottom(last) > bottom(body) + 0.5;
  }
  function room() {
    var last = body.lastElementChild;
    return last ? bottom(body) - bottom(last) : body.clientHeight;
  }
  function isHeading(el) { return /^H[1-6]$/.test(el.tagName); }
  function headingsHere() { return pending.filter(function (h) { return h.parentNode === body; }); }
  function settle(el) { pending = isHeading(el) ? pending.concat([el]) : []; }

  // Headings at the foot of a sheet move on with the block that follows them.
  function breakPage() {
    var carry = headingsHere();
    if (carry.length === body.children.length) carry = [];
    newPage();
    carry.forEach(function (h) { body.appendChild(h); });
    pending = carry;
  }

  function headingText(h) {
    var copy = h.cloneNode(true);
    var num = copy.querySelector('b');
    if (num) num.remove();
    return copy.textContent.trim();
  }
  function labelFor(el) {
    if (el.dataset.label) return el.dataset.label;
    for (var p = el.previousElementSibling; p; p = p.previousElementSibling) if (isHeading(p)) return headingText(p);
    return '';
  }

  function splitTable(table) {
    var rows = table.tBodies[0];
    if (!rows || rows.rows.length < 2) return null;
    var total = rows.rows.length;
    var rest = table.cloneNode(false);
    rest.removeAttribute('id');
    if (table.tHead) rest.appendChild(table.tHead.cloneNode(true));
    var restRows = rows.cloneNode(false);
    rest.appendChild(restRows);
    var foot = table.tFoot;
    if (foot) rest.appendChild(foot);
    while (rows.rows.length && (overflows() || (foot && !restRows.rows.length))) {
      restRows.insertBefore(rows.rows[rows.rows.length - 1], restRows.firstChild);
    }
    if (rows.rows.length < Math.min(MIN_ROWS, total) || !restRows.rows.length) {
      while (restRows.rows.length) rows.appendChild(restRows.rows[0]);
      if (foot) table.appendChild(foot);
      return null;
    }
    return rest;
  }

  function splitList(list) {
    var total = list.children.length;
    if (total < 2) return null;
    var rest = list.cloneNode(false);
    rest.removeAttribute('id');
    while (list.children.length && overflows()) rest.insertBefore(list.lastElementChild, rest.firstChild);
    var kept = list.children.length;
    if (kept < Math.min(MIN_ITEMS, total) || !rest.children.length) {
      while (rest.firstChild) list.appendChild(rest.firstChild);
      return null;
    }
    if (list.tagName === 'OL') rest.setAttribute('start', String(parseInt(list.getAttribute('start') || '1', 10) + kept));
    return rest;
  }

  function split(el) {
    if (el.tagName === 'TABLE') return splitTable(el);
    if (el.tagName === 'UL' || el.tagName === 'OL') return splitList(el);
    return null;
  }

  // A figure taller than a whole sheet is scaled down to fit.
  function shrink(el) {
    var svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
    var over = bottom(el) - bottom(body);
    if (!svg || over <= 0) return;
    svg.style.height = Math.max(120, svg.getBoundingClientRect().height - over - 2) + 'px';
    svg.style.width = '100%';
  }

  function place(el) {
    if (el.tagName === 'H2' && body.children.length && room() < body.clientHeight * SECTION_ROOM) breakPage();
    body.appendChild(el);
    if (!overflows()) return settle(el);
    var label = labelFor(el);
    var rest = split(el);
    if (!rest && body.children.length > headingsHere().length + 1) {
      body.removeChild(el);
      breakPage();
      body.appendChild(el);
      if (!overflows()) return settle(el);
      label = labelFor(el);
      rest = split(el);
    }
    if (!rest) {
      shrink(el);
      return settle(el);
    }
    newPage();
    if (label) {
      var note = document.createElement('p');
      note.className = 'continued';
      note.textContent = label + ' (continued)';
      body.appendChild(note);
      rest.dataset.label = label;
    }
    place(rest);
  }

  function fitWidth() {
    var page = pages[0];
    if (!page) return;
    var scale = Math.min(1, (document.documentElement.clientWidth - 24) / page.offsetWidth);
    holder.style.zoom = scale < 1 ? String(scale) : '';
  }

  function layout() {
    newPage('cover');
    Array.prototype.slice.call(document.getElementById('cover').children).forEach(function (el) { body.appendChild(el); });
    newPage();
    Array.prototype.slice.call(source.children).forEach(function (el) {
      if (el.id === 'cover') return;
      if (el.tagName !== 'SECTION') return place(el);
      var title = el.querySelector('h2');
      if (title && el.id) { title.id = el.id; el.removeAttribute('id'); }
      Array.prototype.slice.call(el.children).forEach(place);
    });
    source.remove();
    pages.forEach(function (page, i) {
      page.querySelector('.page-no').textContent = 'Page ' + (i + 1) + ' of ' + pages.length;
    });
    Array.prototype.slice.call(document.querySelectorAll('.contents a')).forEach(function (a) {
      var target = document.getElementById(a.getAttribute('href').slice(1));
      var page = target && target.closest('.page');
      if (page) a.querySelector('.pg').textContent = String(pages.indexOf(page) + 1);
    });
    document.documentElement.classList.add('paged');
    document.getElementById('status').textContent = pages.length + ' pages, A4';
    fitWidth();
    window.addEventListener('resize', fitWidth);
  }

  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(layout);
})();
`;
