/** A series name reduced to what matters for matching: "Re:Zero", "re zero" and "ReZero" all become "rezero". */
export const seriesKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
