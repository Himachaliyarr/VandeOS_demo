export const employeeWorkspaceModules = ['crm', 'projects', 'academy', 'marketing', 'inventory', 'support'];
export const hrWorkspaceModules = [...employeeWorkspaceModules, 'reports'];
export const reportAccess = { roles: ['SUPER_ADMIN', 'HR'] };

export function hasWorkspaceModuleAccess(user, module, config) {
  if (user?.role === 'EMPLOYEE') {
    return employeeWorkspaceModules.includes(module)
      && (user.workspacePermissions || ['projects', 'support']).includes(module);
  }
  if (!config?.roles.includes(user?.role)) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (user.role === 'HR') {
    return !Array.isArray(user.workspacePermissions) || user.workspacePermissions.includes(module);
  }
  return true;
}

export function canWriteWorkspaceModule(user, module, config) {
  return ['SUPER_ADMIN', 'HR', 'EMPLOYEE'].includes(user?.role)
    && hasWorkspaceModuleAccess(user, module, config);
}
