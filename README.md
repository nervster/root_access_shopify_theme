# Root Access — Custom Shopify Theme

A custom Shopify storefront theme for **[Root Access HTX](https://rootaccesshtx.com)**, a small Houston plant business. It sells home-grown plants for pickup from a self-serve locker at any time of day. Customers choose a pickup date and time window while they shop, and that choice goes through checkout onto the order.

The theme is built from scratch on Shopify's Online Store 2.0 architecture. It doesn't start from a purchased or starter theme, and it uses no front-end framework or JavaScript dependencies.

**Live site:** [rootaccesshtx.com](https://rootaccesshtx.com)

---

## At a glance

| | |
|---|---|
| **What it is** | Production storefront for a real local business: catalog, product pages, cart and pickup scheduling |
| **Stack** | Shopify Liquid, vanilla JavaScript (no dependencies, no build step), CSS with custom properties, Shopify CLI |
| **Delivery** | Git branches map to Shopify themes (`main` → live, `staging` → preview) with two-way GitHub sync |
| **Quality** | Automated `shopify theme check` in GitHub Actions, PR checklist, responsive testing from 320px to desktop |

## Features

**Pickup scheduling**
- The cart collects a pickup **date** and a **time window** and saves them as Shopify cart attributes. They then appear on the order in the Shopify admin and can be added to customer emails.
- Pickup windows are generated in Liquid from theme settings: two daytime windows plus one overnight window by default. A window that crosses midnight is labeled as overnight automatically.
- Client-side rules enforce a minimum lead time, optional closed days and a 30-day booking limit. If the date or window is missing or invalid, checkout is blocked with an inline message.
- Checkout is pickup-only. The checkout wording is overridden through the theme's language file, so buyers never see shipping options.

**Shopping experience**
- Add to cart without a page reload, using Shopify's AJAX Cart API, with a status popup and a live cart count.
- Product quick view built on the native `<dialog>` element, sharing one detail layout with the full product page.
- A photo gallery that pairs "your plant today" with "what it can grow into".
- Price filter chips on the collection grid.
- Products with several options open a chooser instead of silently adding the first option.
- A featured product in the hero that falls back to the first in-stock plant if the chosen one sells out.
- An out-of-stock state with a restock email signup. Signups are tagged in Shopify for follow-up.

**Content and SEO**
- Product structured data (JSON-LD), Open Graph and Twitter meta tags, and canonical URLs.
- Contact page with a Shopify contact form, plus custom 404, search, blog, account and password pages.

**Design and accessibility**
- A light, readable palette taken from the brand mascot. Text colors meet WCAG AA contrast.
- Responsive layouts tested down to 320px-wide phones, a sticky header with visible navigation on mobile, and layouts that adapt from phone to wide desktop.
- Skip link, visible focus states, labeled form controls, ARIA live regions for cart updates and reduced-motion support.

## Engineering practices

- **Branching:** work happens on `feature/*` branches cut from `staging` and is merged through pull requests. `staging` is previewed on an unpublished Shopify theme, and only reviewed changes are merged to `main`, which is the live theme.
- **Two-way sync:** Shopify commits edits made in the admin theme editor back to the connected branch as `shopify[bot]`, so content changes and code share one history.
- **CI:** GitHub Actions runs Shopify's theme linter on every pull request and on every push to `main` and `staging`. Errors fail the build.
- **Merchant-editable:** almost all copy, pickup hours, window lengths and featured products are theme settings, so the store owner can change them in the Shopify editor without code.

## Project structure

```
assets/      root-access.css (design system + layout), root-access.js (cart, dialogs, pickup rules)
config/      Theme settings schema; settings_data.json is maintained by Shopify
layout/      Page shells (main storefront, password page)
locales/     Storefront and checkout text overrides
sections/    Page sections: hero, plant collection, pickup steps, cart, product, contact, header/footer groups
snippets/    Reusable components: product card, product detail, logo, restock form, meta tags
templates/   JSON templates that compose sections for each page type
docs/        Store setup notes (e.g. pickup details in order emails)
```

## Running it locally

Requires the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) and access to the store.

```sh
npm install -g @shopify/cli@latest
shopify theme dev --store 7dvyba-ku.myshopify.com   # local preview with hot reload on a private dev theme
shopify theme check                                  # lint (same check CI runs)
```

`theme dev` never touches the live site.

## Workflow

| Branch | Shopify theme | Purpose |
|---|---|---|
| `main` | live theme | What customers see. Updated only by pull requests from `staging`. |
| `staging` | unpublished preview theme | Test changes on the real store before release. |
| `feature/*` | none | Day-to-day work, branched from `staging`. |

Run `git pull` before starting work. Shopify may have pushed theme-editor changes to the branch.

## License

[MIT](LICENSE) © 2026 Nirav Sheth
