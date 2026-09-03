-- 0011_outfit_style.sql
-- Finishes the occasions → style rename that 0002 started.
--
-- 0002 §2 introduced `style_t`, collapsed `items.occasions[]` into `items.style`, and
-- stopped there. `outfits.occasion` was left as free text with the old vocabulary, so
-- the two tables disagreed about what the same concept is called.
--
-- It surfaced as `column outfits.style does not exist` — a 500 on the Outfits page —
-- because `types.ts` declares `Outfit.style: Style | null` and every read written
-- against that type asked for a column the database never had.
--
-- Same value mapping 0002 used for items, so an outfit saved under the old vocabulary
-- keeps its meaning.

begin;

alter table outfits rename column occasion to style;

alter table outfits
  alter column style type style_t
  using case lower(style)
    when 'home'    then 'lounge'
    when 'gym'     then 'workout'
    when 'college' then 'casual'
    when 'travel'  then 'casual'
    when 'work'    then 'business'
    when 'wedding' then 'formal'
    when 'lounge'  then 'lounge'
    when 'workout' then 'workout'
    when 'casual'  then 'casual'
    when 'date-night' then 'date-night'
    when 'party'   then 'party'
    when 'business' then 'business'
    when 'formal'  then 'formal'
    else null
  end::style_t;

commit;
