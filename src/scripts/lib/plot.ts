export const showEmptyPlot = (plot: HTMLElement) => {
	const template = document.querySelector<HTMLTemplateElement>('#plot-empty-template')!
	plot.replaceChildren(template.content.cloneNode(true))
}
