/**
 * Authenticated shell (module 01 repo layout, module 16 §2).
 *
 * The middleware already redirects signed-out users, so the check here is defence in
 * depth: a layout that renders a wardrobe must never do so without a user.
 */
import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/supabase/server';
import { NavBar } from '@/components/NavBar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  /*
   * The rail shows who is signed in, so the shell reads the profile once and hands it
   * down. NavBar is a client component for `usePathname`; fetching in there would mean
   * a round trip after paint on every navigation for a name that never changes.
   */
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <div className="min-h-dvh">
      <NavBar
        email={user.email ?? undefined}
        displayName={(profile?.display_name as string | null) ?? null}
      />

      {/*
        md:pl-[272px] clears the fixed rail; pb-24 clears the mobile tab bar, and each
        collapses at the breakpoint where the other takes over.
      */}
      <div className="md:pl-[272px]">
        <main className="shell py-8 pb-24 md:pb-10 md:pt-10">{children}</main>
      </div>
    </div>
  );
}
