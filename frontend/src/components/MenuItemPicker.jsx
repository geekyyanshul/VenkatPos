export default function MenuItemPicker({ menuItems, cartItems, onAdd, onRemove, onNoteChange }) {
  return (
    <div className="menu-picker">
      {menuItems.map(item => {
        const cartItem = cartItems.find(c => c.menu_item_id === item.menu_item_id);
        const qty = cartItem ? cartItem.quantity : 0;
        return (
          <div key={item.menu_item_id} className="menu-item-row">
            <div className="menu-item-info">
              <span className="menu-item-name">{item.name}</span>
              <span className="menu-item-price">₹{parseFloat(item.price).toFixed(2)}</span>
            </div>
            <div className="menu-item-controls">
              <button
                className="btn btn-sm"
                onClick={() => onRemove(item.menu_item_id)}
                disabled={qty === 0}
                type="button"
              >
                −
              </button>
              <span className="qty-display">{qty}</span>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => onAdd(item)}
                type="button"
              >
                +
              </button>
            </div>
            {qty > 0 && (
              <input
                className="notes-input"
                type="text"
                placeholder="Notes (e.g. extra spicy)"
                value={cartItem.notes || ''}
                onChange={e => onNoteChange(item.menu_item_id, e.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
