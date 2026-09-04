-- Starting list of stores for the ordering portal.
-- Idempotent: re-running leaves existing rows (and any dashboard edits) alone.
-- This is a starting point, not a fixed list -- add, retire, or reorder stores
-- from the Supabase Table Editor and the portal picks it up on next load.

insert into public.order_sites (name, url, blurb, emoji, category, category_order, sort_order) values
('Kol Tuv Kosher Foods','https://shop.koltuvkosher.com/','Kosher grocery — delivery and pickup','🛒','Kosher Grocery',1,1),
('Hungarian Kosher Foods','https://www.hungariankosher.com/','Skokie kosher grocery, deli and meat','🥩','Kosher Grocery',1,2),

('Instacart','https://www.instacart.com/','Same-day delivery from local stores','🚚','Grocery & Delivery',2,1),
('Jewel-Osco','https://www.jewelosco.com/','Everyday grocery, delivery or pickup','🥛','Grocery & Delivery',2,2),
('Mariano''s','https://www.marianos.com/','Grocery, produce and bakery','🍎','Grocery & Delivery',2,3),

('Costco','https://www.costco.com/','Bulk pantry, paper goods, drinks','📦','Bulk & Warehouse',3,1),
('Sam''s Club','https://www.samsclub.com/','Bulk food and household','🏷️','Bulk & Warehouse',3,2),
('Restaurant Depot','https://www.restaurantdepot.com/','Case-size food and kitchen supply','🍽️','Bulk & Warehouse',3,3),
('WebstaurantStore','https://www.webstaurantstore.com/','Kitchen equipment, disposables, serving','🍴','Bulk & Warehouse',3,4),

('Amazon','https://www.amazon.com/','Anything else — fast shipping','📮','General & Household',4,1),
('Target','https://www.target.com/','Household, snacks, supplies','🎯','General & Household',4,2),
('Walmart','https://www.walmart.com/','Household and grocery','🛍️','General & Household',4,3),
('Staples','https://www.staples.com/','Office and school supplies','✏️','General & Household',4,4),
('Home Depot','https://www.homedepot.com/','Hardware, cleaning, repairs','🔧','General & Household',4,5)
on conflict (name) do nothing;
