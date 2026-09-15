export default function VehicleDetailLoading() {
  return (
    <div className="min-h-screen surface-page" aria-busy="true">
      <div className="border-b border-slate-200 bg-white/90 dark:border-white/10 dark:bg-slate-950/90">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="h-7 w-32 animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none dark:bg-white/10" />
          <div className="h-9 w-24 animate-pulse rounded-full bg-slate-200 motion-reduce:animate-none dark:bg-white/10" />
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-5 h-4 w-48 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-white/10" />

        <section className="brand-panel overflow-hidden rounded-2xl">
          <div className="flex flex-col gap-5 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="h-6 w-24 animate-pulse rounded-full bg-white/15 motion-reduce:animate-none" />
              <div className="h-9 w-72 max-w-full animate-pulse rounded-lg bg-white/15 motion-reduce:animate-none" />
              <div className="h-4 w-56 max-w-full animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
            </div>
            <div className="h-24 w-full animate-pulse rounded-xl bg-white/10 motion-reduce:animate-none lg:w-48" />
          </div>
        </section>

        <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-12 lg:gap-8">
          <div className="space-y-6 lg:col-span-7">
            <div className="rounded-2xl p-4 surface-card sm:p-5">
              <div className="aspect-16/10 w-full animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none dark:bg-white/10" />
            </div>
            <div className="h-36 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-white/10" />
          </div>

          <div className="space-y-6 lg:col-span-5">
            <div className="rounded-2xl p-5 surface-card sm:p-6">
              <div className="h-5 w-40 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-white/10" />
              <div className="mt-3 h-4 w-full animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-white/10" />
              <div className="mt-5 h-12 w-full animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none dark:bg-white/10" />
            </div>
            <div className="h-80 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-white/10" />
          </div>
        </div>
      </main>
    </div>
  );
}
