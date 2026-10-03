# Root Access Shopify Theme

Shopify theme for [Root Access HTX](https://rootaccesshtx.com), a Houston plant shop with 24/7 locker pickup.

Store: `7dvyba-ku.myshopify.com`

## Branches

| Branch | Shopify theme | Purpose |
|---|---|---|
| `main` | `root_access_shopify_theme/main` (**live**) | What customers see. Change only through pull requests from `staging`. |
| `staging` | unpublished staging theme | Preview and test changes on the real store. |
| `feature/*` | none | Day-to-day work. Open pull requests into `staging`. |

Flow: `feature/*` → PR into `staging` → check the staging preview → PR from `staging` into `main` → live.

Shopify syncs **both ways**. When anyone edits text, settings or languages in the Shopify admin theme editor, Shopify commits that change to the connected branch (author `shopify[bot]`). Always `git pull` before you start work.

## Local development

Requires the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) (`npm install -g @shopify/cli@latest`).

```sh
shopify theme dev --store 7dvyba-ku.myshopify.com   # local preview with hot reload
shopify theme check                                  # lint (also runs in CI)
```

`theme dev` uses a private development theme and never touches the live site.

## Checks

GitHub Actions runs `shopify theme check` on every pull request and on pushes to `main` and `staging`. Errors fail the check; warnings are allowed.

## Store setup that isn't in this repo

- Order and pickup emails: see [docs/notifications.md](docs/notifications.md).
- Contact page: in Shopify admin, create a page with the handle `contact` and choose the **page.contact** template. The footer links to it automatically.

## Layout

```
assets/      CSS, JS, images
config/      Theme settings (settings_data.json is edited by Shopify)
layout/      Page shells (theme, password)
locales/     Storefront and checkout text overrides
sections/    Page sections; header/footer groups
snippets/    Reusable pieces (product card, product detail, logo)
templates/   Which sections each page type uses
```
