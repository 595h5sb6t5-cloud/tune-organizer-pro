import { ReactNode } from "react";
import AppSidebar from "./AppSidebar";

const AppLayout = ({ children }: { children: ReactNode }) => {
  return (
    <div className="min-h-screen">
      <AppSidebar />
      <main className="ml-60 p-8">{children}</main>
    </div>
  );
};

export default AppLayout;
