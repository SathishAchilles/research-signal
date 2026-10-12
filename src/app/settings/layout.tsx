import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <SettingsNav />
      </div>
      {children}
    </div>
  );
}
