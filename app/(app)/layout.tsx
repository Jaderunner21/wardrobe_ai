/**
 * Authenticated shell (module 01 repo layout, module 16 §2).
 *
 * The middleware already redirects signed-out users, so the check here is defence in
 * depth: a layout that renders a wardrobe must never do so without a user.
 */
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { NavBar } from '@/components/NavBar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-dvh">
      <NavBar />
      {/* pb-24 clears the mobile tab bar; it collapses at md where the bar is gone. */}
      <main className="shell py-8 pb-24 md:pb-8">{children}</main>
    </div>
  );
}
