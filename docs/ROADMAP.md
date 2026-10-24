# Storefront Roadmap

**Goal:** customers can browse plants, pick the ones they want, choose a pickup slot for the locker that nobody
else has taken, and pay. Plant Stock (`root_access_inventory_management`) stays the master record; this theme is
how customers see it and how their choices get back to it.

Nothing here is built yet. The open questions are answered and folded into **Decisions**; once the roadmap is
approved, work through the phases in order.

## Can the theme alone stop two customers taking the same slot?

No. A Shopify theme is Liquid templates and browser JavaScript. It has no database of its own, and the pickup
date and window it saves today are cart attributes, which belong to one shopper's cart. One cart can't see what
is in another, so the theme can't know a slot is taken.

It is possible once something with memory decides which slots are free. Plant Stock already has a database, a
Shopify app, and an import of every order, so it is the natural place:

1. **Plant Stock answers "which slots are free?"** through a Shopify **App Proxy**: a URL on the store's own
   domain (for example `rootaccesshtx.com/apps/plant-stock/pickup-slots`) that Shopify forwards to Plant Stock
   with a signature. Because it's the store's own domain, the theme's JavaScript can call it with no CORS setup,
   and Plant Stock can check that the request really came through Shopify.
2. **The cart page loads all free slots for the next 30 days in one call** when it opens (at most 90 with one
   locker and 3 windows a day). The date picker marks fully booked days before the customer clicks them,
   switching dates needs no new call, and taken windows are greyed out.
3. **Choosing a slot puts a short hold on it** (30 minutes), so a second shopper can't take it
   while the first is paying. The hold's ID is saved on the cart with the date and window.
4. **The order confirms the booking.** When the order reaches Plant Stock (it already imports orders by webhook
   and each minute), Plant Stock turns the hold into a booking.
5. **Holds that never become orders expire**, and the slot is free again. Cancelled orders free their slot too.

The one gap: Shopify's checkout itself can't be blocked by Plant Stock on our plan (see Decisions). If a hold
expires while a shopper sits on the payment page and someone else takes the slot, both orders go through.
Plant Stock catches it when the second order arrives and flags it for staff to move. Holds that are refreshed
when the shopper clicks Checkout make this rare.

```
Cart page ──GET  /apps/plant-stock/pickup-slots──▶ Plant Stock: free slots for the next 30 days
          ──POST /apps/plant-stock/pickup-holds──▶ Plant Stock: hold slot, return hold ID
          ── cart attributes: Pickup date, Pickup window, Pickup hold ──▶ Checkout ──▶ Order
Order ──webhook / minute check──▶ Plant Stock: hold → booking (or flag a clash for staff)
```

## Decisions (proposed)

| Topic | Proposal |
|---|---|
| Who owns pickup rules | **Change:** Plant Stock decides which slots exist and which are free (lead time, closed days, bookings). The theme only shows them. Today the windows are built in Liquid from theme settings; that moves to Plant Stock (its roadmap is being updated to match) |
| What a slot is | One locker × one date × one window. The booking covers that window only, so back-to-back windows can be booked by different customers. With one locker and today's 3 windows a day, that's at most 3 locker orders a day. More lockers later means more slots per window, with no theme change |
| Earliest slot | A window can be chosen only if its start time is at least 8 hours from now (clock hours, any day). At 4:00 PM the 12 AM window is the earliest; at 4:01 PM it's too soon, so the earliest is the next window after it. A window that starts sooner is never offered, even if it's still open |
| Ready by | Staff must have the order in the locker by the start of its booked window, which is always at least 8 hours after purchase. This replaces Plant Stock's "8 working hours after purchase" deadline (changed in that repo) |
| Missed windows | The slot is released once its window ends, so another customer can take it. Plant Stock emails the customer who missed it to choose a new window (on Plant Stock's roadmap) |
| How the theme talks to Plant Stock | Shopify App Proxy on the Plant Stock app (`[app_proxy]` in `shopify/shopify.app.<site>.toml`). No API keys in the theme. Plant Stock checks Shopify's signature on every call |
| Holds | 30-minute hold when a slot is picked, refreshed on Checkout, released when the shopper picks a different slot or empties the cart. Limits per cart so one visitor can't hold every slot |
| Loading slots | One call when the cart page opens returns every free slot for the next 30 days, not one call per date. The list is fetched again after a "just taken" reply or when the page has been open a while |
| What's saved on the order | Keep the existing `Pickup date` and `Pickup window` attributes (emails and the admin already use them), and add a hold ID. Plant Stock reads them from the order it already imports |
| Clashes | If two orders end up in one slot, Plant Stock flags it and staff contact the customer to sort it out. The theme does nothing extra |
| Pickup note | No separate field. The cart's existing optional note ("Anything we should know?") is saved as the order note, and Plant Stock reads it from the imported order to show staff with the booking |
| Final check at checkout | Not now. Blocking checkout needs a Shopify Function (cart and checkout validation), and Shopify only runs Functions from custom apps on Shopify Plus. Revisit if Plant Stock becomes a public app or the store moves to Plus. To confirm in Shopify's docs before we rely on this |
| Order size | Up to 8 plants per order (theme setting "Most plants per order"), and every order uses a locker slot. Plant Stock's "over 4 plants means in-person pickup" rule isn't applied in the cart for now; decide how to handle a bigger order if one ever doesn't fit |
| If Plant Stock is down | The cart shows a clear "pickup times are unavailable, try again shortly" message and blocks checkout, rather than letting someone book a slot nobody checked |
| Stock shown on the site | Comes from Shopify, which Plant Stock keeps up to date. The theme doesn't call Plant Stock for stock |

## Phases

### 1. Ready to sell (theme only, no Plant Stock changes)
- [ ] Check every page against real products synced from the Plant Stock staging site to the `root-access-staging` store: titles, descriptions, prices, pot-size variants, photos in the right order, sold-out state
- [ ] Decide which product details Plant Stock should also send (for example light, water, pot size, care notes) and show them on the product page; agree the field names with Plant Stock
- [x] Show low stock ("Only 2 left") from Shopify's inventory counts, on plant cards and product pages (theme setting "Show Only N left at this many or fewer", default 3)
- [x] Cart limits: up to 8 plants per order, all picked up from the locker (see Decisions)
- [ ] Store settings before launch: payments, taxes, local pickup location, policies (refund, privacy, terms), password page off, domain
- [ ] Order emails: add pickup details to the confirmation email (`docs/notifications.md`)

### 2. Pickup slots in Plant Stock (`root_access_inventory_management`)
These are built in the other repo; listed here so both sides agree on the contract.
- [ ] Slot rules in Plant Stock: windows per day, the 8-hour lead time, closed days, 30-day limit, lockers
- [x] Bookings and holds tables, with a database rule that a locker slot can have only one live hold or booking (so two requests at the same moment can't both win)
- [x] App Proxy set up in the app config, with signature checks
- [x] `GET pickup-slots`: every free slot for the next 30 days in one response, grouped by date, in Houston time
- [x] `POST pickup-holds`: hold a slot, or say it was just taken; refresh and release a hold; a refresh at Checkout fails if the window now starts less than 8 hours away, so the shopper picks again
- [x] Turn holds into bookings when orders are imported; flag clashes and orders with no valid slot
- [ ] Expire holds after 30 minutes; free the slot when an order is cancelled or its window ends without pickup
- [ ] Staff screen: bookings by day, and moving an order to another slot

### 3. Pickup slots in the theme
- [x] Cart page loads the 30 days of free slots from Plant Stock in one call instead of building windows in Liquid; fully booked days are marked in the date picker and taken windows disabled with "booked"
- [x] Picking a slot places a hold and saves `Pickup date`, `Pickup window`, and the hold ID on the cart
- [x] "That slot was just taken": refresh the list and ask the shopper to pick again
- [x] Refresh the hold when Checkout is clicked; release it when the slot changes or the cart is emptied
- [x] Loading, error, and "Plant Stock unavailable" states; keyboard and screen-reader friendly
- [x] Remove the theme settings that Plant Stock now owns (window hours, lead days, closed days), or keep them only as display text
- [x] Test on the staging theme against Plant Stock staging, including two browsers racing for the same slot

### 4. After the order
- [ ] Order status / thank-you page shows the booked slot (Shopify's thank-you page extensions work on all plans)
- [ ] Confirmation email with pickup instructions and the locker PIN (Plant Stock Phase 4)
- [ ] Customers change their pickup slot or cancel after ordering, on the theme's **My pickup** page (`page.my-pickup` template): order number and email, then Plant Stock's `my-pickup` endpoints through the App Proxy. Page built; to test against Plant Stock staging once its endpoints are deployed
- [ ] Reminder before the window, and an email asking the customer to choose a new window if they miss it (Plant Stock)

### 5. Later
- [ ] One-hour slots instead of windows, with the locker held until the order is picked up (then released for the next booking)
- [ ] More lockers and pickup locations: the cart shows a location picker when there's more than one
- [ ] Customers pick a specific plant from its photos (needs Plant Stock to expose individual plants)
- [ ] Final slot check inside checkout, if the store moves to Plus or the app goes public
