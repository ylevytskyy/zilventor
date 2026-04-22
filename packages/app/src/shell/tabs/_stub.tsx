export function StubTab({ subProject, what }: { subProject: number; what: string }) {
  return (
    <div className="px-3 py-4 text-xs text-neutral-500">
      {what} — coming in sub-project {subProject}.
    </div>
  );
}
