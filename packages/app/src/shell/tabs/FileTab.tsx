export default function FileTab() {
  return (
    <div className="flex gap-2 px-3 py-2 text-xs text-neutral-300">
      <button className="hover:text-white">New Part</button>
      <button className="hover:text-white">Open…</button>
      <button className="hover:text-white">Save</button>
      <button className="hover:text-white">Save As…</button>
    </div>
  );
}
