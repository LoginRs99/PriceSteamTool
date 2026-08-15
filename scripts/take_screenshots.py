import os
import sys
from playwright.sync_api import sync_playwright

SCREENSHOT_DIR = os.path.join(os.getcwd(), 'screenshots')
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

viewports = [
    {"name": "1920x1080_desktop", "width": 1920, "height": 1080},
    {"name": "1440x900_laptop", "width": 1440, "height": 900},
    {"name": "1280x800_compact", "width": 1280, "height": 800},
    {"name": "1024x768_tablet_land", "width": 1024, "height": 768},
    {"name": "768x1024_tablet_port", "width": 768, "height": 1024},
    {"name": "390x844_mobile", "width": 390, "height": 844},
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    
    for vp in viewports:
        print(f"Testing viewport: {vp['name']} ({vp['width']}x{vp['height']})", flush=True)
        context = browser.new_context(viewport={"width": vp["width"], "height": vp["height"]})
        page = context.new_page()
        
        # Navigate to main page
        page.goto("http://localhost:3000", wait_until="domcontentloaded")
        page.wait_for_selector('.navbar', timeout=5000)
        page.wait_for_timeout(1000)
        
        # 1. Main View (Grid)
        page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{vp['name']}_01_grid.png"), full_page=False)
        
        # 2. Switch to List View
        list_btn = page.locator('button[aria-label*="Compact List View"]').first
        if list_btn.is_visible():
            list_btn.click()
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{vp['name']}_02_list.png"), full_page=False)
        
        # 3. Switch to Table View
        table_btn = page.locator('button[aria-label*="Dense Table View"]').first
        if table_btn.is_visible():
            table_btn.click()
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{vp['name']}_03_table.png"), full_page=False)

        # Switch back to Grid
        grid_btn = page.locator('button[aria-label*="Grid View"]').first
        if grid_btn.is_visible():
            grid_btn.click()
            page.wait_for_timeout(300)

        # 4. Top Ranked Deals Tab
        deals_tab = page.locator('.main-tab-btn:has-text("Top Ranked Deals")')
        if deals_tab.is_visible():
            deals_tab.click()
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{vp['name']}_04_top_deals.png"), full_page=False)

        # 5. Free Games Tab
        free_tab = page.locator('.main-tab-btn:has-text("Free Games")')
        if free_tab.is_visible():
            free_tab.click()
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{vp['name']}_05_free_games.png"), full_page=False)

        # Return to Wishlist Tab
        wish_tab = page.locator('.main-tab-btn:has-text("Wishlist Deals")')
        if wish_tab.is_visible():
            wish_tab.click()
            page.wait_for_timeout(300)

        # 6. Open Game Detail Modal (Click on Cyberpunk 2077 card)
        game_card = page.locator('.game-card').first
        if game_card.is_visible():
            game_card.click()
            page.wait_for_selector('.modal-overlay', timeout=3000)
            page.wait_for_timeout(600)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{vp['name']}_06_game_detail_modal.png"), full_page=False)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

        # 7. Open Sources Diagnostics Modal
        sources_btn = page.locator('button:has-text("Diagnostics")')
        if sources_btn.is_visible():
            sources_btn.click()
            page.wait_for_selector('.modal-overlay', timeout=3000)
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{vp['name']}_07_sources_modal.png"), full_page=False)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

        # 8. Open Anomalies Modal
        anomalies_btn = page.locator('button:has-text("Anomalies")')
        if anomalies_btn.is_visible():
            anomalies_btn.click()
            page.wait_for_selector('.modal-overlay', timeout=3000)
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{vp['name']}_08_anomalies_modal.png"), full_page=False)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

        context.close()
        
    browser.close()
    print("✅ Screenshots completed successfully for all 6 viewports!", flush=True)
