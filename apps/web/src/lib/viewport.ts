/** Canvas registers how to find the visible centre so palette/quick-add can drop new nodes there. */
let center: () => { x: number; y: number } = () => ({ x: 100, y: 100 });
export const setViewportCenter = (fn: typeof center) => { center = fn; };
export const getViewportCenter = () => center();
