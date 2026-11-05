const employeeModules = ['crm', 'projects', 'academy', 'marketing', 'inventory', 'support'];
const roleModules = {
  crm: ['SUPER_ADMIN', 'HR'],
  projects: ['SUPER_ADMIN', 'HR', 'EMPLOYEE'],
  academy: ['SUPER_ADMIN', 'HR'],
  finance: ['SUPER_ADMIN'],
  marketing: ['SUPER_ADMIN', 'HR'],
  inventory: ['SUPER_ADMIN', 'HR'],
  support: ['SUPER_ADMIN', 'HR', 'EMPLOYEE'],
  automations: ['SUPER_ADMIN'],
  reports: ['SUPER_ADMIN', 'HR']
};

export function canAccessWorkspaceModule(user, module) {
  if (user?.role === 'SUPER_ADMIN') return roleModules[module]?.includes(user.role) || false;
  if (user?.role === 'HR') {
    const hasRoleAccess = roleModules[module]?.includes(user.role) || false;
    return hasRoleAccess && (!Array.isArray(user.workspacePermissions) || user.workspacePermissions.includes(module));
  }
  if (user?.role === 'EMPLOYEE') {
    const permissions = user.workspacePermissions || ['projects', 'support'];
    return employeeModules.includes(module) && permissions.includes(module);
  }
  return roleModules[module]?.includes(user?.role) || false;
}
