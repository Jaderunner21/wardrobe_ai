/**
 * Retailer durability — module 18 §4, the thing the whole feature is for.
 *
 * A Server Component that renders NOTHING until three items share a retailer. There is
 * no empty state and no prompt to go and fill in retailers: an insight that needs
 * coaxing out of the user is not an insight, and one bad shirt is a bad shirt rather
 * than evidence about a shop.
 *
 * Every line is phrased as the user's own record — "your 3 items from here have
 * averaged 15 wears" — never as a rating of the business. Same data; only one of the
 * two is defensible once the product is public, and combined with price from module 17
 * it gets sharp on its own: a ₹600 shirt that fails at 12 wears costs ₹50 a wear, a
 * ₹1,400 one that lasts 90 costs ₹15. Cheap turns out expensive, in their own numbers.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { retailerDurability } from '@/lib/retailers';
import { formatMoney } from '@/lib/cpw';

export async function RetailerDurabilityPanel({
  supabase,
  currency,
}: {
  supabase: SupabaseClient;
  currency: string | null | undefined;
}) {
  const rows = await retailerDurability(supabase);
  if (rows.length === 0) return null;

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
      <h2 className="text-section font-semibold tracking-tight">Where your clothes last</h2>
      <p className="mt-1 text-meta text-text-dim">
        From your own wardrobe, once you own three things from the same shop.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-meta">
          <thead className="text-text-mute">
            <tr>
              <th scope="col" className="pb-2 font-medium">
                Shop
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Items
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Avg wears
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Per wear
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Wear shows at
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.retailer} className="border-t border-border">
                <td className="py-2 pr-3 text-text">{row.retailer}</td>
                <td className="py-2 text-right text-text-dim">{row.items}</td>
                <td className="py-2 text-right text-text">{round(row.avgWears)}</td>
                <td className="py-2 text-right text-text-dim">
                  {formatMoney(row.avgCostPerWear, currency)}
                </td>
                {/* Null until something from that shop has actually declined. Inventing
                    a number for a shop whose clothes are all still fine would be the
                    opposite of the point. */}
                <td className="py-2 text-right text-text-dim">
                  {row.avgWearsToDecline === null ? '—' : `${round(row.avgWearsToDecline)} wears`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
