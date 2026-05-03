-- ============================================================
-- Sample data: one outlet, a small menu, some inventory
-- Run with: psql -f seed.sql pos_system
-- ============================================================

INSERT INTO outlets (outlet_id, name, tax_rate) VALUES
  (1, 'Spice Garden', 0.05),
  (2, 'Pizza Corner', 0.08);

INSERT INTO menu_items (menu_item_id, outlet_id, name, price) VALUES
  (1, 1, 'Paneer Tikka',     250.00),
  (2, 1, 'Butter Chicken',   320.00),
  (3, 1, 'Garlic Naan',       60.00),
  (4, 1, 'Mango Lassi',       80.00),
  (5, 2, 'Margherita Pizza', 350.00),
  (6, 2, 'Pepperoni Pizza',  450.00),
  (7, 2, 'Caesar Salad',     200.00),
  (8, 2, 'Coke',              50.00);

INSERT INTO inventory (menu_item_id, stock) VALUES
  (1, 20),
  (2, 15),
  (3, 50),
  (4, 30),
  (5, 10),
  (6, 8),
  (7, 12),
  (8, 100);

-- Reset the SERIAL sequences so future inserts don't collide
SELECT setval('outlets_outlet_id_seq', (SELECT MAX(outlet_id) FROM outlets));
SELECT setval('menu_items_menu_item_id_seq', (SELECT MAX(menu_item_id) FROM menu_items));