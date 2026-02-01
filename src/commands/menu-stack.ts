const menuStack: string[] = [];

export function pushMenu(menuName: string): void {
  menuStack.push(menuName);
}

export function popMenu(): string | undefined {
  return menuStack.pop();
}

export function getCurrentMenu(): string | undefined {
  return menuStack[menuStack.length - 1];
}

export function isAtMainMenu(): boolean {
  return menuStack.length === 0;
}

export function clearMenuStack(): void {
  menuStack.length = 0;
}
