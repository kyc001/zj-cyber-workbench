import { AgentSessionProvider } from "../../features/playground/AgentSessionProvider";
import { AdminLayout } from "./AdminLayout";

export function ProtectedAdminShell() {
  return (
    <div className="admin-app">
      <AgentSessionProvider>
        <AdminLayout />
      </AgentSessionProvider>
    </div>
  );
}
