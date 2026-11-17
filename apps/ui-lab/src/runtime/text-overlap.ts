/**
 * Text-collision guard for the minimum-width stories. A screen can pass the
 * no-horizontal-scroll check and still be unreadable: a flex row whose label
 * column shrinks to nothing lets the value paint over the label ("Network"
 * under "Starknet Mainnet"), a long word runs out of its column, and an
 * over-wide row is cut off by an ancestor's overflow clip rather than scrolling. Both are found geometrically from the
 * rendered text runs, so the guard needs no per-screen selectors.
 */

/** Overlap (or clipped width) in CSS px below which a pair is sub-pixel noise. */
const TOLERANCE_PX = 2;

type TextRun = { readonly element: Element; readonly rects: readonly DOMRect[] };

const describe = (element: Element): string => {
  const classes = Array.from(element.classList).slice(0, 2);
  const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) ?? "";
  return `${element.tagName.toLowerCase()}${classes.map((name) => `.${name}`).join("")} "${text}"`;
};

const intersect = (a: DOMRect, b: DOMRect): DOMRect | null => {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null;
};

/**
 * The box text inside `element` can paint into: the intersection of every
 * overflow-clipping box from the element itself up to the root. Null when a
 * clip hides the element entirely.
 */
const clipBox = (element: Element, view: Window): DOMRect | null => {
  let box: DOMRect | null = new DOMRect(-1e6, -1e6, 2e6, 2e6);
  for (let node: Element | null = element; node && box; node = node.parentElement) {
    if (node === node.ownerDocument.documentElement) {
      break;
    }
    const style = view.getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      box = intersect(box, node.getBoundingClientRect());
    }
  }
  return box;
};

/**
 * Content that scrolls beneath a fixed dock, a sticky header, a toast, or an
 * open menu is occluded by design, not colliding: runs are only compared
 * within the same layer.
 */
const paintLayer = (element: Element, view: Window): Element | null => {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (
      style.position === "fixed" ||
      style.position === "sticky" ||
      (style.position === "absolute" && style.zIndex !== "auto")
    ) {
      return node;
    }
  }
  return null;
};

const ellipsized = (element: Element, view: Window): boolean => {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (view.getComputedStyle(node).textOverflow === "ellipsis") {
      return true;
    }
  }
  return false;
};

/** Every visible element that directly owns text, with its line boxes. */
const textRuns = (document: Document): readonly TextRun[] => {
  const byElement = new Map<Element, DOMRect[]>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element || !node.textContent?.trim() || element.closest("script, style, option")) {
      continue;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0.5 && rect.height > 0.5,
    );
    byElement.set(element, [...(byElement.get(element) ?? []), ...rects]);
  }
  // A screen-reader-only label lives in a 1px clipped box on purpose.
  const shown = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  };
  return Array.from(byElement, ([element, rects]) => ({ element, rects })).filter(
    ({ element, rects }) =>
      rects.length > 0 &&
      shown(element) &&
      element.checkVisibility({
        contentVisibilityAuto: true,
        opacityProperty: true,
        visibilityProperty: true,
      }),
  );
};

/**
 * Lists every collision on the rendered document: two text runs that paint
 * over each other, a word wider than its own box (a title running toward the
 * network pill, a squeezed button label), and text an ancestor clips without
 * an ellipsis. Returns
 * human-readable findings; an empty list means the screen reads cleanly.
 */
export const textCollisions = (document: Document): readonly string[] => {
  const view = document.defaultView;
  if (!view) {
    throw new Error("The wallet document has no window to measure");
  }
  const findings: string[] = [];
  const visible = textRuns(document).map((run) => {
    const box = clipBox(run.element, view);
    const shown = box
      ? run.rects.map((rect) => intersect(rect, box)).filter((rect) => rect !== null)
      : [];
    const element = run.element as HTMLElement;
    if (
      !ellipsized(element, view) &&
      view.getComputedStyle(element).display !== "inline" &&
      element.scrollWidth > element.clientWidth + TOLERANCE_PX
    ) {
      findings.push(`${describe(element)} runs out of its own box`);
    }
    if (box && !ellipsized(run.element, view)) {
      const cut = run.rects.find(
        (rect) =>
          intersect(rect, box) !== null &&
          Math.max(0, box.left - rect.left) + Math.max(0, rect.right - box.right) > TOLERANCE_PX,
      );
      if (cut) {
        findings.push(`${describe(run.element)} is cut off by its container`);
      }
    }
    return { element: run.element, layer: paintLayer(run.element, view), rects: shown };
  });
  visible.forEach((a, index) => {
    for (const b of visible.slice(index + 1)) {
      if (a.layer !== b.layer || a.element.contains(b.element) || b.element.contains(a.element)) {
        continue;
      }
      const hit = a.rects.some((ra) =>
        b.rects.some((rb) => {
          const overlap = intersect(ra, rb);
          return overlap !== null && overlap.width > TOLERANCE_PX && overlap.height > TOLERANCE_PX;
        }),
      );
      if (hit) {
        findings.push(`${describe(a.element)} overlaps ${describe(b.element)}`);
      }
    }
  });
  return findings;
};
