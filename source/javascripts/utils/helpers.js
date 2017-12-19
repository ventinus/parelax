export const quadCalc = (progress, endVals, midVal) => {
  return Math.pow(1 - progress, 2) * endVals + 2 * (1 - progress) * progress * midVal + Math.pow(progress, 2) * endVals;
}

export const getWindowHeight = () => window.innerHeight || document.documentElement.clientHeight
