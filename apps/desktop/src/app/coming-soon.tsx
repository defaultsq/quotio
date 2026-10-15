import { PageHeader } from "@/components/page-header";

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} subtitle="Coming soon to Quotio for Windows and Linux." />
      <div className="grid flex-1 place-items-center rounded-2xl bg-bg-weak-50 p-10 text-sm text-text-sub-600">
        This page isn’t available on desktop yet.
      </div>
    </>
  );
}
