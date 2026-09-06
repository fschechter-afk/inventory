-- Shape the store list around how the school actually buys: four sites
-- ordered from online, four places shopped in person. Everything else stays
-- in the table, inactive, one dashboard toggle away from coming back.
-- Applied to project aheiyytqvzxkoowykkgt as "trim_order_sites_to_active_four"
-- and "restructure_order_sites".

-- An online tile opens the store; an in-store tile goes straight to the
-- purchase form, because there's no website to visit at the checkout lane.
alter table public.order_sites
  add column if not exists kind text not null default 'online'
    check (kind in ('online', 'in_store'));

insert into public.order_sites (name, url, blurb, emoji, category, category_order, sort_order)
values ('Aldi', 'https://www.aldi.us/', 'Grocery run', '🛒', 'Shop in store', 2, 4)
on conflict (name) do nothing;

update public.order_sites set active = false;

update public.order_sites
set active = true, kind = 'online', category = 'Order online', category_order = 1, sort_order = v.ord
from (values ('Amazon', 1), ('Walmart', 2), ('Sam''s Club', 3), ('WebstaurantStore', 4)) as v(nm, ord)
where order_sites.name = v.nm;

update public.order_sites
set active = true, kind = 'in_store', category = 'Shop in store', category_order = 2, sort_order = v.ord
from (values ('Jewel-Osco', 1), ('Kol Tuv Kosher Foods', 2), ('Restaurant Depot', 3), ('Aldi', 4)) as v(nm, ord)
where order_sites.name = v.nm;

update public.order_sites set blurb = 'Tap when you shop there — logs what you spent'
where kind = 'in_store' and active;
