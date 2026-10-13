import * as d3 from 'd3'
import { createChartTooltip } from './chart-tooltip'

export const PLOT_WIDTH = 360
export const PLOT_HEIGHT = 280
export const PLOT_MARGIN = { top: 12, right: 18, bottom: 46, left: 58 }
export const PLOT_INNER_WIDTH = PLOT_WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right
export const PLOT_INNER_HEIGHT = PLOT_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom

export const createPlot = (xLabel: string, yLabel: string) => {
	const svg = d3.create('svg')
		.attr('viewBox', `0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`)
		.attr('class', 'chart-root')
	const g = svg.append('g').attr('transform', `translate(${PLOT_MARGIN.left},${PLOT_MARGIN.top})`)
	svg.append('text').attr('x', PLOT_MARGIN.left + PLOT_INNER_WIDTH / 2).attr('y', PLOT_HEIGHT - 8)
		.attr('text-anchor', 'middle').attr('data-axis-label', '').text(xLabel)
	svg.append('text').attr('transform', 'rotate(-90)').attr('x', -(PLOT_MARGIN.top + PLOT_INNER_HEIGHT / 2))
		.attr('y', 15).attr('text-anchor', 'middle').attr('data-axis-label', '').text(yLabel)

	const tooltip = createChartTooltip(svg.node()!, PLOT_WIDTH, PLOT_HEIGHT)
	return { svg, g, tooltip }
}

export const showEmptyPlot = (plot: HTMLElement) => {
	const template = document.querySelector<HTMLTemplateElement>('#plot-empty-template')!
	plot.replaceChildren(template.content.cloneNode(true))
}
