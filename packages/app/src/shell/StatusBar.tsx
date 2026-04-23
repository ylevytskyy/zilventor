type Props = {
  message?: string;
  modified?: boolean;
  selection?: string;
};

export default function StatusBar({ message = 'Ready', modified = false, selection }: Props) {
  return (
    <div className="px-3 py-1 text-xs text-neutral-400 flex gap-4">
      <span>{message}</span>
      {selection && <span>{selection}</span>}
      {modified && <span className="text-yellow-400">● Modified</span>}
      <span className="ml-auto">mm</span>
    </div>
  );
}
