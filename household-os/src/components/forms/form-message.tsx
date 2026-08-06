export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>
  );
}

export function FormInfo({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{message}</p>
  );
}
