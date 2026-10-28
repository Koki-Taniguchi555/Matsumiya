export type AppRole = "admin" | "branch_operator" | "viewer";
export type AuthorizedUser = { id: string; email: string; role: AppRole; branchId: string | null };

export function canManageMasters(user: AuthorizedUser) { return user.role === "admin"; }
export function canCalculateCharges(user: AuthorizedUser) { return user.role === "admin"; }
export function canRecordLifecycle(user: AuthorizedUser, branchId?: string | null) {
  return user.role === "admin" || (user.role === "branch_operator" && !!branchId && user.branchId === branchId);
}
