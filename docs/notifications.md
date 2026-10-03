# Pickup details in order emails

The cart saves the customer's choice as two order attributes, `Pickup date` and `Pickup window`. They show in Shopify admin under each order's **Additional details**, but Shopify's emails don't include them unless you add them.

## Where to paste

Shopify admin → **Settings → Notifications → Customer notifications**, then edit:

1. **Order confirmation**
2. **Ready for local pickup**: sent when you mark an order ready

In each template, find the line with `{{ email_title }}` or the first `<p>` of the message body, and paste the snippet below just after it. Use **Preview** to check it, then **Save**.

## Snippet

```liquid
{% if attributes['Pickup date'] != blank %}
  <table class="row" style="margin: 16px 0;">
    <tr>
      <td>
        <p style="margin: 0 0 4px;"><strong>Pickup date:</strong> {{ attributes['Pickup date'] | date: '%A, %B %-d, %Y' }}</p>
        <p style="margin: 0 0 4px;"><strong>Pickup window:</strong> {{ attributes['Pickup window'] }}</p>
        <p style="margin: 0;">Your locker PIN will be emailed before your window opens.</p>
      </td>
    </tr>
  </table>
{% endif %}
```

Notes:

- If you rename the cart fields in `sections/main-cart.liquid` (`attributes[Pickup date]`, `attributes[Pickup window]`), update the names here too.
- Edit the last line to match how you actually send the locker PIN.
