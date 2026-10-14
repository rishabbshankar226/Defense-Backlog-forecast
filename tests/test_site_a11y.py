"""Accessibility, state handling and reconciliation checks on the dashboard in a real browser.

Each test loads site/ from a local server in headless Chromium. axe-core is vendored in
tests/vendor so the check needs no network. Without Playwright installed the module is
skipped, so `make test` still runs the model tests on their own.
"""

import functools
import http.server
import threading
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api")

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
AXE = (ROOT / "tests" / "vendor" / "axe.min.js").read_text()
TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]
HII = "#f-company [data-value='HII']"


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def base_url():
    handler = functools.partial(_Quiet, directory=str(SITE))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/"
    server.shutdown()


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # browser binaries not installed
            pytest.skip(f"Chromium not available: {e}")
        yield b
        b.close()


def wait_ready(page):
    page.wait_for_selector("html.ready #kpis-pool .kpi:not(.sk)")
    page.wait_for_function("document.getElementById('c-fan').getAttribute('aria-label').length > 20")


def open_page(browser, base_url, width=1280, height=900, hash="#LMT", **media):
    ctx = browser.new_context(viewport={"width": width, "height": height}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    media.setdefault("reduced_motion", "reduce")
    page.emulate_media(**media)
    page.goto(base_url + hash)
    wait_ready(page)
    page.errors = errors
    return page


def axe(page):
    page.add_script_tag(content=AXE)
    result = page.evaluate(
        "tags => axe.run(document, { runOnly: { type: 'tag', values: tags } })", TAGS
    )
    return [
        f"{v['id']}: {v['help']} -> " + ", ".join(n["target"][0] for n in v["nodes"][:4])
        for v in result["violations"]
    ]


CASES = {
    "light": dict(color_scheme="light"),
    "dark": dict(color_scheme="dark"),
    "forced-colors": dict(color_scheme="light", forced_colors="active"),
    "more-contrast": dict(color_scheme="light", contrast="more"),
    "phone": dict(color_scheme="light", width=390, height=844),
}


@pytest.mark.parametrize("case", CASES)
def test_axe_finds_nothing(browser, base_url, case):
    opts = dict(CASES[case])
    size = {k: opts.pop(k) for k in ("width", "height") if k in opts}
    page = open_page(browser, base_url, **size, **opts)
    # Open a definition and the reconciliation list, so their markup is checked too.
    page.click("#score-title ~ .info")
    page.click("#recon summary")
    assert axe(page) == []
    # Again on the forecast table, and with a period that leaves panels empty.
    page.click("#tt-forecasts")
    page.select_option("#f-to", "2019")
    page.wait_for_selector("#p-fc[data-state='empty']")
    assert axe(page) == []
    assert page.errors == []
    page.context.close()


def test_skip_link_is_first_and_lands_on_the_summary(browser, base_url):
    page = open_page(browser, base_url)
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.className") == "skip"
    assert page.is_visible(".skip")
    page.keyboard.press("Enter")
    assert page.evaluate("document.activeElement.id") == "summary"
    # The hash holds the company, so the skip link never replaces it.
    assert page.evaluate("location.hash") == "#LMT"
    page.context.close()


def test_company_filter_is_a_radio_group_with_arrow_keys(browser, base_url):
    page = open_page(browser, base_url)
    page.focus("#f-company [data-value='LMT']")
    page.keyboard.press("ArrowRight")
    assert page.evaluate("document.activeElement.dataset.value") == "NOC"
    assert page.get_attribute("#f-company [data-value='NOC']", "aria-checked") == "true"
    assert page.get_attribute("#f-company [data-value='LMT']", "aria-checked") == "false"
    page.keyboard.press("Home")
    assert page.get_attribute(HII, "aria-checked") == "true"
    assert page.evaluate("location.hash") == "#HII"
    page.wait_for_function("document.getElementById('kpis-co-title').textContent.includes('HII')")
    page.context.close()


def test_single_key_shortcuts_can_be_switched_off(browser, base_url):
    page = open_page(browser, base_url)
    selected = "s => document.querySelector(s).getAttribute('aria-checked') === 'true'"
    page.keyboard.press("1")
    page.wait_for_function(selected, arg=HII)
    page.click("#keys-open")
    assert page.evaluate("document.getElementById('keys-dlg').open")
    assert page.evaluate("document.activeElement.id") == "keys-switch"
    page.keyboard.press("Space")
    assert page.get_attribute("#keys-switch", "aria-checked") == "false"
    page.keyboard.press("Escape")
    assert not page.evaluate("document.getElementById('keys-dlg').open")
    assert page.evaluate("document.activeElement.id") == "keys-open"
    page.evaluate("document.activeElement.blur()")
    page.keyboard.press("3")
    page.wait_for_timeout(100)
    assert page.get_attribute(HII, "aria-checked") == "true"
    assert page.get_attribute(HII, "aria-keyshortcuts") is None
    # The choice survives a reload.
    page.reload()
    wait_ready(page)
    assert page.get_attribute("#keys-switch", "aria-checked") == "false"
    page.keyboard.press("3")
    page.wait_for_timeout(100)
    assert page.get_attribute(HII, "aria-checked") == "true"
    page.context.close()


def test_a_focused_chart_reads_out_each_point(browser, base_url):
    page = open_page(browser, base_url)
    page.focus("#c-backlog")
    page.keyboard.press("End")
    page.wait_for_function("document.getElementById('announce').textContent.length > 0")
    said = page.text_content("#announce")
    last = page.evaluate("dbf.model.byTicker.LMT.quarters.slice(-1)[0].quarter")
    assert said.startswith(last) and "billion" in said and "million" in said
    assert page.evaluate("!!document.querySelector('#c-backlog').parentNode.querySelector('.tip.show')")
    page.keyboard.press("Escape")
    assert not page.evaluate("!!document.querySelector('#c-backlog').parentNode.querySelector('.tip.show')")
    page.context.close()


def test_scenario_changes_are_announced_once_settled(browser, base_url):
    page = open_page(browser, base_url)
    page.focus("#shock")
    for _ in range(3):
        page.keyboard.press("ArrowRight")
    page.wait_for_function("document.getElementById('announce').textContent.includes('scenario revenue')")
    assert page.text_content("#announce").startswith("Backlog +")
    page.context.close()


def test_focus_never_sits_under_the_sticky_header(browser, base_url):
    page = open_page(browser, base_url, width=1280, height=720)
    hidden = []
    for _ in range(140):
        page.keyboard.press("Tab")
        r = page.evaluate(
            """async () => {
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
              const a = document.activeElement, bar = document.querySelector('.top');
              if (!a || a === document.body || bar.contains(a) || a.matches('.skip')) return null;
              const box = a.getBoundingClientRect(), top = bar.getBoundingClientRect().bottom;
              if (box.top < top - 1) return a.id || a.className || a.tagName;
              // Nor under anything else that sticks, such as the table's header and totals
              // cells: whatever draws at the focused element's centre must be the element.
              const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
              return hit && !a.contains(hit) && !hit.contains(a) ? 'covered: ' + (a.textContent || a.id || a.tagName) : null;
            }"""
        )
        if r:
            hidden.append(r)
    assert hidden == []
    page.context.close()


@pytest.mark.parametrize("width", [390, 1280])
def test_the_table_caption_wraps_inside_its_box(browser, base_url, width):
    page = open_page(browser, base_url, width=width)
    fits = page.evaluate(
        """() => {
          const c = document.getElementById('t-caption'), box = document.getElementById('tbl');
          return c.textContent.length > 0 && c.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1;
        }"""
    )
    assert fits
    # Screen readers still get it as the table's own caption.
    assert page.text_content("#data caption") == page.text_content("#t-caption")
    page.context.close()


def test_a_hidden_tooltip_never_widens_a_narrowed_page(browser, base_url):
    page = open_page(browser, base_url, width=1280)
    page.focus("#c-fc")
    page.keyboard.press("End")
    page.keyboard.press("Escape")
    page.set_viewport_size({"width": 375, "height": 812})
    page.wait_for_timeout(200)
    # Measured against the usable width: a desktop scrollbar makes innerWidth a few px wider.
    assert page.evaluate(
        "[...document.querySelectorAll('.tip')].every(t => t.getBoundingClientRect().right <= document.documentElement.clientWidth)"
    )
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.context.close()


def test_motion_on_runs_without_errors(browser, base_url):
    page = open_page(browser, base_url, reduced_motion="no-preference")
    # 2 then R with no frame between them, as on a slow machine: the replay must start on
    # the new company and keep playing once that company is drawn.
    page.evaluate(
        """async () => {
          for (const key of ['2', 'r']) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        }"""
    )
    assert page.get_attribute("#play", "aria-pressed") == "true"
    page.keyboard.press("r")
    assert page.get_attribute("#play", "aria-pressed") == "false"
    page.focus("#c-bridge")
    page.keyboard.press("ArrowRight")
    page.wait_for_function("document.getElementById('announce').textContent.length > 0")
    assert page.errors == []
    page.context.close()


# ---------- reconciliation, states and the table ----------


@pytest.mark.parametrize("ticker", ["HII", "LHX", "LMT", "NOC", "RTX"])
def test_reconciliation_passes_for_each_company_and_all_five(browser, base_url, ticker):
    page = open_page(browser, base_url, hash="#" + ticker)
    for scope, says in (("company", f"({ticker})"), ("all", "all five companies")):
        page.select_option("#t-scope", scope)
        page.wait_for_function("s => document.getElementById('recon-sum').textContent.includes(s)", arg=says)
        assert page.get_attribute("#recon", "data-ok") == "true"
        summary = page.text_content("#recon-sum")
        assert "5 of 5 checks pass" in summary and "max difference $0.00" in summary
    # The bridge table foots to the cent.
    assert page.text_content("#bridge-table tfoot td").endswith("$0.00")
    assert page.errors == []
    page.context.close()


def test_chart_tooltip_figure_matches_the_table_cell(browser, base_url):
    page = open_page(browser, base_url)
    page.focus("#c-backlog")
    page.keyboard.press("End")
    page.wait_for_selector("#c-backlog ~ .tip.show")
    tip = page.text_content("#c-backlog ~ .tip.show")
    # The table's last row is the latest quarter; column 5 is trailing revenue in US$ millions.
    cell = page.evaluate("[...document.querySelectorAll('#data tbody tr')].pop().children[5].textContent")
    assert cell.endswith("M") and cell in tip
    page.context.close()


def test_kpi_variance_colour_follows_favourability(browser, base_url):
    page = open_page(browser, base_url)
    for t in ("LMT", "RTX"):
        page.click(f"#f-company [data-value='{t}']")
        page.wait_for_function("t => document.getElementById('kpis-co-title').textContent.includes(t)", arg=t)
        card = page.evaluate(
            """() => { const k = document.getElementById('kpi-co-mape');
                return { tone: k.dataset.tone, text: k.querySelector('.kpi-delta').textContent }; }"""
        )
        # An error above the baseline's is unfavourable; below it, favourable.
        assert card["tone"] == ("unfav" if card["text"].startswith("▲") else "fav")
    assert {page.get_attribute("#kpi-co-mape", "data-tone")} <= {"fav", "unfav"}
    assert page.get_attribute("#kpi-bias", "data-tone") == "neutral"
    page.context.close()


def test_an_empty_period_shows_empty_states_and_recovers(browser, base_url):
    page = open_page(browser, base_url, hash="#LHX")
    page.select_option("#f-to", "2019")
    for panel in ("p-backlog", "p-fc", "p-bridge"):
        page.wait_for_selector(f"#{panel}[data-state='empty'] > .state button")
    assert page.is_visible("#data tr.empty")
    page.click("#p-fc > .state button")  # Show all years
    page.wait_for_selector("#p-fc[data-state='ready']")
    assert page.input_value("#f-from") == "2018" and page.input_value("#f-to") == "2026"
    assert page.errors == []
    page.context.close()


def test_a_failed_download_shows_an_error_and_retries(browser, base_url):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.emulate_media(reduced_motion="reduce")
    fail = {"on": True}

    def handle(route):
        if fail["on"]:
            route.fulfill(status=500, body="no")
        else:
            route.continue_()

    page.route("**/data.json", handle)
    page.goto(base_url + "#LMT")
    page.wait_for_selector("#page-state[role='alert'] button")
    assert "HTTP 500" in page.text_content("#page-state")
    assert page.get_attribute("#p-backlog", "data-state") == "error"
    fail["on"] = False
    page.click("#page-state button")
    wait_ready(page)
    assert page.is_hidden("#page-state")
    assert page.get_attribute("#p-backlog", "data-state") == "ready"
    ctx.close()


def test_table_search_sort_and_export(browser, base_url):
    page = open_page(browser, base_url)
    page.click("#tt-forecasts")
    page.select_option("#t-scope", "all")
    page.fill("#t-search", "rtx backlog")
    page.wait_for_function("document.getElementById('t-count').textContent.startsWith('Showing 13 of 13')")
    page.click("th button.sort[data-key='ape']")
    page.wait_for_selector("th[aria-sort='ascending'] button.sort[data-key='ape']")
    apes = page.evaluate("[...document.querySelectorAll('#data tbody tr')].map(r => parseFloat(r.children[7].textContent))")
    assert len(apes) == 13 and apes == sorted(apes)
    with page.expect_download() as dl:
        page.click("#t-export")
    lines = Path(dl.value.path()).read_text().strip().split("\n")
    assert len(lines) == 14 and lines[0].startswith("Company,")
    page.context.close()
