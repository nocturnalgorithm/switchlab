declare module 'plotly.js-basic-dist-min' {
  const Plotly: {
    relayout: (element: HTMLElement, update: Record<string, unknown>) => Promise<HTMLElement>;
    react: (element: HTMLElement, traces: Record<string, unknown>[], layout: Record<string, unknown>, config?: Record<string, unknown>) => Promise<HTMLElement>;
    purge: (element: HTMLElement) => void;
    Plots: { resize: (element: HTMLElement) => Promise<void> };
  };
  export default Plotly;
}
