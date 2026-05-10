const BASE = import.meta.env.VITE_API_URL || '/api';

export async function getOutlets() {
  const res = await fetch(`${BASE}/outlets`);
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch outlets');
  return res.json();
}

export async function getMenuItems(outletId) {
  const res = await fetch(`${BASE}/outlets/${outletId}/menu`);
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch menu');
  return res.json();
}
