"""Drive the dashboard via Chromium, screenshot every page, and dump
client-side console errors so we can audit UI/UX issues without a
human-in-the-loop screenshare."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path("/tmp/ow_audit")
OUT.mkdir(exist_ok=True)
BASE = "http://localhost:3001"
SESSION_ID = sys.argv[1] if len(sys.argv) > 1 else None

PAGES = [
    ("login", "/login"),
    ("setup", "/setup"),
    ("overview", "/"),
    ("patrol", "/patrol"),
    ("incidents", "/incidents"),
    ("calendar", "/calendar"),
    ("settings", "/settings"),
    ("account", "/settings/account"),
]

VIEWPORTS = {
    "desktop": (1440, 900),
    "narrow": (768, 900),
}


def run() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        report: dict = {}

        for vname, (w, h) in VIEWPORTS.items():
            context = browser.new_context(viewport={"width": w, "height": h})
            if SESSION_ID:
                context.add_cookies(
                    [
                        {
                            "name": "ov_session",
                            "value": SESSION_ID,
                            "domain": "localhost",
                            "path": "/",
                        }
                    ]
                )

            for name, path in PAGES:
                page = context.new_page()
                errors: list[str] = []
                page.on(
                    "pageerror",
                    lambda e: errors.append(f"pageerror: {e}"),
                )
                page.on(
                    "console",
                    lambda m: errors.append(f"console.{m.type}: {m.text}")
                    if m.type in ("error", "warning")
                    else None,
                )
                try:
                    response = page.goto(f"{BASE}{path}", wait_until="networkidle", timeout=15000)
                    status = response.status if response else None
                    final_url = page.url
                except Exception as e:  # noqa: BLE001
                    status = None
                    final_url = f"ERROR: {e}"

                out_png = OUT / f"{vname}_{name}.png"
                page.screenshot(path=str(out_png), full_page=True)

                report[f"{vname}/{name}"] = {
                    "path": path,
                    "final_url": final_url,
                    "status": status,
                    "errors": errors,
                    "screenshot": str(out_png),
                }
                page.close()
            context.close()

        browser.close()
        (OUT / "report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    run()
