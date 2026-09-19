# Adonia Mini App

A tiny, dependency-free storefront: it reads the product catalog from `data.json`,
lists the products, and lets the visitor search them, add them to a shopping cart,
and see the total price.

The Android app owns `data.json` — it overwrites that one file whenever the catalog
changes, and the page picks the change up on its own.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | All styling (responsive, light + dark) |
| `app.js` | Data loading, search, filtering, cart |
| `data.json` | Product catalog — **written by the Android app** |
| `images/` | Sample product photos (optional; any URL works) |

## Features

- **Product list** rendered from `data.json`
- **Search** across name, category and description (accent- and case-insensitive, multi-word)
- **Category filter** chips, generated automatically from the catalog
- **Shopping cart** in a slide-in drawer, with a docked cart bar that shows the live item
  counter and the running total
- **Total price** of the purchase, plus a per-item line total
- **Responsive** from 320 px phones to wide desktops, with safe-area padding for notched
  screens. The catalog scrolls in its own region, so the cart bar can never cover a button.
- **Light and dark theme** following the device setting, plus Telegram Mini App theming
  (`telegram-web-app.js` is fetched only when the page is opened from a Telegram client —
  a normal browser visit never touches that CDN)
- **Auto-refresh** — re-checks `data.json` every 60 s and when the tab regains focus;
  the ⟳ button forces an immediate reload
- Cart survives page reloads via `localStorage`, quantity controls respect `stock`, and
  entries for products that vanish from `data.json` are dropped automatically
- Tested in headless Chromium: 60 checks covering rendering, search, cart maths, stock caps,
  persistence, 320/390/768/1440 px layouts, dark mode, malformed `data.json`, missing
  `data.json`, an empty catalog, and HTML-injection attempts in product names

## Running locally

Open `index.html` through a web server — `fetch()` cannot read `data.json` from a
`file://` URL:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying

Any static host works. For GitHub Pages: **Settings → Pages → Source: Deploy from a
branch → `main` / root**. The app is then served from
`https://buboadonis-lab.github.io/Adonia-Mini-App/`.

## `data.json` contract

The Android app should write valid JSON in this shape:

```json
{
  "store": { "name": "Adonia", "currency": "USD" },
  "updatedAt": "2026-09-20T09:00:00Z",
  "products": [
    {
      "id": "AD-1001",
      "name": "Aura Wireless Headphones",
      "description": "Over-ear Bluetooth headphones.",
      "price": 129.9,
      "category": "Electronics",
      "image": "images/headphones.jpg",
      "stock": 14
    }
  ]
}
```

### Field reference

| Field | Required | Notes |
| --- | --- | --- |
| `id` | recommended | Unique and stable — the cart is keyed by it. Defaults to the array index. |
| `name` | yes | Shown on the card and in the cart. |
| `price` | yes | Number. Strings such as `"$129.90"` are parsed too. |
| `description` | no | Clamped to two lines on the card. |
| `category` | no | Drives the filter chips; shown as a label. |
| `image` | no | Relative path or full URL. Without it, the first letter of the name is shown. |
| `stock` | no | If present, `0` marks the item *Out of stock* and caps how many can be added. Omitted means unlimited. |

`price` is formatted with `Intl.NumberFormat` using the catalog's `currency`, so
changing that one field switches the whole page to another currency.

### Robustness notes

- Wrapping the array in `{ "products": [...] }` is expected, but a bare
  `[ {...}, {...} ]` array also works, as do the aliases `items` / `data` / `catalog`.
- Common field-name aliases are accepted case-insensitively (`title`, `imageUrl`,
  `qty`, `amount`, …), so the Android side can evolve without breaking the page.
- Unknown fields are ignored.
- If a product disappears from `data.json`, its cart entry is dropped on the next load.
- Product names and descriptions are inserted as text, never as HTML.
