import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <h1 className="text-xl font-semibold text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-ink-2">The page you are looking for does not exist.</p>
      <Link href="/" className="btn btn-primary mt-6">
        Back to launches
      </Link>
    </div>
  );
}
