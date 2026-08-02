import { Header } from "@/components/layout/header"
import { Sidebar } from "@/components/layout/sidebar"

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
