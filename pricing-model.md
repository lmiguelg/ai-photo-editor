# Pricing Model & Costs: AI Photo Editor for Airbnb Listings

> All numbers are **assumptions to validate**. Edit the inputs and the rest follows.

## 1. Pricing (what the customer pays)

| Item | Price |
|---|---|
| Per listing (flat, up to 25 photos) | **$45** |
| Extra photos beyond 25 (optional) | $1.50 / photo |

Assumption: a typical Airbnb listing has 20-30 photos, so I use **25 photos per listing** as the baseline.

## 2. Variable costs (per listing)

| Cost | Calculation | Amount |
|---|---|---|
| AI processing | 25 photos x $0.10 | $2.50 |
| Re-runs / failed generations (20% buffer) | $2.50 x 20% | $0.50 |
| Payment fees (Stripe 2.9% + $0.30) | $45 x 2.9% + $0.30 | $1.61 |
| **Total variable cost** | | **$4.61** |

**Gross profit per listing: $40.39 (about 90% margin).**

> Note: I read "$0.10 per image" as **your cost** to process an image. If you meant a price charged to the customer, the $45 flat fee already covers 25 photos, so it would only apply as the overage price for extra photos.

### Sensitivity to photo count

| Photos / listing | Variable cost | Gross profit | Margin |
|---|---|---|---|
| 15 | $3.41 | $41.59 | 92% |
| 25 | $4.61 | $40.39 | 90% |
| 40 | $6.41 | $38.59 | 86% |

## 3. Fixed monthly costs (estimates)

| Cost | Monthly |
|---|---|
| Hosting / backend | $20 |
| Storage for photos (S3 or similar) | $10 |
| Domain, email, misc. tools | $20 |
| **Starter total** | **$50** |
| Marketing budget (optional, ads / outreach tools) | $200 |

## 4. Break-even

- Covering fixed costs only: $50 / $40.39 = **2 listings / month**
- Covering fixed costs plus marketing: $250 / $40.39 = **7 listings / month**

## 5. Monthly projections

| Listings / month | Revenue | Variable costs | Fixed costs | Profit |
|---|---|---|---|---|
| 10 | $450 | $46 | $50 | **$354** |
| 50 | $2,250 | $231 | $100 | **$1,920** |
| 200 | $9,000 | $922 | $300 | **$7,778** |

Fixed costs rise with volume (more hosting, support tooling). Your own time is not counted here. Reviewing outputs and handling customers is the real cost at the start.

## 6. Things to decide / validate next

1. **Real AI cost per image.** Test the model or API you pick. $0.10 may be high or low depending on whether you use enhancement, relighting, sky replacement, or virtual staging.
2. **Photos per listing** from real hosts, to confirm the 25-photo baseline.
3. **Willingness to pay.** Compare with human real-estate photo editing ($1-5 per photo, so $25-125 per listing) to anchor $45. Test $35, $45, and $59.
4. **Packages**, for example Basic $29 (10 photos), Standard $45 (25 photos), and Pro $79 (50 photos plus a manual touch-up pass).
5. **Hosts with multiple properties.** Offer a bundle discount (e.g. 5 listings for $180) to raise lifetime value.
6. **Refund / revision policy.** One free re-edit per listing is a sensible default.
