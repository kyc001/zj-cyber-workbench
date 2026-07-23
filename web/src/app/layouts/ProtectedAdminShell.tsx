import { AgentSessionProvider } from "../../features/playground/AgentSessionProvider";
import { ContainerShellProvider } from "../../features/container-shell/ContainerShellProvider";
import { UnsavedChangesProvider } from "../../shared/components/UnsavedChangesGuard";
import { AdminLayout } from "./AdminLayout";

export function ProtectedAdminShell() {
  return (
    <div className="admin-app">
      <UnsavedChangesProvider>
        <AgentSessionProvider>
          <ContainerShellProvider>
            <AdminLayout />
          </ContainerShellProvider>
        </AgentSessionProvider>
      </UnsavedChangesProvider>
    </div>
  );
}
