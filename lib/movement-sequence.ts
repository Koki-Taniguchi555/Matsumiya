export type MovementAction = "received" | "delivered" | "recovered" | "supplier_return";
type MovementState = "in_stock" | "on_loan" | "returned_to_supplier" | "unknown";

export const movementActionLabel: Record<MovementAction, string> = {
  received: "入荷",
  delivered: "出荷",
  recovered: "回収",
  supplier_return: "仕入れ返却"
};

const expectedState: Record<MovementAction, MovementState> = {
  received: "returned_to_supplier",
  delivered: "in_stock",
  recovered: "on_loan",
  supplier_return: "in_stock"
};

const nextState: Record<MovementAction, MovementState> = {
  received: "in_stock",
  delivered: "on_loan",
  recovered: "in_stock",
  supplier_return: "returned_to_supplier"
};

/** Identifies historical rows whose visible action order cannot be a valid cycle. */
export function findSequenceErrors<T extends { action: string }>(history: T[]) {
  let state: MovementState = "unknown";
  return history.map((row) => {
    if (!(row.action in expectedState)) return "不明な処理区分です。";
    const action = row.action as MovementAction;
    // The first historical row has no recorded pre-state. It is allowed to
    // establish the state implied by its action, except for recovery.
    if (state === "unknown") {
      state = nextState[action];
      return action === "recovered" ? "出荷前の回収です。履歴順を確認してください。" : null;
    }
    if (state !== expectedState[action]) {
      const expected = Object.entries(expectedState).filter(([, value]) => value === state).map(([key]) => movementActionLabel[key as MovementAction]).join("または");
      state = nextState[action];
      return `順序エラー：この状態では「${expected}」を先に登録してください。`;
    }
    state = nextState[action];
    return null;
  });
}
