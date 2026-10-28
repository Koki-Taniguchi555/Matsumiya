import { describe, expect, it } from "vitest";
import { canCalculateCharges, canManageMasters, canRecordLifecycle, type AuthorizedUser } from "../lib/auth-policy";

const admin: AuthorizedUser = { id: "admin", email: "admin@example.com", role: "admin", branchId: null };
const operator: AuthorizedUser = { id: "operator", email: "operator@example.com", role: "branch_operator", branchId: "branch-a" };
const viewer: AuthorizedUser = { id: "viewer", email: "viewer@example.com", role: "viewer", branchId: null };

describe("authorization policy", () => {
  it("allows only administrators to manage masters and calculate charges", () => {
    expect(canManageMasters(admin)).toBe(true);
    expect(canManageMasters(operator)).toBe(false);
    expect(canCalculateCharges(admin)).toBe(true);
    expect(canCalculateCharges(viewer)).toBe(false);
  });

  it("limits a branch operator to their assigned branch", () => {
    expect(canRecordLifecycle(admin, "branch-b")).toBe(true);
    expect(canRecordLifecycle(operator, "branch-a")).toBe(true);
    expect(canRecordLifecycle(operator, "branch-b")).toBe(false);
    expect(canRecordLifecycle(operator, null)).toBe(false);
    expect(canRecordLifecycle(viewer, "branch-a")).toBe(false);
  });
});
