export const MANUFACTURING_LAYERS = {
  outline: 'OUTLINE',
  grooves: 'GROOVES',
  edgeband: 'EDGEBAND',
  grain: 'GRAIN',
  info: 'INFO',
  dimensions: 'DIMENSIONS',
  boreInfo: 'BORE-INFO',
  boresFront: (dia: number) => `BORES-FRONT-${dia}MM`,
  boresBack: (dia: number) => `BORES-BACK-${dia}MM`,
  boresEdge: (edge: string, dia: number) => `BORES-EDGE-${edge}-${dia}MM`,
} as const;
