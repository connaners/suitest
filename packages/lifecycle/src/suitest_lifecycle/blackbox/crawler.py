"""Blackbox crawler — open a real browser, log in, walk the app, capture evidence.

No repo, no LLM, no testid requirement. Per page it records: interactive
elements (rich attributes for the selector strategy), pattern classification,
screenshot, console errors, network failures, and blank/crash detection.
SafeMode (default ON) refuses to follow destructive links (logout, delete,
billing, payment, …).

Async Playwright; :func:`discover` is the sync entry every consumer calls.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

from suitest_lifecycle.blackbox.detector import detect_login_form, detect_page_pattern
from suitest_lifecycle.blackbox.models import (
    BlackboxUiConfig,
    DiscoveryResult,
    ElementInfo,
    LoginForm,
    LoginProbe,
    PageInfo,
)

try:
    from suitest_shared.ocr import solve_captcha_in_page
except ImportError:
    solve_captcha_in_page = None
if TYPE_CHECKING:
    from playwright.async_api import Locator, Page

# Rich per-element capture: every attribute the selector strategy ranks.
_EXTRACT_JS = r"""
() => {
  const vis = (el) => {
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch {
      return false;
    }
  };
  const labelFor = (doc, el) => {
    try {
      if (el.id) { const l = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.innerText.trim(); }
      const wrap = el.closest('label'); return wrap ? wrap.innerText.trim().slice(0, 80) : '';
    } catch {
      return '';
    }
  };
  const cssPath = (el) => {
    try {
      const parts = [];
      let cur = el;
      for (let i = 0; cur && cur.nodeType === 1 && i < 5; i++) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) { parts.unshift(`#${cur.id}`); break; }
        const sibs = cur.parentElement ? [...cur.parentElement.children].filter(c => c.tagName === cur.tagName) : [];
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    } catch {
      return '';
    }
  };
  const resolveIconOrTooltip = (el) => {
    try {
      const tooltip = (
        el.getAttribute('title') ||
        el.getAttribute('data-original-title') ||
        el.getAttribute('data-bs-original-title') ||
        el.getAttribute('tooltip') ||
        ''
      ).trim();
      const iconEl = el.querySelector('i, svg, span[class*="icon" i], [class*="fa-" i], [class*="lucide" i], [class*="bi-" i]');
      let iconClass = '';
      if (iconEl) {
        if (typeof iconEl.className === 'string') {
          iconClass = iconEl.className;
        } else if (iconEl.className && iconEl.className.baseVal) {
          iconClass = iconEl.className.baseVal;
        }
      }
      let svgTitle = '';
      if (iconEl && iconEl.tagName && iconEl.tagName.toLowerCase() === 'svg') {
        svgTitle = (iconEl.querySelector('title')?.textContent || iconEl.getAttribute('aria-label') || '').trim();
      }
      let iconName = '';
      if (iconClass) {
        const m = iconClass.match(/\\b(?:fa|bi|lucide|icon)-([a-z0-9-]+)\\b/i);
        if (m) {
          iconName = m[1].replace(/-(alt|outline|fill|circle|square)/gi, '');
        }
      }
      let lookupHint = '';
      const inputGroup = el.closest('.input-group, .form-group, .search-box');
      if (inputGroup) {
        const sibInput = inputGroup.querySelector('input');
        if (sibInput) {
          const sibDesc = sibInput.name || sibInput.placeholder || sibInput.id || '';
          if (sibDesc) lookupHint = `[lookup:${sibDesc.slice(0, 30)}]`;
        }
      }
      const iconHint = iconName ? `[icon:${iconName}]` : (svgTitle || lookupHint);
      return {
        tooltip: tooltip.slice(0, 80),
        iconHint: iconHint.slice(0, 80),
      };
    } catch {
      return { tooltip: '', iconHint: '' };
    }
  };
  const info = (doc, el, kind, frameSel = '') => {
    const iconData = resolveIconOrTooltip(el);
    const rawText = (el.innerText || el.value || '').trim().slice(0, 80);
    const isIconOnly = !rawText && Boolean(iconData.tooltip || iconData.iconHint);
    return {
      tag: el.tagName.toLowerCase(),
      kind,
      testid: el.getAttribute('data-testid') || el.getAttribute('data-cy') || el.getAttribute('data-test') || '',
      testid_attr: el.hasAttribute('data-testid') ? 'data-testid' : el.hasAttribute('data-cy') ? 'data-cy' : el.hasAttribute('data-test') ? 'data-test' : '',
      role: el.getAttribute('role') || '',
      aria_label: el.getAttribute('aria-label') || '',
      label: labelFor(doc, el),
      placeholder: el.getAttribute('placeholder') || '',
      name: el.getAttribute('name') || '',
      input_type: (el.getAttribute('type') || '').toLowerCase(),
      autocomplete: el.getAttribute('autocomplete') || '',
      text: rawText || iconData.tooltip || iconData.iconHint || '',
      dom_id: el.id || '',
      href: el.getAttribute && el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
      css: cssPath(el),
      required: el.required === true || el.getAttribute('aria-required') === 'true',
      frame_selector: frameSel,
      is_multiple: el.multiple === true,
      accept: el.getAttribute('accept') || '',
      tooltip: iconData.tooltip,
      icon_hint: iconData.iconHint,
      is_icon_only: isIconOnly,
    };
  };
  const extractDoc = (doc, frameSel = '') => {
    try {
      const ins = [...doc.querySelectorAll('input,textarea,select')].filter(vis).map(e => info(doc, e, e.tagName === 'SELECT' ? 'select' : (e.type === 'checkbox' ? 'checkbox' : 'input'), frameSel));
      const btns = [...doc.querySelectorAll('button,[role=button],input[type=submit],a[role=button]')].filter(vis).map(e => info(doc, e, 'button', frameSel));
      const lnks = [...doc.querySelectorAll('a[href]')].filter(vis).map(e => info(doc, e, 'link', frameSel)).filter(l => l.href.startsWith('/'));
      return { inputs: ins, buttons: btns, links: lnks };
    } catch {
      return { inputs: [], buttons: [], links: [] };
    }
  };
  const rootExtracted = extractDoc(document, '');
  const inputs = [...rootExtracted.inputs];
  const buttons = [...rootExtracted.buttons];
  const links = [...rootExtracted.links];

  // Frame traversal (piercing iframes)
  try {
    const iframes = [...document.querySelectorAll('iframe,frame')].filter(vis);
    for (const ifr of iframes) {
      try {
        const idoc = ifr.contentDocument || ifr.contentWindow?.document;
        if (!idoc) continue;
        let frameSel = '';
        if (ifr.id) frameSel = `iframe#${ifr.id}`;
        else if (ifr.name) frameSel = `iframe[name="${ifr.name}"]`;
        else if (ifr.src) {
          try {
            const u = new URL(ifr.src, window.location.href);
            frameSel = `iframe[src*="${u.pathname}"]`;
          } catch {
            frameSel = `iframe[src="${ifr.src}"]`;
          }
        } else {
          frameSel = 'iframe';
        }
        const fData = extractDoc(idoc, frameSel);
        inputs.push(...fData.inputs);
        buttons.push(...fData.buttons);
        links.push(...fData.links);
      } catch {}
    }
  } catch {}

  // CAPTCHA detection
  let hasCaptcha = false;
  let captchaInputSelector = '';
  let captchaImageSelector = '';
  let captchaType = 'auto';
  let refreshTarget = '';
  const checkCaptchaInDoc = (doc, frameSel = '') => {
    try {
      const cInput = [...doc.querySelectorAll('input')].filter(vis).find(e => {
        const blob = ((e.name || '') + ' ' + (e.id || '') + ' ' + (e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '')).toLowerCase();
        return blob.includes('captcha') || blob.includes('security_code') || blob.includes('verify_code');
      });
      if (!cInput) return null;
      let inSel = cInput.id ? `#${cInput.id}` : (cInput.name ? `input[name="${cInput.name}"]` : 'input[type="text"]');
      if (frameSel) inSel = `${frameSel} >>> ${inSel}`;
      const container = cInput.closest('form') || cInput.parentElement?.parentElement || doc.body;
      let imgSel = '';
      const cImg = container ? container.querySelector('img[src*="captcha" i], img#img-captcha, img#captcha, canvas#captcha, img[alt*="captcha" i], canvas') : null;
      if (cImg) {
        imgSel = cImg.id ? `#${cImg.id}` : (cImg.tagName === 'CANVAS' ? 'canvas' : (cImg.getAttribute('src') && cImg.getAttribute('src').toLowerCase().includes('captcha') ? 'img[src*="captcha" i]' : 'img'));
        if (frameSel) imgSel = `${frameSel} >>> ${imgSel}`;
      }
      return { hasCaptcha: true, inputSelector: inSel, imageSelector: imgSel, refreshTarget: imgSel };
    } catch {
      return null;
    }
  };
  const cap = checkCaptchaInDoc(document, '');
  if (cap) {
    hasCaptcha = cap.hasCaptcha;
    captchaInputSelector = cap.inputSelector;
    captchaImageSelector = cap.imageSelector;
    refreshTarget = cap.refreshTarget;
  } else {
    try {
      const iframes = [...document.querySelectorAll('iframe,frame')].filter(vis);
      for (const ifr of iframes) {
        try {
          const idoc = ifr.contentDocument || ifr.contentWindow?.document;
          if (!idoc) continue;
          const frameSel = ifr.id ? `iframe#${ifr.id}` : (ifr.name ? `iframe[name="${ifr.name}"]` : 'iframe');
          const ifrCap = checkCaptchaInDoc(idoc, frameSel);
          if (ifrCap) {
            hasCaptcha = ifrCap.hasCaptcha;
            captchaInputSelector = ifrCap.inputSelector;
            captchaImageSelector = ifrCap.imageSelector;
            refreshTarget = ifrCap.refreshTarget;
            break;
          }
        } catch {}
      }
    } catch {}
  }

  const tables = document.querySelectorAll('table tbody tr, [role=row], [role=grid] [role=row]');
  let rowSelector = '';
  if (document.querySelector('table tbody tr')) rowSelector = 'table tbody tr';
  else if (document.querySelector('[role=grid] [role=row]')) rowSelector = '[role=grid] [role=row]';
  const counts = {};
  document.querySelectorAll('[data-testid]').forEach(e => { const t = e.getAttribute('data-testid'); counts[t] = (counts[t] || 0) + 1; });
  const repeated = Object.entries(counts).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  if (!rowSelector && repeated.length) rowSelector = `[data-testid="${repeated[0][0]}"]`;
  const search = [...document.querySelectorAll('input[type=search],input[placeholder]')].filter(vis)
    .find(e => /search|cari|filter/i.test((e.getAttribute('placeholder') || '') + (e.getAttribute('name') || '') + (e.getAttribute('aria-label') || '')));
  const pager = [...document.querySelectorAll('button,a')].filter(vis)
    .find(e => /next|»|older|selanjutnya/i.test((e.innerText || '').trim()) || (e.getAttribute('aria-label') || '').match(/next page/i));
  return {
    title: document.title || '',
    inputs, buttons, links,
    testids: [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))],
    hasTable: tables.length >= 1 || !!rowSelector,
    rowSelector,
    hasModal: !!document.querySelector('[role=dialog],[aria-modal=true],dialog[open]'),
    searchInfo: search ? info(document, search, 'input') : null,
    pagerInfo: pager ? info(document, pager, 'button') : null,
    textSample: (document.body ? document.body.innerText : '').trim().slice(0, 1500),
    elementCount: document.body ? document.body.querySelectorAll('*').length : 0,
    hasCaptcha,
    captchaInputSelector,
    captchaImageSelector,
    captchaType,
    refreshTarget,
    landmarkText: ((document.querySelector('h1, h2, [role="heading"], .navbar-brand, .brand')?.innerText || '').trim() || document.title || '').trim().slice(0, 80),
  };
}
"""


_SAFE_SKIP_HREF = re.compile(
    r"(logout|log-out|sign-?out|delete|remove|destroy|billing|payment|checkout|subscribe"
    r"|unsubscribe|deactivate)",
    re.I,
)


async def _smart_settle(
    page: Page,
    *,
    quiet_sec: float = 1.5,
    timeout_sec: float = 4.0,
) -> None:
    """Smart navigation settle: commit, body attached, and network quiescence."""
    with contextlib.suppress(Exception):
        await page.wait_for_load_state("domcontentloaded", timeout=5000)
    with contextlib.suppress(Exception):
        await page.wait_for_selector("body", state="attached", timeout=5000)
    try:
        await page.wait_for_load_state("networkidle", timeout=int(quiet_sec * 1000))
    except Exception:
        with contextlib.suppress(Exception):
            await page.wait_for_timeout(min(int(quiet_sec * 1000), int(timeout_sec * 1000)))


async def _goto(page: Page, url: str) -> None:
    """Navigate like the real internet works: DOMContentLoaded or commit with smart settle."""
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=20000)
    except Exception:
        await page.goto(url, wait_until="commit", timeout=20000)
    await _smart_settle(page, quiet_sec=1.5, timeout_sec=4.0)


async def _solve_captcha_for_form(page: Page, form: LoginForm, login_page: PageInfo) -> str:
    """Solve detected CAPTCHA using shared in-browser OCR, falling back safely."""
    if not form.captcha_input:
        return ""
    img_sel = (
        form.captcha_image
        or getattr(login_page, "captcha_image_selector", "")
        or "img[src*='captcha' i], #img-captcha, #captcha, canvas"
    )
    if solve_captcha_in_page is not None:
        with contextlib.suppress(Exception):
            res = await solve_captcha_in_page(page, img_sel, timeout_ms=6000)
            if res.get("status") == "solved" and res.get("text"):
                return str(res["text"])
    return "CAPTCHA_SOLVE"


def _route_of(url: str, base: str) -> str:
    tail = url[len(base) :] if url.startswith(base) else url
    tail = tail.split("?", 1)[0].split("#", 1)[0]
    return tail or "/"


def _excluded(route: str, cfg: BlackboxUiConfig) -> bool:
    if any(route.startswith(x) for x in cfg.crawl.exclude):
        return True
    if cfg.crawl.include and not any(route.startswith(x) for x in cfg.crawl.include):
        return True
    return bool(cfg.crawl.safe_mode and _SAFE_SKIP_HREF.search(route))


async def _snapshot(
    page: Page,
    route: str,
    depth: int,
    evidence_dir: Path,
    console_errors: list[str],
    network_errors: list[str],
    *,
    shot_name: str,
) -> PageInfo:
    data = await page.evaluate(_EXTRACT_JS)
    shot = ""
    try:
        evidence_dir.mkdir(parents=True, exist_ok=True)  # noqa: ASYNC240 — tiny, one-off, local FS
        shot_path = evidence_dir / f"{shot_name}.png"
        await page.screenshot(path=str(shot_path))
        shot = str(shot_path)
    except Exception:  # screenshot must never sink the crawl
        shot = ""
    info = PageInfo(
        route=route,
        url=page.url,
        title=str(data.get("title", "")),
        depth=depth,
        inputs=[ElementInfo.from_json(e) for e in data.get("inputs", [])],
        buttons=[ElementInfo.from_json(e) for e in data.get("buttons", [])],
        links=[ElementInfo.from_json(e) for e in data.get("links", [])],
        nav_routes=sorted({str(e.get("href", "")) for e in data.get("links", []) if e.get("href")}),
        testids=[str(t) for t in data.get("testids", [])],
        has_table=bool(data.get("hasTable")),
        row_locator=(
            f"page.locator('{data.get('rowSelector')}')" if data.get("rowSelector") else ""
        ),
        has_modal=bool(data.get("hasModal")),
        console_errors=list(console_errors),
        network_errors=list(network_errors),
        screenshot=shot,
        visible_text_sample=str(data.get("textSample", "")),
        blank=int(data.get("elementCount", 0)) < 5 or not str(data.get("textSample", "")).strip(),
        has_captcha=bool(data.get("hasCaptcha")),
        captcha_input_selector=str(data.get("captchaInputSelector", "")),
        captcha_image_selector=str(data.get("captchaImageSelector", "")),
        captcha_type=str(data.get("captchaType", "auto")),
        refresh_target=str(data.get("refreshTarget", "")),
        landmark_text=str(data.get("landmarkText", "")),
    )
    from suitest_lifecycle.blackbox.selector import build_locator

    if data.get("searchInfo"):
        info.search_locator = build_locator(ElementInfo.from_json(data["searchInfo"]))
    if data.get("pagerInfo"):
        info.pagination_locator = build_locator(ElementInfo.from_json(data["pagerInfo"]))
    info.pattern = detect_page_pattern(info)
    info.has_form = info.pattern == "form" or (
        len([e for e in info.inputs if e.input_type not in ("checkbox", "radio", "hidden")]) >= 2
        and bool(info.buttons)
    )
    return info


async def _discover(cfg: BlackboxUiConfig, evidence_dir: Path) -> DiscoveryResult:
    from playwright.async_api import async_playwright

    base = cfg.target_url.rstrip("/")
    result = DiscoveryResult(base_url=base)
    console_errors: list[str] = []
    network_errors: list[str] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not cfg.headed)
        context_kwargs: dict[str, object] = {"viewport": {"width": 1280, "height": 720}}
        if cfg.storage_state_path and Path(cfg.storage_state_path).is_file():  # noqa: ASYNC240
            context_kwargs["storage_state"] = str(cfg.storage_state_path)
        ctx = await browser.new_context(**context_kwargs)
        page = await ctx.new_page()
        page.on(
            "console",
            lambda m: console_errors.append(m.text[:300]) if m.type == "error" else None,
        )
        page.on("pageerror", lambda e: console_errors.append(str(e)[:300]))
        page.on(
            "response",
            lambda r: (
                network_errors.append(f"{r.status} {r.url[:200]}") if r.status >= 500 else None
            ),
        )
        page.on(
            "requestfailed",
            # ERR_ABORTED = request cancelled by navigation (Next.js RSC
            # prefetch, analytics beacons) — normal behavior, not a bug signal.
            lambda r: (
                network_errors.append(f"FAILED {r.url[:200]} {r.failure or ''}")
                if "ERR_ABORTED" not in str(r.failure or "")
                else None
            ),
        )

        # ---- 1. login page ---------------------------------------------------
        login_route = cfg.auth.login_url or "/login"
        try:
            await _goto(page, base + login_route)
        except Exception:
            try:
                await _goto(page, base + "/")
            except Exception as exc:
                result.errors.append(f"target unreachable: {exc}")
                await browser.close()
                return result
        login_route = _route_of(page.url, base)
        console_errors.clear()
        network_errors.clear()
        login_page = await _snapshot(
            page, login_route, 0, evidence_dir, console_errors, network_errors, shot_name="login"
        )
        result.pages.append(login_page)

        form = detect_login_form(login_page, ignore_testids=cfg.crawl.ignore_testids)
        # manual overrides beat detection (docs: selectors.loginUsername/…)
        if cfg.selectors.login_username:
            form.username = _as_locator(cfg.selectors.login_username)
        if cfg.selectors.login_password:
            form.password = _as_locator(cfg.selectors.login_password)
        if cfg.selectors.login_submit:
            form.submit = _as_locator(cfg.selectors.login_submit)
        result.login = form if form.found() else None
        # ---- 2. perform login -------------------------------------------------
        if cfg.storage_state_path and Path(cfg.storage_state_path).is_file():  # noqa: ASYNC240
            result.storage_state_path = str(cfg.storage_state_path)
            landed_initial = _route_of(page.url, base)
            initial_login_route = cfg.auth.login_url or "/login"
            if landed_initial != initial_login_route or not (result.login and result.login.found()):
                result.login_probe = LoginProbe(
                    attempted=True,
                    success=True,
                    landed_route=landed_initial,
                    detail="authenticated via imported storage_state",
                )

        if (
            not result.login_probe.success
            and result.login
            and cfg.auth.username
            and cfg.auth.password
        ):
            probe = LoginProbe(attempted=True)
            max_login_attempts = 3 if form.captcha_input else 1
            for attempt in range(max_login_attempts):
                try:
                    await _eval_locator(page, form.username).fill(cfg.auth.username)
                    await _eval_locator(page, form.password).fill(cfg.auth.password)
                    if form.captcha_input:
                        solved_c = await _solve_captcha_for_form(page, form, login_page)
                        if solved_c:
                            with contextlib.suppress(Exception):
                                c_loc = page.locator(form.captcha_input)
                                if await c_loc.count() > 0:
                                    await c_loc.fill(solved_c)
                    await _eval_locator(page, form.submit).click()
                    with contextlib.suppress(Exception):
                        await page.wait_for_url(
                            lambda u: _route_of(u, base) != login_route, timeout=8000
                        )
                    await _smart_settle(page, quiet_sec=1.5, timeout_sec=4.0)
                    landed = _route_of(page.url, base)
                    probe.landed_route = landed
                    probe.success = landed != login_route
                    if probe.success:
                        state_file = evidence_dir / "storage_state.json"
                        with contextlib.suppress(Exception):
                            await ctx.storage_state(path=str(state_file))
                            if state_file.is_file():
                                result.storage_state_path = str(state_file)
                        break
                    err = await page.evaluate(
                        "() => { const e = document.querySelector('[role=alert],"
                        "[class*=error],[data-testid*=error]');"
                        " return e ? (e.innerText || '').slice(0, 120) : ''; }"
                    )
                    probe.detail = (
                        f"attempt {attempt + 1}: stayed on {landed}; error: {err or 'none shown'}"
                    )
                    if attempt < max_login_attempts - 1 and form.captcha_input:
                        refresh_sel = (
                            getattr(login_page, "refresh_target", "")
                            or form.captcha_image
                            or ".refresh-captcha, img[src*='captcha' i], #img-captcha"
                        )
                        with contextlib.suppress(Exception):
                            r_loc = page.locator(refresh_sel)
                            if await r_loc.count() > 0:
                                await r_loc.first.click()
                                await page.wait_for_timeout(600)
                except Exception as exc:
                    probe.detail = f"login interaction failed on attempt {attempt + 1}: {exc}"[:300]
            result.login_probe = probe
        elif not result.login_probe.success and result.login:
            result.login_probe = LoginProbe(attempted=False, detail="no credentials configured")
        # ---- 3. BFS crawl ------------------------------------------------------
        # Seed from everywhere we already know: where we landed, the root, the
        # nav links captured on the entry page, and config includes. Without
        # this, an app with no /login (entry 404s) would dead-end immediately.
        start_route = _route_of(page.url, base)
        seeds = [start_route, "/", *login_page.nav_routes, *cfg.crawl.include]
        queue: list[tuple[str, int]] = [(r, 0) for r in dict.fromkeys(seeds)]
        visited: set[str] = {login_route}
        while queue and len(result.pages) < cfg.crawl.max_routes:
            route, depth = queue.pop(0)
            if route in visited or depth > cfg.crawl.max_depth:
                continue
            if _excluded(route, cfg) and route != start_route:
                result.skipped_routes.append(route)
                continue
            visited.add(route)
            console_errors.clear()
            network_errors.clear()
            try:
                await _goto(page, base + route)
            except Exception as exc:
                result.errors.append(f"{route}: navigation failed: {exc}"[:200])
                continue
            landed = _route_of(page.url, base)
            info = await _snapshot(
                page,
                route,
                depth,
                evidence_dir,
                console_errors,
                network_errors,
                shot_name=_shot_name(route),
            )
            info.protected = landed != route and "login" in landed.lower()
            result.pages.append(info)
            _enqueue_routes(
                queue,
                info.nav_routes,
                visited,
                depth=depth + 1,
                limit=cfg.crawl.max_routes * 3,
            )

        await browser.close()
    return result


def _enqueue_routes(
    queue: list[tuple[str, int]],
    routes: list[str],
    visited: set[str],
    *,
    depth: int,
    limit: int,
) -> None:
    for route in routes:
        if route not in visited and len(queue) < limit:
            queue.append((route, depth))


def _shot_name(route: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", route).strip("_") or "root"
    return f"page_{slug}"[:80]


def _as_locator(expr: str) -> str:
    """Accept either a full ``page.…`` expression or a raw CSS selector."""
    e = expr.strip()
    return e if e.startswith("page.") else f'page.locator("{e}")'


def _eval_locator(page: Page, expr: str) -> Locator:
    """Resolve a stored locator EXPRESSION on a live page.

    The expression grammar is our own output (``build_locator``/`_as_locator``),
    so evaluating it against the page object is safe and keeps one single
    source of truth between discovery-time interaction and generated code.
    """
    return cast("Locator", eval(expr, {"page": page}))


def discover(cfg: BlackboxUiConfig, evidence_dir: str | Path) -> DiscoveryResult:
    """Sync entry: full blackbox discovery (login + crawl + evidence)."""
    return asyncio.run(_discover(cfg, Path(evidence_dir)))


async def _analyze_one(cfg: BlackboxUiConfig, url: str, evidence_dir: Path) -> PageInfo:
    from playwright.async_api import async_playwright

    base = cfg.target_url.rstrip("/") or url
    console_errors: list[str] = []
    network_errors: list[str] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not cfg.headed)
        state_file = None
        if cfg.storage_state_path and Path(cfg.storage_state_path).is_file():  # noqa: ASYNC240
            state_file = Path(cfg.storage_state_path)
        elif (evidence_dir / "storage_state.json").is_file():
            state_file = evidence_dir / "storage_state.json"
        elif (evidence_dir / "blackbox" / "storage_state.json").is_file():
            state_file = evidence_dir / "blackbox" / "storage_state.json"
        state_arg = str(state_file) if state_file and state_file.stat().st_size > 0 else None
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            storage_state=state_arg,
        )
        page = await ctx.new_page()
        page.on(
            "console",
            lambda m: console_errors.append(m.text[:300]) if m.type == "error" else None,
        )
        page.on("pageerror", lambda e: console_errors.append(str(e)[:300]))
        if url.startswith("http"):
            target = url
        elif base.endswith(url):
            target = base
        else:
            target = base + url
        await _goto(page, target)
        route = _route_of(page.url, base)
        info = await _snapshot(
            page,
            route,
            0,
            evidence_dir,
            console_errors,
            network_errors,
            shot_name=_shot_name(route),
        )
        await browser.close()
    return info


def analyze_single_page(cfg: BlackboxUiConfig, url: str, evidence_dir: str | Path) -> PageInfo:
    """Sync entry: analyze ONE page (pattern + elements + evidence), no crawl."""
    return asyncio.run(_analyze_one(cfg, url, Path(evidence_dir)))


async def _handle_gateway(
    cfg: BlackboxUiConfig,
    evidence_dir: Path,
    action_trigger: str,
    *,
    gateway_type: str = "role_or_tenant",
    target_value: str = "",
) -> dict[str, Any]:
    from playwright.async_api import async_playwright

    base = cfg.target_url.rstrip("/")
    if "://" in base and "/" in base.split("://", 1)[1]:
        from urllib.parse import urlsplit

        parsed = urlsplit(base)
        base = f"{parsed.scheme}://{parsed.netloc}"
    console_errors: list[str] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not cfg.headed)
        state_file = None
        if cfg.storage_state_path and Path(cfg.storage_state_path).is_file():  # noqa: ASYNC240
            state_file = Path(cfg.storage_state_path)
        elif (evidence_dir / "storage_state.json").is_file():
            state_file = evidence_dir / "storage_state.json"
        elif (evidence_dir / "blackbox" / "storage_state.json").is_file():
            state_file = evidence_dir / "blackbox" / "storage_state.json"
        state_arg = str(state_file) if state_file and state_file.stat().st_size > 0 else None
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            storage_state=state_arg,
        )
        page = await ctx.new_page()
        page.on(
            "console", lambda m: console_errors.append(m.text[:300]) if m.type == "error" else None
        )
        page.on("pageerror", lambda e: console_errors.append(str(e)[:300]))

        login_route = cfg.auth.login_url or "/login"
        try:
            await _goto(page, base + login_route)
        except Exception:
            await _goto(page, base + "/")

        if target_value:
            with contextlib.suppress(Exception):
                inp = page.locator(
                    "input:not([type=hidden]):not([type=checkbox]):not([type=radio])"
                ).first
                if await inp.count() > 0:
                    await inp.fill(target_value)

        trigger = page.locator(action_trigger)
        if hasattr(trigger, "first"):
            trigger = trigger.first
        await trigger.wait_for(state="visible", timeout=10000)
        await trigger.click()

        await _smart_settle(page, quiet_sec=1.5, timeout_sec=5.0)

        landed = _route_of(page.url, base)
        evidence_dir.mkdir(parents=True, exist_ok=True)  # noqa: ASYNC240
        out_state_file = evidence_dir / "storage_state.json"
        with contextlib.suppress(Exception):
            await ctx.storage_state(path=str(out_state_file))

        shot_path = evidence_dir / f"gateway_{gateway_type}.png"
        with contextlib.suppress(Exception):
            await page.screenshot(path=str(shot_path))

        await browser.close()
        return {
            "success": True,
            "gateway_type": gateway_type,
            "action_trigger": action_trigger,
            "landed_route": landed,
            "storage_state_path": str(out_state_file) if out_state_file.is_file() else "",
            "screenshot": str(shot_path) if shot_path.is_file() else "",
        }


def handle_gateway(
    cfg: BlackboxUiConfig,
    evidence_dir: str | Path,
    action_trigger: str,
    *,
    gateway_type: str = "role_or_tenant",
    target_value: str = "",
) -> dict[str, Any]:
    """Sync entry: execute intermediate gateway interaction and update storage_state."""
    return asyncio.run(
        _handle_gateway(
            cfg,
            Path(evidence_dir),
            action_trigger,
            gateway_type=gateway_type,
            target_value=target_value,
        )
    )


__all__ = ["analyze_single_page", "discover", "handle_gateway"]
