"""Accessibility checks on the dashboard in a real browser.

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


def open_page(browser, base_url, width=1280, height=900, **media):
    ctx = browser.new_context(viewport={"width": width, "height": height})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    media.setdefault("reduced_motion", "reduce")
    page.emulate_media(**media)
    page.goto(base_url + "#LMT")
    page.wait_for_selector("html.ready #tiles .tile")
    page.wait_for_function("document.getElementById('c-fan').getAttribute('aria-label').length > 20")
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
    # Open every table and a definition, so their markup is checked too.
    for b in page.query_selector_all(".table-toggle"):
        b.scroll_into_view_if_needed()
        b.click()
    page.click("#score-title + .info")
    assert axe(page) == []
    # Again further down, with the compact bar showing.
    page.evaluate("window.scrollTo(0, document.getElementById('p-fc').offsetTop)")
    page.wait_for_selector("#cbar.show")
    assert axe(page) == []
    assert page.errors == []
    page.context.close()


def test_skip_link_is_first_and_lands_on_the_cards(browser, base_url):
    page = open_page(browser, base_url)
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.className") == "skip"
    assert page.is_visible(".skip")
    page.keyboard.press("Enter")
    assert page.evaluate("document.activeElement.id") == "cos"
    page.keyboard.press("Tab")
    assert page.evaluate("!!document.activeElement.closest('#cos')")
    page.context.close()


def test_arrow_keys_move_between_company_cards(browser, base_url):
    page = open_page(browser, base_url)
    page.focus("#tab-LMT")
    page.keyboard.press("ArrowRight")
    assert page.evaluate("document.activeElement.id") == "tab-NOC"
    assert page.get_attribute("#tab-NOC", "aria-selected") == "true"
    assert page.get_attribute("#tab-LMT", "aria-selected") == "false"
    page.keyboard.press("Home")
    assert page.get_attribute("#tab-HII", "aria-selected") == "true"
    page.context.close()


def test_single_key_shortcuts_can_be_switched_off(browser, base_url):
    page = open_page(browser, base_url)
    page.keyboard.press("1")
    assert page.get_attribute("#tab-HII", "aria-selected") == "true"
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
    assert page.get_attribute("#tab-HII", "aria-selected") == "true"
    assert page.get_attribute("#tab-HII", "aria-keyshortcuts") is None
    # The choice survives a reload.
    page.reload()
    page.wait_for_selector("html.ready #tiles .tile")
    assert page.get_attribute("#keys-switch", "aria-checked") == "false"
    page.keyboard.press("3")
    assert page.get_attribute("#tab-HII", "aria-selected") == "true"
    page.context.close()


def test_a_focused_chart_reads_out_each_point(browser, base_url):
    page = open_page(browser, base_url)
    page.focus("#c-backlog")
    page.keyboard.press("End")
    page.wait_for_function("document.getElementById('announce').textContent.length > 0")
    said = page.text_content("#announce")
    last = page.evaluate("document.querySelector('#t-backlog').$spec.rows.slice(-1)[0][0]")
    assert said.startswith(last) and "billion" in said
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


def test_focus_never_sits_under_the_compact_bar(browser, base_url):
    page = open_page(browser, base_url, width=1280, height=720)
    hidden = []
    for _ in range(90):
        page.keyboard.press("Tab")
        r = page.evaluate(
            """async () => {
              // Let the scroll settle and the bar's observer run before measuring.
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
              const a = document.activeElement, bar = document.getElementById('cbar');
              if (!a || a === document.body || bar.contains(a) || a.matches('.skip')) return null;
              if (!bar.classList.contains('show')) return null;
              const box = a.getBoundingClientRect(), top = bar.getBoundingClientRect().bottom;
              return box.top < top - 1 ? (a.id || a.className || a.tagName) : null;
            }"""
        )
        if r:
            hidden.append(r)
    assert hidden == []
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
    page.context.close()


def test_motion_on_runs_without_errors(browser, base_url):
    page = open_page(browser, base_url, reduced_motion="no-preference")
    page.wait_for_selector("html.intro-done")
    page.keyboard.press("2")
    page.keyboard.press("r")
    page.wait_for_function("document.getElementById('play').getAttribute('aria-pressed') === 'true'")
    page.keyboard.press("r")
    assert page.get_attribute("#play", "aria-pressed") == "false"
    page.focus("#c-bridge")
    page.keyboard.press("ArrowRight")
    page.wait_for_function("document.getElementById('announce').textContent.length > 0")
    assert page.errors == []
    page.context.close()
