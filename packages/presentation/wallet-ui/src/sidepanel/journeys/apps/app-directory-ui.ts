/**
 * Bindings for the app directory screen (mc-wallet issue 749): the search box
 * and category filter narrow the rendered list in place. They only hide rows;
 * nothing is fetched and no entry is added or changed.
 */

const matches = (row: HTMLElement, query: string, category: string): boolean =>
  (category === "" || row.dataset["appCategory"] === category) &&
  (query === "" || (row.dataset["appSearch"] ?? "").includes(query));

/**
 * Binds the search and category controls on the app directory screen, when it
 * is rendered. A filter that leaves nothing shows the no-match line.
 */
export const bindAppDirectory = (app: Element | null): void => {
  const search = app?.querySelector<HTMLInputElement>('input[name="app-search"]');
  const category = app?.querySelector<HTMLSelectElement>('select[name="app-category"]');
  const none = app?.querySelector<HTMLElement>("[data-app-none]");
  if (!search || !category || !none) return;
  const rows = [...(app?.querySelectorAll<HTMLElement>("[data-app-row]") ?? [])];
  const apply = (): void => {
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const visible = matches(row, query, category.value);
      row.hidden = !visible;
      if (visible) shown += 1;
    }
    none.hidden = shown > 0;
  };
  search.addEventListener("input", apply);
  category.addEventListener("change", apply);
};
