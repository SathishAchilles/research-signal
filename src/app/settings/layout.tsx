import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="micro">Research-signal · Configuration</p>
          <h1 className="font-display text-4xl leading-none font-semibold tracking-tight">
            Settings
          </h1>
        </div>
        <SettingsNav />
      </header>
      {children}
    </main>
  );
}
